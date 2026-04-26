import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
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
