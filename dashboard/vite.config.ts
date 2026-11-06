import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Point the dev proxy elsewhere when :3000 is taken, e.g. API_PROXY_TARGET=http://127.0.0.1:3100
const api = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: api,
        changeOrigin: true,
        ws: true,
      },
      '/health': api,
      '/ready': api,
      '/docs': api,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
