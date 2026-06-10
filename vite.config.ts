import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error — plain .mjs module without type declarations
import { createOgMiddleware } from './server/ogMeta.mjs'

const INDEX_HTML = fileURLToPath(new URL('./index.html', import.meta.url))
const DIST_INDEX_HTML = fileURLToPath(new URL('./dist/index.html', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      // Discord/Slack/etc. link embeds: serve /manga/* HTML with og:* tags
      // describing the manga (title, cover, chapter) — crawlers don't run JS.
      name: 'og-meta',
      configureServer(server) {
        server.middlewares.use(createOgMiddleware(
          (_req: unknown, pathname: string) =>
            server.transformIndexHtml(pathname, readFileSync(INDEX_HTML, 'utf8')),
        ))
      },
      configurePreviewServer(server) {
        server.middlewares.use(createOgMiddleware(
          () => readFileSync(DIST_INDEX_HTML, 'utf8'),
        ))
      },
    },
    {
      name: 'no-cache-html-sw',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0]

          // Block direct browser navigation to source files — Vite still serves
          // them for HMR module imports (sec-fetch-mode: cors/no-cors/same-origin)
          // but navigating directly in the browser has sec-fetch-mode: navigate.
          const isNavigation = req.headers['sec-fetch-mode'] === 'navigate'
            || (req.headers['accept'] ?? '').startsWith('text/html')
          if (isNavigation && url?.startsWith('/src/')) {
            res.writeHead(403, { 'Content-Type': 'text/plain' })
            res.end('Forbidden')
            return
          }

          if (url === '/sw.js' || url === '/' || url === '/index.html') {
            res.setHeader('Cache-Control', 'no-store')
          }
          next()
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/mangadex-api': {
        target: 'https://api.mangadex.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mangadex-api/, ''),
        configure: (proxy) => {
          // MangaDex rejects requests containing a Via header (no non-transparent proxies)
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('via')
          })
        },
      },
      '/mangadex-covers': {
        target: 'https://uploads.mangadex.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mangadex-covers/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('referer')
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('via')
          })
        },
      },
      '/mangapill': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/goldsplit': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
      '/admin-api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
  build: {
    // jsPDF + html2canvas are large but only load on user demand via dynamic import
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-libs': ['jspdf', 'jszip'],
        },
      },
    },
  },
})
