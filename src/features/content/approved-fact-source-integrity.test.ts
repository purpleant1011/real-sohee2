import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { FactProvenanceItem } from './approved-fact-basis'
import { assertProvenanceSourceIntegrity, findProvenanceSourceMismatches } from './approved-fact-source-integrity'

const span = '월-금 10:00 ~ 20:00 영업'
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const at = '2026-10-28T10:00:00.000Z'
const item = (over: Partial<FactProvenanceItem> = {}): FactProvenanceItem => ({
  factId: 'fact-1', sourceType: 'owner_approved_fact', capturedAt: at, sourceSpan: span,
  sourceHash: sha(span), validity: 'active',
  ownerApproval: { approvedByUserId: 'owner-1', approvedAt: at }, claimCategory: 'business_info', ...over,
})

describe('ANI-1896: 원문 해시 결속', () => {
  it('sourceSpan의 SHA-256과 sourceHash가 같으면 통과한다', () => {
    expect(findProvenanceSourceMismatches([item()])).toEqual([])
    expect(() => assertProvenanceSourceIntegrity([item()])).not.toThrow()
  })

  it('원문을 바꿔치기한(해시가 다른) 인용은 사실로 쓸 수 없다', () => {
    const forged = item({ sourceSpan: '전 메뉴 50% 할인' })
    expect(findProvenanceSourceMismatches([forged])).toEqual(['fact-1'])
    expect(() => assertProvenanceSourceIntegrity([forged])).toThrow('PROVENANCE_SOURCE_HASH_MISMATCH')
  })

  it('임의 문자열 해시(원문 없는 인용)는 거부한다', () => {
    expect(findProvenanceSourceMismatches([item({ sourceHash: 'a'.repeat(64) })])).toEqual(['fact-1'])
  })
})
