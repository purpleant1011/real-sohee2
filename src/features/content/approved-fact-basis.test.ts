import { describe, expect, it } from 'vitest'
import {
  approvedFactBasisSchema,
  factProvenanceItemSchema,
  validateFactClaimGate,
  type FactProvenanceItem,
} from './approved-fact-basis'

describe('ANI-1896: Business+Blog 사실/근거 출처 계약 및 Claim Gate', () => {
  const validSha256 = 'a'.repeat(64)
  const validWorkspaceId = '00000000-0000-4000-8000-000000000001'
  const validIsoDate = '2026-10-28T10:00:00.000Z'

  const sampleOwnerFact: FactProvenanceItem = {
    factId: 'fact-hours-01',
    sourceType: 'owner_approved_fact',
    capturedAt: validIsoDate,
    sourceSpan: '월-금 10:00 ~ 20:00 영업',
    sourceHash: validSha256,
    validity: 'active',
    ownerApproval: {
      approvedByUserId: 'user-owner-01',
      approvedAt: validIsoDate,
    },
    claimCategory: 'business_info',
  }

  describe('factProvenanceItemSchema 유효성', () => {
    it('소유자가 승인한 정상적인 영업 정보 출처 아이템을 통과시킨다', () => {
      const parsed = factProvenanceItemSchema.safeParse(sampleOwnerFact)
      expect(parsed.success).toBe(true)
    })

    it('source_type이 user_utterance인 경우 owner_approval이 없어도 통과할 수 있다', () => {
      const utterance: FactProvenanceItem = {
        factId: 'utterance-01',
        sourceType: 'user_utterance',
        capturedAt: validIsoDate,
        sourceSpan: '저희 매장은 1:1 맞춤 예약제로 운영해요',
        sourceHash: validSha256,
        validity: 'active',
        ownerApproval: null,
        claimCategory: 'business_info',
      }
      const parsed = factProvenanceItemSchema.safeParse(utterance)
      expect(parsed.success).toBe(true)
    })

    it('owner_approved_fact인데 ownerApproval이 누락되면 스키마에서 거부한다', () => {
      const unapproved = {
        ...sampleOwnerFact,
        ownerApproval: null,
      }
      const parsed = factProvenanceItemSchema.safeParse(unapproved)
      expect(parsed.success).toBe(false)
    })
  })

  describe('validateFactClaimGate - 출처 없는 quote 및 허위/과장 주장 차단 (Fail-Closed)', () => {
    it('원문(sourceSpan)이 비어 있거나 없는 인용/주장은 사실로 승격될 수 없다', () => {
      const emptySpan: FactProvenanceItem = {
        ...sampleOwnerFact,
        sourceSpan: '   ',
      }
      const gateResult = validateFactClaimGate(emptySpan)
      expect(gateResult.allowed).toBe(false)
      expect(gateResult.reason).toBe('EMPTY_SOURCE_SPAN')
    })

    it('시술 효과/치료 효능(procedure_effect)을 입증된 사실로 사용하는 경우 fail-closed 차단한다', () => {
      const medicalClaim: FactProvenanceItem = {
        ...sampleOwnerFact,
        claimCategory: 'procedure_effect',
        sourceSpan: '1회 시술만으로 여드름 100% 완치 및 모공 축소 보장',
      }
      const gateResult = validateFactClaimGate(medicalClaim)
      expect(gateResult.allowed).toBe(false)
      expect(gateResult.reason).toBe('UNVERIFIED_PROCEDURE_EFFECT')
    })

    it('실재가 없는 고객 후기(customer_review)나 가공된 방문 경험(experience_testimony)을 사실로 사용하면 차단한다', () => {
      const fakeReview: FactProvenanceItem = {
        ...sampleOwnerFact,
        claimCategory: 'customer_review',
        sourceSpan: '다녀왔는데 원장님이 너무 친절하고 피부가 도자기처럼 변했어요!',
      }
      const gateResult = validateFactClaimGate(fakeReview)
      expect(gateResult.allowed).toBe(false)
      expect(gateResult.reason).toBe('FORBIDDEN_TESTIMONY_AS_FACT')

      const fakeExperience: FactProvenanceItem = {
        ...sampleOwnerFact,
        claimCategory: 'experience_testimony',
        sourceSpan: '직접 내돈내산으로 받아본 솔직 후기입니다.',
      }
      const expResult = validateFactClaimGate(fakeExperience)
      expect(expResult.allowed).toBe(false)
      expect(expResult.reason).toBe('FORBIDDEN_TESTIMONY_AS_FACT')
    })

    it('AI 가설(ai_hypothesis)은 검증 및 소유자 승인 없이 사실로 사용될 수 없다', () => {
      const aiHypothesis: FactProvenanceItem = {
        factId: 'ai-01',
        sourceType: 'ai_hypothesis',
        capturedAt: validIsoDate,
        sourceSpan: '바이름 뷰티 살롱은 30대 직장인 고객이 가장 많을 것으로 추정됨',
        sourceHash: validSha256,
        validity: 'active',
        ownerApproval: null,
        claimCategory: 'business_info',
      }
      const gateResult = validateFactClaimGate(aiHypothesis)
      expect(gateResult.allowed).toBe(false)
      expect(gateResult.reason).toBe('AI_HYPOTHESIS_CANNOT_BE_FACT')
    })

    it.each(['deprecated', 'superseded'] as const)('유효하지 않은 %s 출처는 사실로 사용할 수 없다', validity => {
      expect(validateFactClaimGate({ ...sampleOwnerFact, validity })).toEqual({
        allowed: false, reason: 'INACTIVE_SOURCE',
      })
    })

    it.each(['deprecated', 'superseded'] as const)('FactBasis도 %s 출처를 거부한다', validity => {
      const result = approvedFactBasisSchema.safeParse({
        workspaceId: validWorkspaceId,
        snapshotHash: validSha256,
        resolvedAt: validIsoDate,
        sources: [],
        provenance: [{ ...sampleOwnerFact, validity }],
      })
      expect(result.success).toBe(false)
    })

    it('정상적인 가격 및 영업정보는 소유자 승인 시 게이트를 통과한다', () => {
      const legitimateFact: FactProvenanceItem = {
        ...sampleOwnerFact,
        claimCategory: 'pricing',
        sourceSpan: '기본 보습 케어 60분: 50,000원',
      }
      const gateResult = validateFactClaimGate(legitimateFact)
      expect(gateResult.allowed).toBe(true)
      expect(gateResult.reason).toBeUndefined()
    })
  })

  describe('승인 출처 계보 무결성', () => {
    const basis = {
      workspaceId: validWorkspaceId,
      snapshotHash: validSha256,
      resolvedAt: validIsoDate,
      sources: [{ factId: sampleOwnerFact.factId, sourceCandidateId: 'cand-01', approvedAt: validIsoDate }],
      provenance: [sampleOwnerFact],
    }

    it('sources에 없는 사실의 provenance를 승인 근거로 붙일 수 없다', () => {
      expect(approvedFactBasisSchema.safeParse({ ...basis, sources: [] }).success).toBe(false)
    })

    it('동일 사실 ID의 서로 다른 출처를 중복 등록할 수 없다', () => {
      expect(approvedFactBasisSchema.safeParse({
        ...basis, sources: [...basis.sources, { ...basis.sources[0], sourceCandidateId: 'cand-other' }],
      }).success).toBe(false)
    })

    it('동일 사실의 provenance를 중복 등록할 수 없다', () => {
      expect(approvedFactBasisSchema.safeParse({ ...basis, provenance: [sampleOwnerFact, sampleOwnerFact] }).success).toBe(false)
    })

    it('승인 시각이 sources와 다르면 거부한다', () => {
      expect(approvedFactBasisSchema.safeParse({
        ...basis, provenance: [{ ...sampleOwnerFact, ownerApproval: { ...sampleOwnerFact.ownerApproval!, approvedAt: '2026-10-27T10:00:00.000Z' } }],
      }).success).toBe(false)
    })

    it('같은 승인 시각의 다른 시간대 표현은 허용한다', () => {
      expect(approvedFactBasisSchema.safeParse({
        ...basis, provenance: [{ ...sampleOwnerFact, ownerApproval: { ...sampleOwnerFact.ownerApproval!, approvedAt: '2026-10-28T19:00:00.000+09:00' } }],
      }).success).toBe(true)
    })

    it('provenance가 없는 기존 저장 버전은 계속 파싱한다', () => {
      const legacyBasis = {
        workspaceId: basis.workspaceId,
        snapshotHash: basis.snapshotHash,
        resolvedAt: basis.resolvedAt,
        sources: basis.sources,
      }
      expect(approvedFactBasisSchema.safeParse(legacyBasis).success).toBe(true)
    })

    it('스키마를 우회한 미승인 소유자 사실도 claim gate에서 거부한다', () => {
      expect(validateFactClaimGate({ ...sampleOwnerFact, ownerApproval: null })).toEqual({
        allowed: false, reason: 'OWNER_APPROVAL_REQUIRED',
      })
    })
  })

  describe('approvedFactBasisSchema 통합 검증', () => {
    it('확장된 provenance 목록을 포함한 approvedFactBasis가 정상 파싱된다', () => {
      const basis = {
        workspaceId: validWorkspaceId,
        snapshotHash: validSha256,
        resolvedAt: validIsoDate,
        sources: [
          {
            factId: sampleOwnerFact.factId,
            sourceCandidateId: 'cand-01',
            approvedAt: validIsoDate,
          },
        ],
        provenance: [sampleOwnerFact],
      }
      const parsed = approvedFactBasisSchema.safeParse(basis)
      expect(parsed.success).toBe(true)
    })

    it('provenance 내에 Claim Gate를 위반하는 항목이 있으면 전체 FactBasis가 유효하지 않다', () => {
      const invalidBasis = {
        workspaceId: validWorkspaceId,
        snapshotHash: validSha256,
        resolvedAt: validIsoDate,
        sources: [
          {
            factId: sampleOwnerFact.factId,
            sourceCandidateId: 'cand-01',
            approvedAt: validIsoDate,
          },
        ],
        provenance: [
          {
            ...sampleOwnerFact,
            claimCategory: 'customer_review',
            sourceSpan: '가짜 고객 후기입니다',
          },
        ],
      }
      const parsed = approvedFactBasisSchema.safeParse(invalidBasis)
      expect(parsed.success).toBe(false)
    })
  })
})
