// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound } from 'next/navigation'
import CampaignsWiringDevPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn((): never => {
    throw new Error('not found')
  }),
  usePathname: () => '/dev/mobile-r2/campaigns-wiring',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('/dev/mobile-r2/campaigns-wiring 하네스', () => {
  it('운영에서는 404 다', () => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => CampaignsWiringDevPage()).toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })
})
