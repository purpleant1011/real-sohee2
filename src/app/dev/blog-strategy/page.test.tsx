import { afterEach, describe, expect, it, vi } from 'vitest'
import BlogStrategyDevPage from './page'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') } }))
afterEach(() => vi.unstubAllEnvs())
describe('blog strategy development preview gate', () => {
  it('is not accessible in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => BlogStrategyDevPage()).toThrow('NOT_FOUND')
  })
  it('exposes a labelled test-only preview in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(BlogStrategyDevPage().props.children[0].props.children).toContain('테스트 전용')
  })
})
