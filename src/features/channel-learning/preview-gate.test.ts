import { describe, expect, it } from 'vitest'
import { isLearningPreviewAllowed } from './preview-gate'

describe('local learning preview isolation', () => {
  const local = { nodeEnv: 'development', enabled: '1', supabaseUrl: 'http://127.0.0.1:54321', host: 'localhost:3195' }
  it('allows only explicitly enabled local development backed by loopback data', () => {
    expect(isLearningPreviewAllowed(local)).toBe(true)
    expect(isLearningPreviewAllowed({ ...local, nodeEnv: 'production' })).toBe(false)
    expect(isLearningPreviewAllowed({ ...local, enabled: undefined })).toBe(false)
    expect(isLearningPreviewAllowed({ ...local, supabaseUrl: 'https://your-project-ref.supabase.co' })).toBe(false)
    expect(isLearningPreviewAllowed({ ...local, host: 'm.example.com' })).toBe(false)
    expect(isLearningPreviewAllowed({ ...local, host: 'localhost.evil.test:3195' })).toBe(false)
    expect(isLearningPreviewAllowed({ ...local, host: 'localhost:3195@evil.test' })).toBe(false)
  })
})
