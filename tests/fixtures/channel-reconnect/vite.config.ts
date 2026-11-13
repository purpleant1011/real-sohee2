import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../../src', import.meta.url)),
      'next/link': fileURLToPath(new URL('../firstpost-web/link.tsx', import.meta.url)),
    },
  },
  server: { port: 3197, strictPort: true },
})
