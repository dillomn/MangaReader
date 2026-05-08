// MangaReader Service Worker — caches MangaDex CDN images so that once a page
// has loaded successfully (from anywhere) it survives later CDN backend
// evictions. mangadex.org uses the same trick to keep chapters readable.

const CACHE = 'mangadex-pages-v4.5'
const CDN_RE = /^https:\/\/[a-z0-9-]+\.mangadex\.network\/(?:data|data-saver)\/[a-f0-9]+\/[^/?#]+$/

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Cache key normalises across at-home nodes: the hostname rotates per session
// (forcePort443, fresh at-home calls) but /data/HASH/FILENAME identifies a page
// uniquely. Stripping the hostname lets cache hits survive node rotation.
function cacheKey(url) {
  const u = new URL(url)
  return `https://manga-cache.local${u.pathname}`
}

self.addEventListener('fetch', event => {
  const url = event.request.url
  if (!CDN_RE.test(url)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const key = cacheKey(url)

    // Cache-first: if we've ever loaded this page successfully before, serve
    // it instantly and skip the network entirely. Crucial for pages the CDN
    // has since lost — the cached copy is the only working copy.
    const hit = await cache.match(key)
    if (hit) return hit

    // Cache miss → real network fetch
    try {
      const res = await fetch(event.request)
      const ct = res.headers.get('content-type') || ''
      if (res.ok && ct.startsWith('image/')) {
        // clone() is required because the response body can only be consumed once
        cache.put(key, res.clone()).catch(() => {})
      }
      return res
    } catch (err) {
      // Network totally failed — nothing in cache, nothing to give
      return Response.error()
    }
  })())
})
