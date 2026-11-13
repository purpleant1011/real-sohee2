import { afterEach, expect, it, vi } from 'vitest'
import WorkListWiringDevPage from './page'

vi.mock('next/navigation', () => ({ notFound: (): never => { throw new Error('not found') } }))
afterEach(() => vi.unstubAllEnvs())
it('does not expose the work-list request harness in production', () => {
  vi.stubEnv('NODE_ENV', 'production')
  expect(() => WorkListWiringDevPage()).toThrow('not found')
})
