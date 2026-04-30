import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
