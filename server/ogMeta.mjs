/**
 * Open Graph meta-tag injection for shared manga links.
 *
 * Discord (and other chat apps) fetch the URL server-side to build link
 * embeds — they never run the SPA's JavaScript, so the manga title, cover
 * and chapter must be present in the initial HTML. This middleware
 * intercepts navigations to /manga/:id and /manga/:id/chapter/:chapterId,
 * looks up the manga's metadata, and injects og:* tags into index.html.
 *
 * Used by the Vite dev server (which also serves the app in production
 * behind the Cloudflare Tunnel) via the plugin in vite.config.ts.
 */

const MANGA_ROUTE_RE = /^\/manga\/([^/]+)(?:\/chapter\/([^/]+))?\/?$/
const UUID_RE = /^[0-9a-f-]{36}$/
const GOLDSPLIT_SERIES_URL = `http://127.0.0.1:${process.env.PORT || 3001}/goldsplit/series`

const META_TTL_MS = 5 * 60 * 1000
const metaCache = new Map() // pathname → { ts, tags: string | null }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(s, max = 300) {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mangva/1.0 (self-hosted manga reader)' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`${res.status}: ${url}`)
  return res.json()
}

// → { title, description, imageUrl } or null when the manga can't be resolved
async function getMangaMeta(mangaId) {
  if (mangaId === 'goldsplit') {
    const s = await fetchJson(GOLDSPLIT_SERIES_URL)
    return { title: s.title, description: s.synopsis ?? '', imageUrl: s.coverUrl ?? '' }
  }
  if (!UUID_RE.test(mangaId)) return null
  const d = await fetchJson(`https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art`)
  const attrs = d.data?.attributes
  if (!attrs) return null
  const title = attrs.title?.en
    ?? attrs.altTitles?.find(t => 'en' in t)?.en
    ?? Object.values(attrs.title ?? {})[0]
    ?? 'Unknown'
  const coverFile = d.data.relationships?.find(r => r.type === 'cover_art')?.attributes?.fileName
  return {
    title,
    description: attrs.description?.en ?? '',
    // Absolute uploads.mangadex.org URL so Discord can fetch it without auth
    imageUrl: coverFile ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFile}.512.jpg` : '',
  }
}

// → chapter number as a string, or null when unknown
async function getChapterNumber(chapterId) {
  // Mangapill/Gold Split chapter ids embed the number in the slug,
  // e.g. "goldsplit:/2025/04/21/gold-split-chapter-1/"
  const slugMatch = chapterId.match(/chapter-(\d+(?:\.\d+)?)/i)
  if (slugMatch) return slugMatch[1]
  if (!UUID_RE.test(chapterId)) return null
  const d = await fetchJson(`https://api.mangadex.org/chapter/${chapterId}`)
  return d.data?.attributes?.chapter ?? null
}

async function buildOgTags(pathname, origin) {
  const m = pathname.match(MANGA_ROUTE_RE)
  if (!m) return null
  const mangaId = decodeURIComponent(m[1])
  const chapterId = m[2] ? decodeURIComponent(m[2]) : null

  const meta = await getMangaMeta(mangaId)
  if (!meta) return null

  let title = meta.title
  if (chapterId) {
    const num = await getChapterNumber(chapterId).catch(() => null)
    if (num) title = `${meta.title} — Chapter ${num}`
  }

  const tags = [
    `<meta property="og:site_name" content="Mangva" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:url" content="${escapeHtml(origin + pathname)}" />`,
    meta.description && `<meta property="og:description" content="${escapeHtml(truncate(meta.description))}" />`,
    meta.imageUrl && `<meta property="og:image" content="${escapeHtml(meta.imageUrl)}" />`,
    `<meta name="theme-color" content="#e0315b" />`,
  ].filter(Boolean)

  return `    ${tags.join('\n    ')}\n  `
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim()
    ?? 'http'
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim()
    ?? req.headers.host
    ?? 'localhost'
  return `${proto}://${host}`
}

/**
 * Connect-style middleware. `getIndexHtml(req, pathname)` must return the
 * (already transformed, for dev) index.html string to inject into.
 */
export function createOgMiddleware(getIndexHtml) {
  return async function ogMiddleware(req, res, next) {
    const pathname = (req.url ?? '/').split('?')[0]
    if (req.method !== 'GET' || !MANGA_ROUTE_RE.test(pathname)) return next()

    try {
      let cached = metaCache.get(pathname)
      if (!cached || Date.now() - cached.ts > META_TTL_MS) {
        cached = { ts: Date.now(), tags: await buildOgTags(pathname, requestOrigin(req)) }
        metaCache.set(pathname, cached)
      }
      if (!cached.tags) return next()

      const html = await getIndexHtml(req, pathname)
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
      res.end(html.replace('</head>', `${cached.tags}</head>`))
    } catch {
      next()
    }
  }
}
