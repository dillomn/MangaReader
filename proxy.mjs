/**
 * Local manga proxy — run with: npm run proxy
 * Uses puppeteer-core + existing Chrome to scrape Mangapill.
 *
 * Routes:
 *   GET  /mangapill/search?q=...        Search for manga
 *   GET  /mangapill/chapters?path=...   Chapter list for a manga path (e.g. /manga/123-gantz)
 *   GET  /mangapill/pages?path=...      Image URLs for a chapter path (e.g. /chapters/456-10000)
 *   GET  /mangapill/img?url=...         Proxy a CDN image (adds correct Referer header)
 *
 *   GET  /goldsplit/series              Gold Split (greasequeen.com) metadata + chapter list
 *   GET  /goldsplit/pages?path=...      Image URLs for a chapter path (e.g. /2025/04/21/gold-split-chapter-1/)
 *   GET  /goldsplit/img?url=...         Proxy a greasequeen.com image
 *
 *   POST /auth/login                    Validate Jellyfin creds → issue JWT
 *   GET  /auth/me                       Verify JWT → return user payload
 *
 *   GET  /api/announcement              Public: get active announcement
 *
 *   GET  /admin-api/health              Admin: server health stats
 *   GET  /admin-api/users               Admin: list known users
 *   POST /admin-api/announcement        Admin: set announcement text (body: { message })
 *   DELETE /admin-api/announcement      Admin: clear announcement
 *   POST /admin-api/cache/clear         Admin: clear in-memory manga cache
 */
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { existsSync, createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, normalize, extname, sep } from 'node:path'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

import { createOgMiddleware } from './server/ogMeta.mjs'
import { validateJellyfinCredentials, validateLocalCredentials, hashPassword, JELLYFIN_ENABLED, signToken, verifyToken, extractToken } from './server/auth.mjs'
import { upsertUser, listUsers, getAnnouncement, setAnnouncement, recordDownload, recordLibraryAdd, recordLibraryRemove, removeMangaDownloads, getAllActivity, scheduleRemovals, getPendingRemovals, clearRemovals, getUserByUsername, hasAnyAdmin, createLocalUser, deleteUser, getProgress, getAllProgress, setProgressEntry, deleteProgressEntry, deleteProgressByManga, getMangaMetaCache, setMangaMetaCache } from './server/db.mjs'

const PORT = Number(process.env.PORT) || 3001
// When set (Docker / production single-container), this process also serves the
// built frontend from dist/ and the MangaDex passthrough proxies that the Vite
// dev server normally provides. Left off for local dev (Vite serves those).
const SERVE_STATIC = process.env.SERVE_STATIC === '1' || process.env.SERVE_STATIC === 'true'
const DIST_DIR = fileURLToPath(new URL('./dist', import.meta.url))
const DIST_INDEX = join(DIST_DIR, 'index.html')
const CACHE_TTL_MS = 5 * 60 * 1000
const MP_ORIGIN = 'https://mangapill.com'
const SERVER_START = new Date().toISOString()
const MAX_BODY_BYTES = 50 * 1024 * 1024 // 50 MB cap on request bodies

// Hostnames the /mangapill/img endpoint is allowed to fetch from. Anything else
// is refused to prevent the proxy being abused as an open SSRF gateway.
const MP_IMG_HOST_ALLOWLIST = [
  /(^|\.)mangapill\.com$/i,
  /(^|\.)cdn\.readdetectiveconan\.com$/i,
  /(^|\.)mangapill[a-z0-9-]*\.(?:com|net|org|io|cc|me)$/i,
]

// Origins permitted via CORS. Keep wildcard fallback off in production.
// Set ALLOWED_ORIGINS as a comma-separated list (e.g. "https://manga.example.com").
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

function corsOriginFor(req) {
  const origin = req.headers.origin
  if (!origin) return null
  return ALLOWED_ORIGINS.includes(origin) ? origin : null
}

function applyCors(req, res) {
  const allowed = corsOriginFor(req)
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

// Login rate limiter: max 10 failed attempts per 15-minute window per IP+username.
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILS = 10
const loginAttempts = new Map() // key: `${ip}|${username}` → { count, firstAt }

function loginAttemptKey(req, username) {
  const ip = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown'
  return `${ip}|${(username || '').toLowerCase()}`
}

function isLoginBlocked(key) {
  const entry = loginAttempts.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) { loginAttempts.delete(key); return false }
  return entry.count >= LOGIN_MAX_FAILS
}

function recordLoginFailure(key) {
  const entry = loginAttempts.get(key)
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() })
  } else {
    entry.count++
  }
}

function clearLoginAttempts(key) { loginAttempts.delete(key) }

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  // Linux (incl. Docker / apt / snap installs)
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find(p => existsSync(p))
if (chromePath) {
  console.log(`Chrome: ${chromePath}`)
} else {
  // Non-fatal: only Mangapill needs a browser. MangaDex, Gold Split, auth,
  // and the admin portal all work without one, so the server still starts.
  console.warn('Chrome/Chromium not found — the Mangapill source is disabled until CHROME_PATH is set.')
  console.warn('  macOS:   export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"')
  console.warn('  Linux:   export CHROME_PATH=/usr/bin/google-chrome')
  console.warn('  Windows: $env:CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"')
}

// Browser is launched lazily on first Mangapill use and relaunched if it
// crashes, so a flaky/headless Chrome never takes the whole server down.
let browserPromise = null
async function launchBrowser() {
  if (!chromePath) throw new Error('No Chrome/Chromium binary available (set CHROME_PATH)')
  const b = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    // --disable-dev-shm-usage avoids crashes from the small /dev/shm in containers
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  b.on('disconnected', () => { browserPromise = null })
  return b
}
function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch(err => { browserPromise = null; throw err })
  }
  return browserPromise
}

const cache = new Map()
function getCache(key, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key)
  return hit && Date.now() - hit.ts < ttl ? hit.body : null
}

// ---- Body parsing ----

class BodyTooLargeError extends Error {}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let received = 0
    const chunks = []
    req.on('data', chunk => {
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        req.destroy()
        reject(new BodyTooLargeError('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

// ---- Input validation helpers ----

function isString(v, { min = 0, max = 256 } = {}) {
  return typeof v === 'string' && v.length >= min && v.length <= max
}

function isSafeUrl(v, { maxLen = 2048 } = {}) {
  if (!isString(v, { max: maxLen })) return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch { return false }
}

function isAllowedImgHost(hostname) {
  return MP_IMG_HOST_ALLOWLIST.some(re => re.test(hostname))
}

// Mangapill paths come from the scraped pages, so we validate the prefix
// to prevent users redirecting Puppeteer to arbitrary URLs.
function isMangaPath(p) {
  return typeof p === 'string' && /^\/manga\/[A-Za-z0-9_\-/.]{1,256}$/.test(p)
}
function isChapterPath(p) {
  return typeof p === 'string' && /^\/chapters\/[A-Za-z0-9_\-/.]{1,256}$/.test(p)
}

function validateActivityPayload(b) {
  return (
    isString(b?.mangaId, { min: 1, max: 200 }) &&
    isString(b?.mangaTitle, { min: 1, max: 500 }) &&
    isSafeUrl(b?.coverUrl, { maxLen: 2048 }) &&
    isString(b?.chapterId, { min: 1, max: 200 }) &&
    (b.chapterNumber === null || b.chapterNumber === undefined ||
      typeof b.chapterNumber === 'number' || isString(b.chapterNumber, { max: 32 })) &&
    (b.chapterTitle === undefined || isString(b.chapterTitle, { max: 500 }))
  )
}

// Group a user's per-chapter progress into per-manga reading activity for the
// admin portal. Title/cover come from the newest progress entry that has them,
// falling back to the user's library/download records for older entries that
// were synced before metadata was included.
function aggregateReading(progressMap, activityEntry) {
  const byManga = new Map()
  for (const entry of Object.values(progressMap)) {
    if (!entry?.mangaId) continue
    let g = byManga.get(entry.mangaId)
    if (!g) {
      g = { mangaId: entry.mangaId, mangaTitle: '', coverUrl: '', chaptersRead: 0, lastChapterNumber: null, lastReadAt: '' }
      byManga.set(entry.mangaId, g)
    }
    g.chaptersRead++
    if (!g.lastReadAt || entry.updatedAt > g.lastReadAt) {
      g.lastReadAt = entry.updatedAt
      if (typeof entry.chapterNumber === 'number') g.lastChapterNumber = entry.chapterNumber
    }
    if (entry.mangaTitle && !g.mangaTitle) g.mangaTitle = entry.mangaTitle
    if (entry.coverUrl && !g.coverUrl) g.coverUrl = entry.coverUrl
  }
  for (const g of byManga.values()) {
    if (g.mangaTitle && g.coverUrl) continue
    const fromLib = activityEntry?.library?.find(l => l.mangaId === g.mangaId)
    const fromDl = activityEntry?.downloads?.find(d => d.mangaId === g.mangaId)
    g.mangaTitle = g.mangaTitle || fromLib?.mangaTitle || fromDl?.mangaTitle || ''
    g.coverUrl = g.coverUrl || fromLib?.coverUrl || fromDl?.coverUrl || ''
  }
  return [...byManga.values()].sort((a, b) => b.lastReadAt.localeCompare(a.lastReadAt))
}

// Backfill titles/covers for reading entries whose progress was synced before
// the client included display metadata. Manga ids are MangaDex UUIDs, so they
// can be resolved in bulk from the MangaDex API; results persist in
// data/manga-meta.json so each manga is only ever looked up once.
async function resolveUnknownMangaMeta(readingLists) {
  const metaCache = getMangaMetaCache()

  const fill = () => {
    const missing = new Set()
    for (const list of readingLists) {
      for (const r of list) {
        if (r.mangaTitle) continue
        const cached = metaCache[r.mangaId]
        if (cached) {
          r.mangaTitle = cached.title
          r.coverUrl = r.coverUrl || cached.coverUrl
        } else if (/^[0-9a-f-]{36}$/.test(r.mangaId)) {
          missing.add(r.mangaId)
        }
      }
    }
    return missing
  }

  const missing = fill()
  if (missing.size === 0) return

  const ids = [...missing]
  let updated = false
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100)
    try {
      const url = new URL('https://api.mangadex.org/manga')
      url.searchParams.set('limit', String(batch.length))
      for (const id of batch) url.searchParams.append('ids[]', id)
      url.searchParams.append('includes[]', 'cover_art')
      // Include every rating — the default filter would silently drop some manga
      for (const r of ['safe', 'suggestive', 'erotica', 'pornographic']) url.searchParams.append('contentRating[]', r)

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mangva/1.0 (self-hosted manga reader)' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const data = await res.json()
      for (const m of data.data ?? []) {
        const attrs = m.attributes ?? {}
        const title = attrs.title?.en
          ?? attrs.altTitles?.find(t => 'en' in t)?.en
          ?? Object.values(attrs.title ?? {})[0]
          ?? ''
        if (!title) continue
        const coverFile = m.relationships?.find(rel => rel.type === 'cover_art')?.attributes?.fileName
        metaCache[m.id] = {
          title,
          coverUrl: coverFile ? `/mangadex-covers/covers/${m.id}/${coverFile}.512.jpg` : '',
        }
        updated = true
      }
    } catch {} // Best-effort — entries stay untitled until the next attempt
  }

  if (updated) {
    setMangaMetaCache(metaCache)
    fill()
  }
}

// ---- Auth middleware helpers ----

function requireAuth(req, res) {
  const token = extractToken(req)
  if (!token) { sendJson(res, 401, { error: 'Unauthorized' }); return null }
  const payload = verifyToken(token)
  if (!payload) { sendJson(res, 401, { error: 'Invalid or expired token' }); return null }
  return payload
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res)
  if (!user) return null
  if (!user.isAdmin) { sendJson(res, 403, { error: 'Admin only' }); return null }
  return user
}

// ---- Response helpers ----

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

// ---- Proxied image serving (shared by /mangapill/img and /goldsplit/img) ----
// In-memory LRU keeps recently viewed pages hot so repeat reads (and other
// users reading the same chapter) skip the upstream fetch entirely.

const IMG_CACHE_MAX_BYTES = 150 * 1024 * 1024
const IMG_CACHE_MAX_ITEM = 15 * 1024 * 1024
const imgCache = new Map() // url → { buf, contentType }
let imgCacheBytes = 0

function imgCacheGet(url) {
  const hit = imgCache.get(url)
  if (hit) { imgCache.delete(url); imgCache.set(url, hit) } // refresh LRU position
  return hit ?? null
}

function imgCachePut(url, buf, contentType) {
  if (buf.length > IMG_CACHE_MAX_ITEM || imgCache.has(url)) return
  imgCache.set(url, { buf, contentType })
  imgCacheBytes += buf.length
  while (imgCacheBytes > IMG_CACHE_MAX_BYTES && imgCache.size > 0) {
    const [oldestKey, oldest] = imgCache.entries().next().value
    imgCache.delete(oldestKey)
    imgCacheBytes -= oldest.buf.length
  }
}

function clearImgCache() {
  imgCache.clear()
  imgCacheBytes = 0
}

// Fetches the first candidate URL that returns an image (later candidates are
// fallbacks, e.g. the unscaled original when a guessed WP variant 404s).
async function serveProxiedImage(req, res, candidates, referer) {
  const cacheKey = candidates[0]
  let entry = imgCacheGet(cacheKey)

  if (!entry) {
    for (const url of candidates) {
      const imgRes = await fetch(url, {
        headers: {
          'Referer': referer,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
        redirect: 'manual',
      })
      const contentType = imgRes.headers.get('content-type') ?? ''
      if (!imgRes.ok || !contentType.startsWith('image/')) continue
      entry = { buf: Buffer.from(await imgRes.arrayBuffer()), contentType }
      imgCachePut(cacheKey, entry.buf, entry.contentType)
      break
    }
    if (!entry) { res.writeHead(415); res.end(); return }
  }

  const corsOrigin = corsOriginFor(req)
  const headers = {
    'Content-Type': entry.contentType,
    'Content-Length': entry.buf.length,
    'Cache-Control': 'public, max-age=86400',
  }
  if (corsOrigin) {
    headers['Access-Control-Allow-Origin'] = corsOrigin
    headers['Vary'] = 'Origin'
  }
  res.writeHead(200, headers)
  res.end(entry.buf)
}

// ---- Mangapill scrapers ----

async function withPage(fn) {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setRequestInterception(true)
    page.on('request', req => {
      const t = req.resourceType()
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') req.abort()
      else req.continue()
    })
    return await fn(page)
  } finally {
    await page.close()
  }
}

async function mangapillSearch(q) {
  const key = `mp:search:${q}`
  const hit = getCache(key)
  if (hit) { console.log(`[CACHE] search ${q}`); return hit }

  const url = `${MP_ORIGIN}/search?q=${encodeURIComponent(q)}&type=&status=`
  console.log(`[MP-SEARCH] ${url}`)

  const body = await withPage(async page => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    const debug = await page.evaluate(() => ({
      title: document.title,
      bodyStart: document.body?.innerText?.slice(0, 150),
      allHrefs: Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(a => a.getAttribute('href')),
    }))
    console.log(`[MP-SEARCH-DEBUG] title="${debug.title}"`)
    console.log(`[MP-SEARCH-DEBUG] body="${debug.bodyStart}"`)
    console.log(`[MP-SEARCH-DEBUG] hrefs=${JSON.stringify(debug.allHrefs)}`)

    const results = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href^="/manga/"]')
      const map = new Map()
      for (const a of links) {
        const href = a.getAttribute('href')
        if (!href) continue
        const card = a.closest('div')
        const img = card?.querySelector('img')
        const cover = img?.getAttribute('src') || img?.getAttribute('data-src') || ''
        const titleEl = card?.querySelector('strong, h3, h2, [class*="title"], [class*="name"]')
        const title = (a.getAttribute('title') || titleEl?.textContent || a.textContent || '').trim()
        const existing = map.get(href)
        if (!existing) {
          map.set(href, { title, url: href, cover })
        } else if (!existing.title && title) {
          map.set(href, { ...existing, title })
        }
      }
      return Array.from(map.values()).map(r => ({
        ...r,
        title: r.title || (r.url.split('/').pop() ?? '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      })).filter(r => r.title)
    })

    console.log(`[MP-SEARCH] ${results.length} results`)
    return JSON.stringify(results)
  })

  cache.set(key, { body, ts: Date.now() })
  return body
}

async function mangapillChapters(mangaPath) {
  const key = `mp:chapters:${mangaPath}`
  const hit = getCache(key)
  if (hit) { console.log(`[CACHE] chapters ${mangaPath}`); return hit }

  const url = `${MP_ORIGIN}${mangaPath}`
  console.log(`[MP-CHAPTERS] ${url}`)

  const body = await withPage(async page => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    const chapters = await page.evaluate(() => {
      const links = document.querySelectorAll('div[data-filter-list] a, #chapters a')
      return Array.from(links).map(a => {
        const text = (a.textContent || '').trim()
        const href = a.getAttribute('href') || ''
        const chapMatch = text.match(/chapter\s*(\d+(?:\.\d+)?)/i)
        const volMatch = text.match(/vol(?:ume)?\.?\s*(\d+)/i)
        const urlCode = parseInt(href.match(/-(\d+)\//)?.[1] ?? '0', 10)
        const volFromUrl = urlCode >= 10000000 ? Math.floor(urlCode / 10000000) : null
        return {
          url: href,
          name: text,
          chap: chapMatch ? chapMatch[1] : null,
          vol: volMatch ? volMatch[1] : (volFromUrl ? String(volFromUrl) : null),
        }
      }).filter(c => c.url)
    })

    console.log(`[MP-CHAPTERS] ${chapters.length} chapters`)
    return JSON.stringify(chapters)
  })

  cache.set(key, { body, ts: Date.now() })
  return body
}

async function mangapillPages(chapterPath) {
  const key = `mp:pages:${chapterPath}`
  const hit = getCache(key, 60 * 60 * 1000)
  if (hit) { console.log(`[CACHE] pages ${chapterPath}`); return hit }

  const url = `${MP_ORIGIN}${chapterPath}`
  console.log(`[MP-PAGES] ${url}`)

  const body = await withPage(async page => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // Wait for at least one image element to appear, then grab them all.
    // Avoids networkidle2 which hangs waiting for ads/trackers to finish.
    await page.waitForSelector('img[data-src]', { timeout: 10000 }).catch(() => {})

    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll('picture img[data-src], .chapter-image img, img[data-src]')
      return Array.from(imgs)
        .map(img => img.getAttribute('data-src') || img.getAttribute('src'))
        .filter(src => src && src.startsWith('http'))
    })

    console.log(`[MP-PAGES] ${images.length} images`)
    return JSON.stringify(images)
  })

  cache.set(key, { body, ts: Date.now() })
  return body
}

// ---- Gold Split (greasequeen.com) scrapers ----
// Plain fetch — the site is server-rendered WordPress, no Puppeteer needed.
// Scraped with the author's permission.

const GQ_ORIGIN = 'https://greasequeen.com'
const GQ_SERIES_PATH = '/gold-split/'
const GQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const GQ_IMG_HOST_ALLOWLIST = [/(^|\.)greasequeen\.com$/i]

// Chapter pages are WordPress posts: /YYYY/MM/DD/slug/
function isGoldSplitChapterPath(p) {
  return typeof p === 'string' && /^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]{1,128}\/?$/i.test(p)
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

async function gqFetch(path) {
  const res = await fetch(`${GQ_ORIGIN}${path}`, {
    headers: { 'User-Agent': GQ_UA },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`greasequeen ${res.status}: ${path}`)
  return res.text()
}

// Full-size uploads run 1–3 MB per page; WordPress pre-generates scaled
// variants (e.g. "1-3-1097x1536.jpg") that are ~3-4× smaller. The variant
// filename embeds the scaled dimensions, so we probe the original's size
// (first 64 KB is enough for the JPEG/PNG header) and compute the name.
// If a guessed variant doesn't exist, the /goldsplit/img handler falls
// back to the original by stripping the suffix.
const GQ_VARIANT_BOX = 1536
const imgDimsCache = new Map() // original url → { w, h } | null

function parseImageDims(buf) {
  // PNG: IHDR width/height at fixed offsets
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  }
  // JPEG: scan for a Start-Of-Frame marker
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xff) { i++; continue }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
      const isSOF = (marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)
      if (isSOF) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

async function fetchImageDims(url) {
  if (imgDimsCache.has(url)) return imgDimsCache.get(url)
  let dims = null
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': GQ_UA, 'Range': 'bytes=0-65535' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok || res.status === 206) {
      dims = parseImageDims(Buffer.from(await res.arrayBuffer()))
    }
  } catch {}
  imgDimsCache.set(url, dims)
  return dims
}

async function toScaledVariant(url) {
  const m = url.match(/^(.+)(\.(?:jpe?g|png))$/i)
  if (!m) return url
  const dims = await fetchImageDims(url)
  if (!dims || (dims.w <= GQ_VARIANT_BOX && dims.h <= GQ_VARIANT_BOX)) return url
  const scale = Math.min(GQ_VARIANT_BOX / dims.w, GQ_VARIANT_BOX / dims.h)
  return `${m[1]}-${Math.round(dims.w * scale)}x${Math.round(dims.h * scale)}${m[2]}`
}

async function goldSplitSeries() {
  const key = 'gq:series'
  const hit = getCache(key)
  if (hit) { console.log('[CACHE] goldsplit series'); return hit }

  console.log(`[GQ-SERIES] ${GQ_ORIGIN}${GQ_SERIES_PATH}`)
  const html = await gqFetch(GQ_SERIES_PATH)

  const synopsis = decodeEntities(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '')
  const coverOriginal =
    html.match(/<img[^>]*src="(https:\/\/greasequeen\.com\/wp-content\/uploads\/[^"]*Series-Cover[^"]*)"/i)?.[1] ??
    html.match(/<img[^>]*src="(https:\/\/greasequeen\.com\/wp-content\/uploads\/[^"]+)"/i)?.[1] ?? ''
  const coverUrl = coverOriginal ? await toScaledVariant(coverOriginal) : ''

  // Chapter posts are linked from the series page as /YYYY/MM/DD/...chapter-N.../
  const seen = new Set()
  const chapters = []
  for (const m of html.matchAll(/href="https:\/\/greasequeen\.com(\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]*chapter-(\d+(?:\.\d+)?)[a-z0-9-]*\/?)"/gi)) {
    const path = m[1].endsWith('/') ? m[1] : `${m[1]}/`
    if (seen.has(path)) continue
    seen.add(path)
    chapters.push({ path, number: parseFloat(m[2]) })
  }
  chapters.sort((a, b) => a.number - b.number)

  console.log(`[GQ-SERIES] ${chapters.length} chapters`)
  const body = JSON.stringify({ title: 'Gold Split', coverUrl, synopsis, chapters })
  cache.set(key, { body, ts: Date.now() })
  return body
}

async function goldSplitPages(chapterPath) {
  const key = `gq:pages:${chapterPath}`
  const hit = getCache(key, 60 * 60 * 1000)
  if (hit) { console.log(`[CACHE] goldsplit pages ${chapterPath}`); return hit }

  console.log(`[GQ-PAGES] ${GQ_ORIGIN}${chapterPath}`)
  const html = await gqFetch(chapterPath)

  // Pages live in an ordered pagelayer slider; document order = reading order
  const originals = [...html.matchAll(/<li class="pagelayer-slider-item">\s*<img[^>]*src="(https:\/\/greasequeen\.com\/wp-content\/uploads\/[^"]+)"/gi)]
    .map(m => m[1])
  const images = await Promise.all(originals.map(toScaledVariant))

  console.log(`[GQ-PAGES] ${images.length} images`)
  const body = JSON.stringify(images)
  cache.set(key, { body, ts: Date.now() })
  return body
}

// ---- Frontend serving (production single-container, SERVE_STATIC=1) ----
// In dev these jobs are handled by the Vite dev server; here we replicate them
// so one Node process serves the whole app on a single port.

// Reverse-proxy MangaDex's public API and cover CDN. Mirrors the Vite proxy:
// strips the path prefix and sends a clean request (no browser Referer/Origin/
// Via headers, which MangaDex rejects or which leak the app's origin).
async function proxyPassthrough(req, res, targetBase, prefix, kind) {
  const target = targetBase + (req.url || '').slice(prefix.length)
  try {
    const upstream = await fetch(target, {
      headers: {
        'Accept': req.headers['accept'] || (kind === 'cover' ? 'image/*' : 'application/json'),
        'User-Agent': 'Mangva/1.0 (self-hosted manga reader)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    })
    const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' }
    headers['Cache-Control'] = kind === 'cover'
      ? 'public, max-age=86400'
      : (upstream.headers.get('cache-control') || 'no-store')
    res.writeHead(upstream.status, headers)
    if (upstream.body) {
      const stream = Readable.fromWeb(upstream.body)
      stream.on('error', () => res.destroy())
      res.on('close', () => stream.destroy())
      stream.pipe(res)
    } else {
      res.end()
    }
  } catch {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Upstream error' }))
  }
}

const STATIC_MIME = {
  '.html': 'text/html; charset=UTF-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
}

// Serve a built file from dist/, falling back to index.html for unknown paths
// so React Router deep links work on direct load / refresh.
async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  const rel = normalize(urlPath).replace(/^([/\\])+/, '')
  let filePath = join(DIST_DIR, rel)
  // Path-traversal guard: never escape dist/
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) {
    res.writeHead(403); res.end('Forbidden'); return
  }

  let info = await stat(filePath).catch(() => null)
  if (info?.isDirectory()) { filePath = join(filePath, 'index.html'); info = await stat(filePath).catch(() => null) }
  if (!info) { filePath = DIST_INDEX; info = await stat(filePath).catch(() => null) }
  if (!info) { res.writeHead(404); res.end('Not found'); return }

  const ext = extname(filePath).toLowerCase()
  const headers = { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' }
  if (ext === '.html' || filePath.endsWith('sw.js')) {
    headers['Cache-Control'] = 'no-store'
  } else if (filePath.includes(`${sep}assets${sep}`)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable' // content-hashed
  } else {
    headers['Cache-Control'] = 'public, max-age=3600'
  }
  res.writeHead(200, headers)
  const stream = createReadStream(filePath)
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end() })
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

// Discord/Slack link embeds: inject og:* tags into dist/index.html for /manga/*
const ogServe = SERVE_STATIC
  ? createOgMiddleware(() => readFile(DIST_INDEX, 'utf8'))
  : null

// ---- HTTP server ----

createServer(async (req, res) => {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsed = new URL(req.url ?? '/', 'http://localhost')
  const seg = parsed.pathname.split('/').filter(Boolean)

  try {

    // ---- /auth ----
    if (seg[0] === 'auth') {
      if (seg[1] === 'login' && req.method === 'POST') {
        const body = await readBody(req)
        if (!isString(body?.username, { min: 1, max: 64 }) || !isString(body?.password, { min: 1, max: 256 })) {
          return sendJson(res, 400, { error: 'username and password required' })
        }

        const rlKey = loginAttemptKey(req, body.username)
        if (isLoginBlocked(rlKey)) {
          return sendJson(res, 429, { error: 'Too many failed attempts. Try again later.' })
        }

        // Try local credentials first, then Jellyfin
        let user = await validateLocalCredentials(body.username, body.password)
        if (user) {
          upsertUser(user.id, user.username, user.isAdmin)
        } else if (JELLYFIN_ENABLED) {
          user = await validateJellyfinCredentials(body.username, body.password)
          if (user) upsertUser(user.id, user.username, user.isAdmin)
        }

        if (!user) {
          recordLoginFailure(rlKey)
          return sendJson(res, 401, { error: 'Invalid credentials' })
        }
        clearLoginAttempts(rlKey)
        const token = signToken(user)
        return sendJson(res, 200, { token, user })
      }

      // GET /auth/setup → { needed: bool }
      // Setup is only needed when Jellyfin is disabled and no admin exists yet
      if (seg[1] === 'setup' && req.method === 'GET') {
        return sendJson(res, 200, { needed: !JELLYFIN_ENABLED && !hasAnyAdmin() })
      }

      // POST /auth/setup → create first admin (local, one-time only)
      if (seg[1] === 'setup' && req.method === 'POST') {
        if (JELLYFIN_ENABLED || hasAnyAdmin()) {
          return sendJson(res, 403, { error: 'Setup already complete' })
        }
        const body = await readBody(req)
        if (!isString(body?.username, { min: 1, max: 64 }) || !isString(body?.password, { min: 8, max: 72 })) {
          return sendJson(res, 400, { error: 'Username (1–64) and password (8–72) required' })
        }
        const id = randomUUID()
        const passwordHash = await hashPassword(body.password)
        createLocalUser(id, body.username, passwordHash, true)
        const user = { id, username: body.username, isAdmin: true }
        const token = signToken(user)
        return sendJson(res, 200, { token, user })
      }

      if (seg[1] === 'me' && req.method === 'GET') {
        const payload = requireAuth(req, res)
        if (!payload) return
        return sendJson(res, 200, {
          id: payload.sub,
          username: payload.username,
          isAdmin: payload.isAdmin,
        })
      }

      return sendJson(res, 404, { error: 'Not found' })
    }

    // ---- /api (public-ish) ----
    if (seg[0] === 'api') {
      if (seg[1] === 'announcement' && req.method === 'GET') {
        return sendJson(res, 200, getAnnouncement())
      }

      // Sync: get chapter IDs the admin has scheduled for local deletion
      if (seg[1] === 'sync' && req.method === 'GET') {
        const payload = requireAuth(req, res)
        if (!payload) return
        return sendJson(res, 200, { remove: getPendingRemovals(payload.sub) })
      }

      // Sync: acknowledge processed removals so they are cleared server-side
      if (seg[1] === 'sync' && seg[2] === 'ack' && req.method === 'POST') {
        const payload = requireAuth(req, res)
        if (!payload) return
        const body = await readBody(req)
        const ids = Array.isArray(body?.chapterIds)
          ? body.chapterIds.filter(id => isString(id, { min: 1, max: 200 })).slice(0, 1000)
          : []
        clearRemovals(payload.sub, ids)
        return sendJson(res, 200, { ok: true })
      }

      // Proxy MangaDex at-home report (browser can't call api.mangadex.network directly due to CORS)
      if (seg[1] === 'at-home' && seg[2] === 'report' && req.method === 'POST') {
        const payload = requireAuth(req, res)
        if (!payload) return
        const body = await readBody(req)
        if (!isSafeUrl(body?.url) || typeof body?.success !== 'boolean') {
          return sendJson(res, 400, { error: 'Invalid report payload' })
        }
        try {
          await fetch('https://api.mangadex.network/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: body.url,
              success: body.success,
              bytes: typeof body.bytes === 'number' ? body.bytes : 0,
              duration: typeof body.duration === 'number' ? body.duration : 0,
              cached: body.cached === true,
            }),
          })
        } catch {} // Best-effort — don't fail the client if MangaDex report is unavailable
        return sendJson(res, 200, { ok: true })
      }

      // Server-side MangaDex page fetch — used as a fallback when the browser's
      // CDN node keeps returning 404 for specific pages. Makes multiple fresh
      // at-home API calls (alternating regular and port-443 pools) to maximise
      // the chance of landing on a node that has the page cached.
      if (seg[1] === 'manga-page' && req.method === 'GET') {
        // No JWT check here: browser <img> elements load this URL in no-cors
        // mode and cannot attach an Authorization header. The endpoint is
        // already gated by Cloudflare Access in front, by strict URL/chapter
        // validation below, and by an image-only content-type guard — and the
        // URLs it proxies are publicly accessible from the MangaDex CDN anyway.

        const imgUrl = parsed.searchParams.get('url') ?? ''
        const chapId = parsed.searchParams.get('chapterId') ?? ''

        // Allow hyphens in the node subdomain; port is optional (port-443 nodes
        // may include ":443" explicitly in the base URL).
        const isMdUrl = /^https:\/\/[a-z0-9-]+\.mangadex\.network(?::\d+)?\/data\/[a-f0-9]+\/[^/?#]+$/.test(imgUrl)
        const isValidChap = /^[0-9a-f-]{36}$/.test(chapId)
        if (!isMdUrl || !isValidChap) {
          return sendJson(res, 400, { error: 'Invalid request' })
        }

        const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        const filename = imgUrl.split('/').pop()

        async function fetchImg(url) {
          return fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
        }

        // Returns { dataUrl, dataSaverUrl } for the same page index. The
        // dataSaver array uses different filenames, so we have to look up the
        // page index of the failing filename in the data array and translate.
        async function getNodeUrls(forcePort443) {
          const qs = forcePort443 ? '?forcePort443=true' : ''
          const r = await fetch(`https://api.mangadex.org/at-home/server/${chapId}${qs}`, {
            headers: { 'User-Agent': UA },
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
          })
          if (!r.ok) return { dataUrl: null, dataSaverUrl: null }
          const d = await r.json()
          const base = (d.baseUrl ?? '').replace(/^http:\/\//, 'https://')
          const hash = d.chapter?.hash
          const data = d.chapter?.data ?? []
          const dataSaver = d.chapter?.dataSaver ?? []
          if (!base || !hash) return { dataUrl: null, dataSaverUrl: null }

          // Find which page our failing filename refers to. The at-home response
          // can re-issue different filenames for the same page on republish, so
          // we also fall back to position-by-prefix (e.g. "x37-…" → page 37).
          let idx = data.indexOf(filename)
          if (idx < 0) {
            const prefix = (filename ?? '').split('-')[0] // e.g. "x37" or "37"
            idx = data.findIndex(f => f.split('-')[0] === prefix)
          }

          const freshDataName = idx >= 0 ? data[idx] : filename
          const dataSaverName = idx >= 0 ? dataSaver[idx] : null

          return {
            dataUrl: freshDataName ? `${base}/data/${hash}/${freshDataName}` : null,
            dataSaverUrl: dataSaverName ? `${base}/data-saver/${hash}/${dataSaverName}` : null,
          }
        }

        let imgRes = null
        const tried = new Set()

        async function tryUrl(url) {
          if (!url || tried.has(url)) return false
          tried.add(url)
          imgRes = await fetchImg(url)
          return imgRes.ok || imgRes.status !== 404
        }

        // Try up to 3 fresh at-home node assignments, alternating pools. For
        // each node, try the data URL and — critically — fall back to the
        // dataSaver URL, which has a different filename and is the path
        // mangadex.org itself serves when the full-quality file is missing.
        outer: for (const forcePort443 of [false, true, false]) {
          const { dataUrl, dataSaverUrl } = await getNodeUrls(forcePort443).catch(() => ({}))
          if (await tryUrl(dataUrl)) break outer
          if (await tryUrl(dataSaverUrl)) break outer
        }

        // Absolute last resort: try the exact URL the client reported failing on
        if ((!imgRes || imgRes.status === 404) && !tried.has(imgUrl)) {
          imgRes = await fetchImg(imgUrl)
        }

        if (!imgRes?.ok) { res.writeHead(imgRes?.status ?? 502); res.end(); return }
        const ct = imgRes.headers.get('content-type') ?? ''
        if (!ct.startsWith('image/')) { res.writeHead(415); res.end(); return }

        const corsOrigin = corsOriginFor(req)
        res.writeHead(200, {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=86400',
          ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}),
        })
        Readable.fromWeb(imgRes.body).pipe(res)
        return
      }

      // Record a completed download (authenticated, any user)
      if (seg[1] === 'activity' && seg[2] === 'download' && req.method === 'POST') {
        const payload = requireAuth(req, res)
        if (!payload) return
        const body = await readBody(req)
        if (!validateActivityPayload(body)) {
          return sendJson(res, 400, { error: 'Invalid activity payload' })
        }
        recordDownload(payload.sub, payload.username, body)
        return sendJson(res, 200, { ok: true })
      }

      // Read progress sync (authenticated, any user)
      if (seg[1] === 'progress') {
        const payload = requireAuth(req, res)
        if (!payload) return

        if (req.method === 'GET') {
          return sendJson(res, 200, { progress: getProgress(payload.sub) })
        }

        if (req.method === 'POST') {
          const body = await readBody(req)
          if (!isString(body?.chapterId, { min: 1, max: 200 }) ||
              !isString(body?.mangaId, { min: 1, max: 200 }) ||
              typeof body?.lastPage !== 'number' ||
              typeof body?.totalPages !== 'number' ||
              typeof body?.completed !== 'boolean' ||
              !isString(body?.updatedAt, { min: 1, max: 30 })) {
            return sendJson(res, 400, { error: 'Invalid progress payload' })
          }
          setProgressEntry(payload.sub, body.chapterId, {
            mangaId: body.mangaId,
            lastPage: body.lastPage,
            totalPages: body.totalPages,
            completed: body.completed,
            updatedAt: body.updatedAt,
            // Optional display metadata so the admin portal can show what's being read
            ...(isString(body.mangaTitle, { min: 1, max: 500 }) ? { mangaTitle: body.mangaTitle } : {}),
            ...(isString(body.coverUrl, { min: 1, max: 2048 }) ? { coverUrl: body.coverUrl } : {}),
            ...(typeof body.chapterNumber === 'number' && Number.isFinite(body.chapterNumber)
              ? { chapterNumber: body.chapterNumber } : {}),
          })
          return sendJson(res, 200, { ok: true })
        }

        if (req.method === 'DELETE') {
          const body = await readBody(req)
          if (isString(body?.mangaId, { min: 1, max: 200 })) {
            deleteProgressByManga(payload.sub, body.mangaId)
            return sendJson(res, 200, { ok: true })
          }
          if (isString(body?.chapterId, { min: 1, max: 200 })) {
            deleteProgressEntry(payload.sub, body.chapterId)
            return sendJson(res, 200, { ok: true })
          }
          return sendJson(res, 400, { error: 'chapterId or mangaId required' })
        }
      }

      // Record a library add / remove / fetch (authenticated, any user)
      if (seg[1] === 'activity' && seg[2] === 'library') {
        const payload = requireAuth(req, res)
        if (!payload) return
        if (req.method === 'GET') {
          const activity = getAllActivity()
          const library = activity[payload.sub]?.library ?? []
          return sendJson(res, 200, { library })
        }
        if (req.method === 'POST') {
          const body = await readBody(req)
          if (!isString(body?.mangaId, { min: 1, max: 200 }) ||
              !isString(body?.mangaTitle, { min: 0, max: 500 }) ||
              !isString(body?.coverUrl, { min: 0, max: 500 })) {
            return sendJson(res, 400, { error: 'Invalid library payload' })
          }
          recordLibraryAdd(payload.sub, payload.username, body)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          const body = await readBody(req)
          if (!isString(body?.mangaId, { min: 1, max: 200 })) {
            return sendJson(res, 400, { error: 'mangaId required' })
          }
          recordLibraryRemove(payload.sub, body.mangaId)
          return sendJson(res, 200, { ok: true })
        }
      }

      return sendJson(res, 404, { error: 'Not found' })
    }

    // ---- /admin-api (admin only) ----
    if (seg[0] === 'admin-api') {
      const admin = requireAdmin(req, res)
      if (!admin) return

      if (seg[1] === 'health' && req.method === 'GET') {
        const mem = process.memoryUsage()
        return sendJson(res, 200, {
          startedAt: SERVER_START,
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          memory: {
            usedMb: Math.round(mem.heapUsed / 1024 / 1024),
            totalMb: Math.round(mem.heapTotal / 1024 / 1024),
          },
          cacheEntries: cache.size,
          imageCacheMb: Math.round(imgCacheBytes / 1024 / 1024),
        })
      }

      // POST /admin-api/users → create a local user
      if (seg[1] === 'users' && !seg[2] && req.method === 'POST') {
        const body = await readBody(req)
        if (!isString(body?.username, { min: 1, max: 64 }) || !isString(body?.password, { min: 8, max: 72 })) {
          return sendJson(res, 400, { error: 'Username (1–64) and password (8–72) required' })
        }
        if (getUserByUsername(body.username)) {
          return sendJson(res, 409, { error: 'Username already taken' })
        }
        const id = randomUUID()
        const passwordHash = await hashPassword(body.password)
        createLocalUser(id, body.username, passwordHash, body.isAdmin === true)
        return sendJson(res, 200, { ok: true, id })
      }

      // DELETE /admin-api/users/:id → delete a user
      if (seg[1] === 'users' && seg[2] && !seg[3] && req.method === 'DELETE') {
        if (seg[2] === admin.sub) {
          return sendJson(res, 400, { error: 'Cannot delete your own account' })
        }
        deleteUser(seg[2])
        return sendJson(res, 200, { ok: true })
      }

      if (seg[1] === 'users' && seg[2] && seg[3] === 'downloads' && req.method === 'DELETE') {
        const body = await readBody(req)
        if (!isString(body?.mangaId, { min: 1, max: 200 })) {
          return sendJson(res, 400, { error: 'mangaId required' })
        }
        const removedIds = removeMangaDownloads(seg[2], body.mangaId)
        scheduleRemovals(seg[2], removedIds)
        return sendJson(res, 200, { ok: true, removed: removedIds.length })
      }

      if (seg[1] === 'users' && seg[2] && req.method === 'GET') {
        const activity = getAllActivity()
        return sendJson(res, 200, activity[seg[2]] ?? { downloads: [] })
      }

      if (seg[1] === 'users' && req.method === 'GET') {
        const users = listUsers()
        const activity = getAllActivity()
        const progressAll = getAllProgress()
        const withActivity = users.map(u => {
          const reading = aggregateReading(progressAll[u.id] ?? {}, activity[u.id])
          return {
            ...u,
            downloads: activity[u.id]?.downloads ?? [],
            downloadCount: activity[u.id]?.downloads?.length ?? 0,
            library: activity[u.id]?.library ?? [],
            libraryCount: activity[u.id]?.library?.length ?? 0,
            reading,
            readingCount: reading.length,
          }
        })
        await resolveUnknownMangaMeta(withActivity.map(u => u.reading))
        return sendJson(res, 200, withActivity)
      }

      if (seg[1] === 'announcement') {
        if (req.method === 'POST') {
          const body = await readBody(req)
          const msg = typeof body?.message === 'string' ? body.message.slice(0, 1000) : null
          setAnnouncement(msg || null)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          setAnnouncement(null)
          return sendJson(res, 200, { ok: true })
        }
      }

      if (seg[1] === 'cache' && seg[2] === 'clear' && req.method === 'POST') {
        cache.clear()
        clearImgCache()
        return sendJson(res, 200, { ok: true, cleared: true })
      }

      return sendJson(res, 404, { error: 'Not found' })
    }

    // ---- /mangapill ----
    if (seg[0] === 'mangapill') {
      let body

      if (seg[1] === 'search') {
        const q = parsed.searchParams.get('q') || ''
        if (!isString(q, { min: 1, max: 100 })) {
          return sendJson(res, 400, { error: 'invalid query' })
        }
        body = await mangapillSearch(q)
      } else if (seg[1] === 'chapters') {
        const p = parsed.searchParams.get('path') || ''
        if (!isMangaPath(p)) {
          return sendJson(res, 400, { error: 'invalid manga path' })
        }
        body = await mangapillChapters(p)
      } else if (seg[1] === 'pages') {
        const p = parsed.searchParams.get('path') || ''
        if (!isChapterPath(p)) {
          return sendJson(res, 400, { error: 'invalid chapter path' })
        }
        body = await mangapillPages(p)
      } else if (seg[1] === 'img') {
        const imageUrl = parsed.searchParams.get('url')
        if (!isSafeUrl(imageUrl)) { res.writeHead(400); res.end(); return }
        let parsedImg
        try { parsedImg = new URL(imageUrl) } catch { res.writeHead(400); res.end(); return }
        if (parsedImg.protocol !== 'https:' || !isAllowedImgHost(parsedImg.hostname)) {
          res.writeHead(403); res.end(); return
        }
        return serveProxiedImage(req, res, [parsedImg.href], 'https://mangapill.com/')
      } else {
        res.writeHead(404); res.end(); return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
      return
    }

    // ---- /goldsplit ----
    if (seg[0] === 'goldsplit') {
      let body

      if (seg[1] === 'series' && req.method === 'GET') {
        body = await goldSplitSeries()
      } else if (seg[1] === 'pages' && req.method === 'GET') {
        const p = parsed.searchParams.get('path') || ''
        if (!isGoldSplitChapterPath(p)) {
          return sendJson(res, 400, { error: 'invalid chapter path' })
        }
        body = await goldSplitPages(p.endsWith('/') ? p : `${p}/`)
      } else if (seg[1] === 'img') {
        const imageUrl = parsed.searchParams.get('url')
        if (!isSafeUrl(imageUrl)) { res.writeHead(400); res.end(); return }
        let parsedImg
        try { parsedImg = new URL(imageUrl) } catch { res.writeHead(400); res.end(); return }
        if (parsedImg.protocol !== 'https:' || !GQ_IMG_HOST_ALLOWLIST.some(re => re.test(parsedImg.hostname))) {
          res.writeHead(403); res.end(); return
        }
        // If a computed "-WxH" scaled variant doesn't exist upstream,
        // fall back to the unscaled original.
        const candidates = [parsedImg.href]
        const original = parsedImg.href.replace(/-\d+x\d+(\.(?:jpe?g|png))$/i, '$1')
        if (original !== parsedImg.href) candidates.push(original)
        return serveProxiedImage(req, res, candidates, `${GQ_ORIGIN}/`)
      } else {
        res.writeHead(404); res.end(); return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
      return
    }

    // ---- MangaDex passthrough proxies (production single-container) ----
    if (seg[0] === 'mangadex-api') {
      return proxyPassthrough(req, res, 'https://api.mangadex.org', '/mangadex-api', 'api')
    }
    if (seg[0] === 'mangadex-covers') {
      return proxyPassthrough(req, res, 'https://uploads.mangadex.org', '/mangadex-covers', 'cover')
    }

    // ---- Static frontend + SPA fallback (production single-container) ----
    if (SERVE_STATIC && req.method === 'GET') {
      // First give the OG middleware a chance to serve /manga/* with embed tags.
      await new Promise(resolve => ogServe(req, res, resolve))
      if (res.writableEnded) return
      await serveStatic(req, res)
      return
    }

    res.writeHead(404); res.end()
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return sendJson(res, 413, { error: 'Request body too large' })
    }
    console.error(`[ERR] ${err.message}`)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Upstream error' }))
  }
}).listen(PORT, () => {
  console.log(`Mangva ${SERVE_STATIC ? 'server (app + API)' : 'proxy (API only)'} → http://localhost:${PORT}`)
})
