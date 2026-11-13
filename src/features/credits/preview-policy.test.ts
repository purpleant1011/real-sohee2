import { expect, it } from 'vitest'
import { v08PreviewCreditPolicy } from './preview-policy'

it('labels the V0.8 allowance as a token-based 2000-credit test policy', () => {
  expect(v08PreviewCreditPolicy).toEqual({
    version: 'v08-test-2000-1',
    label: 'V0.8 토큰 기반 테스트 정책',
    policyStatus: 'test',
    timezone: 'Asia/Seoul',
    weeklyPreviewAllowanceCredits: 2000,
    commercialIncludedCredits: null,
  })
})
