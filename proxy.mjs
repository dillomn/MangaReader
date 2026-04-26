/**
 * Local manga proxy — run with: npm run proxy
 * Uses puppeteer-core + existing Chrome to scrape Mangapill.
 *
 * Routes:
 *   GET /mangapill/search?q=...        Search for manga
 *   GET /mangapill/chapters?path=...   Chapter list for a manga path (e.g. /manga/123-gantz)
 *   GET /mangapill/pages?path=...      Image URLs for a chapter path (e.g. /chapters/456-10000)
 *   GET /mangapill/img?url=...         Proxy a CDN image (adds correct Referer header)
 */
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { Readable } from 'node:stream'

const PORT = 3001
const CACHE_TTL_MS = 5 * 60 * 1000
const MP_ORIGIN = 'https://mangapill.com'

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

// ---- Mangapill: search ----

async function mangapillSearch(q) {
  const key = `mp:search:${q}`
  const hit = getCache(key)
  if (hit) { console.log(`[CACHE] search ${q}`); return hit }

  const url = `${MP_ORIGIN}/search?q=${encodeURIComponent(q)}&type=&status=`
  console.log(`[MP-SEARCH] ${url}`)

  const body = await withPage(async page => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Diagnostic: see what the page actually contains
    const debug = await page.evaluate(() => ({
      title: document.title,
      bodyStart: document.body?.innerText?.slice(0, 150),
      allHrefs: Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(a => a.getAttribute('href')),
    }))
    console.log(`[MP-SEARCH-DEBUG] title="${debug.title}"`)
    console.log(`[MP-SEARCH-DEBUG] body="${debug.bodyStart}"`)
    console.log(`[MP-SEARCH-DEBUG] hrefs=${JSON.stringify(debug.allHrefs)}`)

    const results = await page.evaluate(() => {
      // Each result has TWO links with the same href: image link (no text) + title link (has text).
      // Use a Map so the second pass can fill in the title the first pass missed.
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
      // Last resort: derive title from URL slug (/manga/1336/gantz → "Gantz")
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

// ---- Mangapill: chapter list ----

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
        // URL code encodes volume: (vol * 10000 + chap) * 1000, e.g. 10001000 = vol 1 ch 1
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

// ---- Mangapill: chapter pages ----

async function mangapillPages(chapterPath) {
  const key = `mp:pages:${chapterPath}`
  const hit = getCache(key, 60 * 60 * 1000)
  if (hit) { console.log(`[CACHE] pages ${chapterPath}`); return hit }

  const url = `${MP_ORIGIN}${chapterPath}`
  console.log(`[MP-PAGES] ${url}`)

  const body = await withPage(async page => {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    const images = await page.evaluate(() => {
      // Mangapill wraps pages in <picture><img data-src="..."></picture>
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const parsed = new URL(req.url ?? '/', 'http://localhost')
  const seg = parsed.pathname.split('/').filter(Boolean)

  if (seg[0] !== 'mangapill') { res.writeHead(404); res.end(); return }

  try {
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
      // If the browser closes the connection mid-stream, destroy quietly instead of crashing
      stream.on('error', () => res.destroy())
      res.on('close', () => stream.destroy())
      stream.pipe(res)
      return
    } else {
      res.writeHead(404); res.end(); return
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(body)
  } catch (err) {
    console.error(`[ERR] ${err.message}`)
    res.writeHead(502)
    res.end(JSON.stringify({ error: err.message }))
  }
}).listen(PORT)
