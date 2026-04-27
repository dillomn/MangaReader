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

import { validateJellyfinCredentials, signToken, verifyToken, extractToken } from './server/auth.mjs'
import { upsertUser, listUsers, getAnnouncement, setAnnouncement, recordDownload, removeMangaDownloads, getAllActivity, scheduleRemovals, getPendingRemovals, clearRemovals } from './server/db.mjs'

const PORT = 3001
const CACHE_TTL_MS = 5 * 60 * 1000
const MP_ORIGIN = 'https://mangapill.com'
const SERVER_START = new Date().toISOString()

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

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
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
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
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
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsed = new URL(req.url ?? '/', 'http://localhost')
  const seg = parsed.pathname.split('/').filter(Boolean)

  try {

    // ---- /auth ----
    if (seg[0] === 'auth') {
      if (seg[1] === 'login' && req.method === 'POST') {
        const body = await readBody(req)
        if (!body.username || !body.password) {
          return sendJson(res, 400, { error: 'username and password required' })
        }
        const user = await validateJellyfinCredentials(body.username, body.password)
        if (!user) return sendJson(res, 401, { error: 'Invalid Jellyfin credentials' })

        upsertUser(user.id, user.username, user.isAdmin)
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
        clearRemovals(payload.sub, body.chapterIds ?? [])
        return sendJson(res, 200, { ok: true })
      }

      // Record a completed download (authenticated, any user)
      if (seg[1] === 'activity' && seg[2] === 'download' && req.method === 'POST') {
        const payload = requireAuth(req, res)
        if (!payload) return
        const body = await readBody(req)
        recordDownload(payload.sub, payload.username, body)
        return sendJson(res, 200, { ok: true })
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

      if (seg[1] === 'users' && seg[2] && seg[3] === 'downloads' && req.method === 'DELETE') {
        const body = await readBody(req)
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
        }))
        return sendJson(res, 200, withActivity)
      }

      if (seg[1] === 'announcement') {
        if (req.method === 'POST') {
          const body = await readBody(req)
          setAnnouncement(body.message || null)
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
        body = await mangapillSearch(parsed.searchParams.get('q') || '')
      } else if (seg[1] === 'chapters') {
        body = await mangapillChapters(parsed.searchParams.get('path') || '')
      } else if (seg[1] === 'pages') {
        body = await mangapillPages(parsed.searchParams.get('path') || '')
      } else if (seg[1] === 'img') {
        const imageUrl = parsed.searchParams.get('url')
        if (!imageUrl) { res.writeHead(400); res.end(); return }
        const imgRes = await fetch(imageUrl, {
          headers: {
            'Referer': 'https://mangapill.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        })
        res.writeHead(imgRes.status, {
          'Content-Type': imgRes.headers.get('content-type') ?? 'image/jpeg',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        })
        const stream = Readable.fromWeb(imgRes.body)
        stream.on('error', () => res.destroy())
        res.on('close', () => stream.destroy())
        stream.pipe(res)
        return
      } else {
        res.writeHead(404); res.end(); return
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
      return
    }

    res.writeHead(404); res.end()
  } catch (err) {
    console.error(`[ERR] ${err.message}`)
    res.writeHead(502)
    res.end(JSON.stringify({ error: err.message }))
  }
}).listen(PORT)
