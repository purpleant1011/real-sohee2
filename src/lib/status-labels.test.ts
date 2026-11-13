import { describe, expect, it } from 'vitest'
import { toKoreanStatus } from './status-labels'

describe('toKoreanStatus', () => {
  it('translates in_review to the approval waiting label', () => {
    expect(toKoreanStatus('in_review')).toBe('승인 대기')
  })

  it('does not expose an unknown raw status to a user', () => {
    expect(toKoreanStatus('provider_internal_failure')).toBe('상태 확인 필요')
  })
})
