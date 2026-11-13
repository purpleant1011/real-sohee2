import { describe, expect, it } from 'vitest'

import { externalActionStatusCopy, externalFailureRecoveryCopy } from './external-action-status-copy'

describe('external action screen copy contract', () => {
  it('keeps provider submission, review, verified result, and manual assist distinct', () => {
    expect(externalActionStatusCopy.submitted.detail).toContain('반영 완료')
    expect(externalActionStatusCopy.provider_review.label).toBe('외부에서 검토 중이에요')
    expect(externalActionStatusCopy.succeeded.label).toBe('외부 결과를 확인했어요')
    expect(externalActionStatusCopy.manual_assist_required.detail).toContain('자동 게시 완료')
  })

  it('gives a safe next action for every stop code', () => {
    expect(externalFailureRecoveryCopy.BROKER_UNAVAILABLE).toMatchObject({
      nextAction: '수동 마무리 열기',
    })
    expect(externalFailureRecoveryCopy.UNKNOWN_RESULT.detail).toContain('중복 실행하지 마세요')
  })
})
