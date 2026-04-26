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
      },
      '/mangadex-covers': {
        target: 'https://uploads.mangadex.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mangadex-covers/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('referer')
            proxyReq.removeHeader('origin')
          })
        },
      },
      '/mangapill': {
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
