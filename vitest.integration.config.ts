import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/test/integration/**/*.remote.test.ts',
      'tests/integration/**/*.remote.test.ts',
    ],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },

})
