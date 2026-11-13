import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    'process.env.NEXT_PUBLIC_SOHEE_BUILD_SHA': JSON.stringify('development'),
    'process.env': JSON.stringify({
      NODE_ENV: 'development',
      NEXT_PUBLIC_SOHEE_BUILD_SHA: 'development',
    }),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../../src', import.meta.url)),
      'next/link': fileURLToPath(new URL('./mocks/link.tsx', import.meta.url)),
      'next/navigation': fileURLToPath(new URL('./mocks/navigation.ts', import.meta.url)),
      'next/image': fileURLToPath(new URL('./mocks/image.tsx', import.meta.url)),
    },
  },
  server: {
    port: 3193,
    strictPort: true,
  },
})
