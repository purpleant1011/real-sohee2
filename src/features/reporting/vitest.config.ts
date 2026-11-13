import { mergeConfig } from 'vitest/config'
import base from '../../../vitest.config'

// Keep test caches inside this worktree even when dependencies are shared read-only.
export default mergeConfig(base, {
  cacheDir: '.next/reporting-vitest-cache',
  test: {
    maxWorkers: 1,
    fileParallelism: false,
  },
})
