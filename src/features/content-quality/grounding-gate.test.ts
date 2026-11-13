import { describe, expect, it } from 'vitest'
import { evaluateGrounding } from './grounding-gate'

describe('content grounding gate', () => {
  it('blocks an unsupported first-person experience claim without exposing the claim text', () => {
    const result = evaluateGrounding({ text: '제가 직접 3주 동안 사용해 봤어요.', approvedFacts: [], firstPartyEvidence: false })
    expect(result).toEqual({ decision: 'blocked', issues: [{ code: 'UNVERIFIED_EXPERIENCE', evidenceIds: [] }], shouldRetryProvider: false })
    expect(JSON.stringify(result)).not.toContain('직접')
  })

  it('requires review for a precise claim with no approved evidence reference', () => {
    expect(evaluateGrounding({ text: '월 39,000원으로 30일 안에 효과가 납니다.', approvedFacts: [], firstPartyEvidence: false })).toEqual({ decision: 'review_required', issues: [{ code: 'UNSUPPORTED_PRECISION', evidenceIds: [] }], shouldRetryProvider: false })
  })

  it('passes grounded facts and never asks a provider to regenerate automatically', () => {
    expect(evaluateGrounding({ text: '승인된 가격은 월 39,000원입니다.', approvedFacts: [{ id: 'fact-price', text: '월 39,000원' }], firstPartyEvidence: false })).toEqual({ decision: 'pass', issues: [], shouldRetryProvider: false })
  })
})
