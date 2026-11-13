import { describe, expect, it } from 'vitest'
import type {
  CandidateCategory,
  SourceRef,
} from './contracts'
import {
  buildLearningContext,
  type ApprovedCandidateWithSource,
  type ContextDeps,
} from './context'

const workspaceId = '11111111-1111-1111-1111-111111111111'
const sourceRefA: SourceRef = {
  workspaceId,
  sourceId: '22222222-2222-2222-2222-222222222222',
  revision: 1,
}
const sourceRefB: SourceRef = {
  workspaceId,
  sourceId: '33333333-3333-3333-3333-333333333333',
  revision: 1,
}

const mockNow = new Date('2026-11-10T12:00:00.000Z')

function createApprovedCandidate(
  id: string,
  category: CandidateCategory,
  content: string,
  source: SourceRef,
  overrides: Partial<ApprovedCandidateWithSource> = {},
): ApprovedCandidateWithSource {
  return {
    id,
    source,
    version: 1,
    category,
    content,
    evidence: {
      documentId: 'doc-1',
      excerpt: content,
      visionReceiptId: category === 'visual' ? 'vr-1' : null,
    },
    evidenceState: 'observed',
    status: 'approved',
    conflictsWithFactId: null,
    sourcePlatform: 'instagram',
    sourceRevision: 1,
    sourceStatus: 'verified',
    leaseExpiresAt: '2026-11-11T00:00:00.000Z', // valid (> now)
    isRevoked: false,
    ...overrides,
  }
}

describe('buildLearningContext', () => {
  it('includes approved facts and returns dependencies and workspace epoch', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c1', 'price', '핸드드립 커피 5,000원', sourceRefA),
      createApprovedCandidate('c2', 'policy', '매주 월요일 정기 휴무', sourceRefA),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 42,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '커피 가격 얼마인가요?',
        channel: 'instagram',
        maxCharacters: 2000,
      },
      deps,
    )

    expect(res.epoch).toBe(42)
    expect(res.text).toContain('핸드드립 커피 5,000원')
    expect(res.dependencies).toEqual([sourceRefA])
  })

  it('excludes unapproved, rejected, or expired lease candidates', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-valid', 'price', '아메리카노 4,500원', sourceRefA),
      createApprovedCandidate('c-rejected', 'price', '가짜 가격 1,000원', sourceRefA, {
        status: 'rejected',
      }),
      createApprovedCandidate('c-expired', 'price', '옛날 가격 3,000원', sourceRefA, {
        leaseExpiresAt: '2026-11-01T00:00:00.000Z', // expired
      }),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '가격',
        channel: 'instagram',
        maxCharacters: 2000,
      },
      deps,
    )

    expect(res.text).toContain('아메리카노 4,500원')
    expect(res.text).not.toContain('가짜 가격')
    expect(res.text).not.toContain('옛날 가격')
  })

  it('excludes facts when the underlying source has been revoked', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-good', 'business', '망원동 좋은 카페', sourceRefA),
      createApprovedCandidate('c-revoked', 'price', '철회된 가격 2,000원', sourceRefB, {
        isRevoked: true,
      }),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'content',
        query: '카페 소개 및 가격',
        channel: 'instagram',
        maxCharacters: 2000,
      },
      deps,
    )

    expect(res.text).toContain('망원동 좋은 카페')
    expect(res.text).not.toContain('철회된 가격')
    expect(res.dependencies).toEqual([sourceRefA])
  })

  it('purpose "image" extracts imageStyle and cannot modify business facts', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-vis', 'visual', '우드 앤 화이트 톤의 아늑한 분위기', sourceRefA),
      createApprovedCandidate('c-price', 'price', '핸드드립 5,000원', sourceRefA),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'image',
        query: '매장 사진 스타일',
        channel: 'instagram',
        maxCharacters: 1000,
      },
      deps,
    )

    expect(res.imageStyle).toBe('우드 앤 화이트 톤의 아늑한 분위기')
    // In image mode, text shouldn't dump unrelated business pricing
    expect(res.text).toBe('')
  })

  it('bounds output text to server-capped maxCharacters', async () => {
    const manyCandidates: ApprovedCandidateWithSource[] = Array.from({ length: 50 }, (_, i) =>
      createApprovedCandidate(
        `c-${i}`,
        'offering',
        `메뉴 항목 ${i + 1}: 정성스럽게 로스팅한 고급 원두 ${i + 1}호`,
        sourceRefA,
      ),
    )

    const deps: ContextDeps = {
      getApprovedCandidates: async () => manyCandidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '메뉴',
        channel: 'instagram',
        maxCharacters: 200, // tight budget
      },
      deps,
    )

    expect(res.text.length).toBeLessThanOrEqual(200)
    expect(res.text.length).toBeGreaterThan(0)
  })

  it('scales efficiently with 10,000 synthetic facts, picking only the latest relevant facts', async () => {
    const syntheticList: ApprovedCandidateWithSource[] = Array.from({ length: 10000 }, (_, i) =>
      createApprovedCandidate(
        `c-${i}`,
        'business',
        `기타 정보 ${i}`,
        sourceRefA,
      ),
    )
    // Add specific target fact
    syntheticList.push(
      createApprovedCandidate('c-target', 'price', '스페셜티 아메리카노 4500원', sourceRefA),
    )

    const deps: ContextDeps = {
      getApprovedCandidates: async () => syntheticList,
      getWorkspaceEpoch: async () => 5,
      now: () => mockNow,
    }

    const start = Date.now()
    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '스페셜티 아메리카노 가격',
        channel: 'instagram',
        maxCharacters: 500,
      },
      deps,
    )
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(1000) // fast in-memory relevance filter
    expect(res.text).toContain('스페셜티 아메리카노 4500원')
    expect(res.text.length).toBeLessThanOrEqual(500)
  })

  it('rejects candidates with pending/failed sourceStatus, invalid lease date, or mismatched source revision', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-pending', 'price', '미확인 가격 3000원', sourceRefA, {
        sourceStatus: 'pending',
      }),
      createApprovedCandidate('c-bad-date', 'price', '날짜오류 가격 4000원', sourceRefA, {
        leaseExpiresAt: 'invalid-date-string',
      }),
      createApprovedCandidate('c-stale-rev', 'price', '구버전 가격 5000원', sourceRefA, {
        sourceRevision: 2, // does not match sourceRefA.revision (1)
      }),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '가격',
        channel: 'instagram',
        maxCharacters: 1000,
      },
      deps,
    )

    expect(res.text).toBe('')
    expect(res.dependencies).toEqual([])
  })

  it('purpose "image" requires visionReceiptId, selects newest version, and respects maxCharacters budget', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-no-receipt', 'visual', '영수증 없는 스타일', sourceRefA, {
        evidence: { documentId: 'doc-1', excerpt: null, visionReceiptId: null },
      }),
      createApprovedCandidate('c-v1', 'visual', '구버전 스타일: 모던 미니멀', sourceRefA, {
        version: 1,
        evidence: { documentId: 'doc-1', excerpt: null, visionReceiptId: 'vr-1' },
      }),
      createApprovedCandidate('c-v2', 'visual', '신버전 스타일: 따뜻한 원목 감성의 포근한 카페 인테리어', sourceRefA, {
        version: 2,
        evidence: { documentId: 'doc-1', excerpt: null, visionReceiptId: 'vr-2' },
      }),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'image',
        query: '스타일',
        channel: 'instagram',
        maxCharacters: 15, // short budget
      },
      deps,
    )

    // Must pick c-v2 (highest version) and cut at maxCharacters budget
    expect(res.imageStyle?.length).toBeLessThanOrEqual(15)
    expect(res.imageStyle).toBe('신버전 스타일: 따뜻한 원목 감성의 포근한 카페 인테리어'.slice(0, 15))
    expect(res.dependencies).toEqual([sourceRefA])
  })

  it('prioritizes and includes manual facts when provided by deps.getManualFacts', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-chan', 'offering', '채널 메뉴: 핸드드립 커피', sourceRefA),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      getManualFacts: async () => [
        { id: 'm-1', category: 'policy', content: '운영시간: 10:00 ~ 20:00 (사장님 직접 등록)' },
      ],
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '운영시간 및 메뉴',
        channel: 'instagram',
        maxCharacters: 1000,
      },
      deps,
    )

    expect(res.text).toContain('운영시간: 10:00 ~ 20:00 (사장님 직접 등록)')
    expect(res.text).toContain('채널 메뉴: 핸드드립 커피')
  })

  it('prevents contradictory price injection by prioritizing manual price over conflicting channel prices', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-price-1', 'price', '인스타 가격 6,000원', sourceRefA),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      getManualFacts: async () => [
        { id: 'm-price', category: 'price', content: '정본 가격: 아메리카노 4,500원' },
      ],
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '가격',
        channel: 'instagram',
        maxCharacters: 1000,
      },
      deps,
    )

    expect(res.text).toContain('정본 가격: 아메리카노 4,500원')
    expect(res.text).not.toContain('인스타 가격 6,000원')
  })

  it('prevents multiple conflicting channel prices from being injected simultaneously', async () => {
    const candidates: ApprovedCandidateWithSource[] = [
      createApprovedCandidate('c-price-a', 'price', '시그니처 라떼 5,500원', sourceRefA, { version: 2 }),
      createApprovedCandidate('c-price-b', 'price', '시그니처 라떼 7,000원', sourceRefA, { version: 1 }),
    ]

    const deps: ContextDeps = {
      getApprovedCandidates: async () => candidates,
      getWorkspaceEpoch: async () => 1,
      now: () => mockNow,
    }

    const res = await buildLearningContext(
      {
        workspaceId,
        purpose: 'conversation',
        query: '라떼 가격 얼마예요?',
        channel: 'instagram',
        maxCharacters: 1000,
      },
      deps,
    )

    // Only one authoritative channel price should be injected, never contradictory dual prices
    expect(res.text).toContain('시그니처 라떼 5,500원')
    expect(res.text).not.toContain('시그니처 라떼 7,000원')
  })
})

