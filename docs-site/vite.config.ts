import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Asset/router base path:
 * - Docker/API mount: `/guide/` (default)
 * - GitHub Pages project site: `/zapo-rest/` via DOCS_BASE env in CI
 */
const base = process.env.DOCS_BASE || '/guide/'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: base.endsWith('/') ? base : `${base}/`,
  server: {
    port: 5174,
    proxy: {
      '/v1': 'http://127.0.0.1:3000',
      '/docs': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

