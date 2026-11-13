import { describe, expect, it, vi } from 'vitest'

const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }))
vi.mock('next/navigation', () => ({
  notFound,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('./actions', () => ({
  loginWithReviewCredentials: vi.fn(),
  exitReviewMode: vi.fn(),
  checkReviewModeStatus: vi.fn(),
}))

import AdminPreviewPage, { dynamic } from './page'

describe('AdminPreviewPage', () => {
  it('enforces force-dynamic to prevent Cloudflare asset 405 blocking', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  it('is permanently disabled: review passes can no longer authorize operator access (ANI-1564)', () => {
    expect(() => AdminPreviewPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalled()
  })
})
