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
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'

import { validateJellyfinCredentials, validateLocalCredentials, hashPassword, JELLYFIN_ENABLED, signToken, verifyToken, extractToken } from './server/auth.mjs'
import { upsertUser, listUsers, getAnnouncement, setAnnouncement, recordDownload, recordLibraryAdd, recordLibraryRemove, removeMangaDownloads, getAllActivity, scheduleRemovals, getPendingRemovals, clearRemovals, getUserByUsername, hasAnyAdmin, createLocalUser, deleteUser, getProgress, setProgressEntry, deleteProgressEntry, deleteProgressByManga } from './server/db.mjs'

const PORT = 3001
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
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find(p => existsSync(p))
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH env var.')
  process.exit(1)
}
console.log(`Chrome: ${chromePath}`)

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
})
console.log(`Manga proxy → http://localhost:${PORT}`)

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

// ---- Mangapill scrapers ----

async function withPage(fn) {
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
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

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
        const withActivity = users.map(u => ({
          ...u,
          downloads: activity[u.id]?.downloads ?? [],
          downloadCount: activity[u.id]?.downloads?.length ?? 0,
          library: activity[u.id]?.library ?? [],
          libraryCount: activity[u.id]?.library?.length ?? 0,
        }))
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
        const imgRes = await fetch(parsedImg.href, {
          headers: {
            'Referer': 'https://mangapill.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          redirect: 'manual',
        })
        const contentType = imgRes.headers.get('content-type') ?? ''
        if (!contentType.startsWith('image/')) {
          res.writeHead(415); res.end(); return
        }
        const corsOrigin = corsOriginFor(req)
        const headers = {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
        }
        if (corsOrigin) {
          headers['Access-Control-Allow-Origin'] = corsOrigin
          headers['Vary'] = 'Origin'
        }
        res.writeHead(imgRes.status, headers)
        const stream = Readable.fromWeb(imgRes.body)
        stream.on('error', () => res.destroy())
        res.on('close', () => stream.destroy())
        stream.pipe(res)
        return
      } else {
        res.writeHead(404); res.end(); return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(body)
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
}).listen(PORT)
