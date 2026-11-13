import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ delete: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ delete: mocks.delete })) }))

import { clearReviewPassCookie, isReviewModeAllowed, isReviewPassActive, REVIEW_COOKIE_NAME } from './review-mode'

describe('retired review mode', () => {
  it('never authorizes a preview session', async () => {
    expect(isReviewModeAllowed()).toBe(false)
    await expect(isReviewPassActive()).resolves.toBe(false)
  })

  it('expires the historical review cookie', async () => {
    await clearReviewPassCookie()
    expect(mocks.delete).toHaveBeenCalledWith(REVIEW_COOKIE_NAME)
  })
})
