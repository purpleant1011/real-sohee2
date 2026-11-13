import { describe, expect, it } from 'vitest'
import { isReviewModeAllowed, isReviewPassActive } from '../review-mode'

describe('retired administrator preview authorization', () => {
  it('cannot enable review access in any environment', async () => {
    expect(isReviewModeAllowed()).toBe(false)
    await expect(isReviewPassActive()).resolves.toBe(false)
  })
})
