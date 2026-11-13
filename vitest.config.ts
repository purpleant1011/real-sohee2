import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// DB 통합 테스트는 격리 PostgreSQL 하네스(npm run test:vault-db / test:tenant-isolation)가
// PGDATABASE 를 설정할 때만 실행한다. 일반 `vitest run` 에서는 DB 가 없어 항상 실패하므로 제외한다.
const DB_BACKED_TESTS = process.env.PGDATABASE
  ? []
  : ['tests/integration/vault/**', 'tests/integration/tenant-isolation/**', 'tests/integration/chat-rls/**', 'tests/integration/local-publish-dispatch/**', 'tests/integration/naver-post-jobs/**', 'tests/integration/naver-categories/**', 'tests/integration/booking-recovery/**']

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    maxConcurrency: 4,
    maxWorkers: 4,
    exclude: [
      ...configDefaults.exclude,
      '.worktrees/**',
      '.claude/worktrees/**',
      'tests/e2e/**',
      ...DB_BACKED_TESTS,
      'src/test/integration/**/*.remote.test.ts',
      'src/test/live/**/*.live.test.ts',
      'scripts/verify-local-publish-release.test.mjs',
      'scripts/verify-local-publish-spike.test.mjs',
    ],
  },
})
