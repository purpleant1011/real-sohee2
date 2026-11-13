import { describe, expect, it, vi, beforeEach } from 'vitest'
import { POST } from './route'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  resolve: vi.fn(),
  compose: vi.fn(),
  attachCtas: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServer,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}))

vi.mock('@/features/auth/workspace-context', () => ({
  resolveDeterministicWorkspace: mocks.resolve,
}))

vi.mock('@/features/missions/conversational-first-post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/missions/conversational-first-post')>()
  return {
    ...actual,
    composeFirstPostWithGemini: mocks.compose,
  }
})

vi.mock('@/features/missions/first-post-cta', () => ({
  attachFirstPostCtas: mocks.attachCtas,
}))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const missionId = '22222222-2222-4222-8222-222222222222'
const initialFp = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const initialUpdatedAt = '2026-10-25T00:00:00.000Z'

function makeDraft() {
  return {
    missionId,
    workspaceId,
    status: 'AWAITING_EXACT_APPROVAL' as const,
    topic: '첫 인사',
    goal: '첫 게시물 발행',
    copies: {
      instagram: { caption: '원문 인스타', cta: '예약하기' },
      threads: { content: '원문 스레드' },
    },
    selectedImageIds: ['img-1'],
    mediaPreviews: [{ id: 'img-1', url: `/api/workspaces/${workspaceId}/media/img-1` }],
    boundVersions: {
      knowledgeVersionNumber: 1,
      textRuleVersionNumber: 1,
      imageRuleVersionNumber: 1,
      policyVersionNumber: 1,
    },
    rights: { rightsStatus: 'OWNED' as const, consentStatus: 'NOT_APPLICABLE' as const },
    channels: [{ provider: 'instagram', handle: '@shop' }],
    approvalFingerprint: initialFp,
    createdAt: '2026-10-25T00:00:00.000Z',
    knowledgeSnapshot: { businessName: '가게' },
  }
}

function createMockDb(opts: {
  missionData?: any
  missionNull?: boolean
  updateReturnRows?: any[]
  readbackDraft?: any
  updateError?: any
  readbackError?: any
  /** 저장 payload 를 기준으로 readback 초안을 변형한다(DB 정규화/부분 손실 시나리오). */
  mutateReadback?: (stored: any) => any
} = {}) {
  const draft = opts.missionData?.metadata?.draft ?? makeDraft()
  const mission = opts.missionData ?? {
    id: missionId,
    workspace_id: workspaceId,
    status: 'AWAITING_APPROVAL',
    metadata: { draft },
    updated_at: initialUpdatedAt,
  }

  let capturedUpdatePayload: any = null
  let updateCalled = false
  const capturedEqs: Record<string, string> = {}

  const mockDb = {
    from: (table: string) => {
      if (table !== 'marketing_missions') throw new Error(`Unexpected table ${table}`)
      return {
        select: (cols: string) => {
          if (cols === 'metadata') {
            return {
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: opts.readbackError
                      ? null
                      : {
                          metadata: {
                            draft: opts.mutateReadback
                              ? opts.mutateReadback(capturedUpdatePayload?.metadata?.draft)
                              : (opts.readbackDraft ?? capturedUpdatePayload?.metadata?.draft),
                          },
                        },
                    error: opts.readbackError ?? null,
                  }),
                }),
              }),
            }
          }
          return {
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.missionNull ? null : mission,
                  error: null,
                }),
              }),
            }),
          }
        },
        update: (payload: any) => {
          updateCalled = true
          capturedUpdatePayload = payload
          const chain: any = {
            eq: (field: string, val: string) => {
              capturedEqs[field] = val
              return chain
            },
            select: async () => ({
              data: opts.updateError ? null : (opts.updateReturnRows ?? [{ id: missionId, status: 'AWAITING_APPROVAL' }]),
              error: opts.updateError ?? null,
            }),
          }
          return chain
        },
      }
    },
    getCaptured: () => ({ capturedUpdatePayload, capturedEqs, updateCalled }),
  }
  return mockDb
}

describe('POST /api/missions/first-post/revise (ANI-1787 manual copy save)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServer.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@shop.com' } } }) },
    })
    mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'owner' })
  })

  it('copies 키가 있는 manual 요청 시 stale expectedFingerprint 면 409 STALE_APPROVAL 을 반환한다', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        copies: {
          instagram: { caption: '수정된 인스타' },
          threads: { content: '수정된 스레드' },
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('STALE_APPROVAL')
    expect(mocks.compose).not.toHaveBeenCalled()
  })

  it('정상적인 manual 요청 시 사용자 원문(공백·개행·CTA)을 보존하고 CAS 갱신 후 DB readback 일치를 검증해 반환한다', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    const rawCopies = {
      instagram: {
        caption: '  사용자 직접 작성\n\n여러 개행과   공백  ',
        cta: '  원문 CTA  ',
        hashtags: ['가을'],
      },
      threads: {
        content: '스레드\n원문\n',
      },
    }

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: rawCopies,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)

    // 원문 100% 보존 확인
    expect(json.draft.copies.instagram.caption).toBe(rawCopies.instagram.caption)
    expect(json.draft.copies.instagram.cta).toBe(rawCopies.instagram.cta)
    expect(json.draft.copies.threads.content).toBe(rawCopies.threads.content)

    // LLM compose 호출 0건 확인
    expect(mocks.compose).not.toHaveBeenCalled()

    // CAS eq('updated_at', initialUpdatedAt) 확인
    const { capturedEqs, capturedUpdatePayload } = mockDb.getCaptured()
    expect(capturedEqs['updated_at']).toBe(initialUpdatedAt)
    expect(capturedUpdatePayload.metadata.priorApprovalInvalidated).toBe(true)
    expect(capturedUpdatePayload.metadata.draftFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it('미션이 이미 terminal 상태이거나 실행 중이면 409 IMMUTABLE_MISSION_STATUS 로 차단한다', async () => {
    const mockDb = createMockDb({
      missionData: {
        id: missionId,
        workspace_id: workspaceId,
        status: 'PUBLISHED_VERIFIED', // terminal
        metadata: { draft: makeDraft() },
        updated_at: initialUpdatedAt,
      },
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: {
          instagram: { caption: '수정' },
          threads: { content: '수정' },
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('IMMUTABLE_MISSION_STATUS')
  })

  it('DB CAS 경합 시 (update 결과 0행) 409 CONCURRENT_REVISION_CONFLICT 를 반환한다', async () => {
    const mockDb = createMockDb({
      updateReturnRows: [], // 0 rows updated
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: {
          instagram: { caption: '수정' },
          threads: { content: '수정' },
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('CONCURRENT_REVISION_CONFLICT')
  })

  it('readback 검증 실패 시 (DB 재조회 불일치) 500 READBACK_VERIFICATION_FAILED 를 반환한다', async () => {
    const mockDb = createMockDb({
      readbackDraft: { ...makeDraft(), approvalFingerprint: 'tampered-or-failed-readback-fingerprint0000000000000000000000000' },
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: {
          instagram: { caption: '수정' },
          threads: { content: '수정' },
        },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.code).toBe('READBACK_VERIFICATION_FAILED')
  })

  it('인증 세션이 없으면 401 로 닫히고 admin client(쓰기 경로)가 생성되지 않는다', async () => {
    mocks.createServer.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
    })

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mocks.createAdmin).not.toHaveBeenCalled()
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.compose).not.toHaveBeenCalled()
  })

  it('타 워크스페이스 접근(403 CROSS_TENANT_ACCESS_DENIED)이면 403 으로 닫히고 쓰기가 발생하지 않는다', async () => {
    mocks.resolve.mockResolvedValue({
      success: false,
      error: 'CROSS_TENANT_ACCESS_DENIED',
      statusCode: 403,
      message: '해당 워크스페이스에 대한 접근 권한이 없습니다 (CROSS_TENANT_ACCESS_DENIED).',
    })

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': '33333333-3333-4333-8333-333333333333' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mocks.createAdmin).not.toHaveBeenCalled()
    expect(mocks.compose).not.toHaveBeenCalled()
  })

  it('타 tenant 의 missionId 를 지정해도 workspace 필터로 조회 0건이 되어 404 로 닫히고 update 가 호출되지 않는다', async () => {
    // resolve 는 정상(내 워크스페이스), 그러나 해당 missionId 는 다른 워크스페이스 소유 →
    // .eq('workspace_id', ...) 필터 때문에 조회 결과가 null 이 된다.
    const mockDb = createMockDb({ missionNull: true })
    mocks.createAdmin.mockReturnValue(mockDb)

    const req = new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        missionId,
        expectedFingerprint: initialFp,
        copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.code).toBe('MISSION_NOT_FOUND')

    // 성공 오인 경로 없음: update 미호출
    expect(mockDb.getCaptured().updateCalled).toBe(false)
    expect(mocks.compose).not.toHaveBeenCalled()
  })
})

/**
 * ANI-1787 DoD A — 문구 저장 권한(owner/manager) 커버리지.
 * 주의: 이것은 "테스트 없음" 커버리지 갭이며, 권한이 뚫렸다는 실증이 아니다.
 */
describe('ANI-1787 DoD A — 문구 저장 권한', () => {
  const manualBody = {
    instagram: { caption: '권한 테스트', cta: '예약' },
    threads: { content: '권한 테스트 스레드' },
  }

  function manualRequest() {
    return new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missionId, expectedFingerprint: initialFp, copies: manualBody }),
    })
  }

  it.each(['reviewer', 'viewer'] as const)(
    'role=%s 이면 403 INSUFFICIENT_ROLE 로 닫히고 update·LLM 호출이 0회다',
    async (role) => {
      const mockDb = createMockDb()
      mocks.createAdmin.mockReturnValue(mockDb)
      mocks.resolve.mockResolvedValue({ success: true, workspaceId, role })

      const res = await POST(manualRequest())

      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('INSUFFICIENT_ROLE')
      expect(mockDb.getCaptured().updateCalled).toBe(false)
      expect(mocks.compose).not.toHaveBeenCalled()
    },
  )

  it('role=manager 는 저장이 통과한다 (대조)', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)
    mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'manager' })

    const res = await POST(manualRequest())

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(mockDb.getCaptured().updateCalled).toBe(true)
  })
})

/**
 * ANI-1787 DoD B — readback 지문 재계산과 별도 동일성은 서로 다른 검증이다.
 * ① 지문 대상 필드는 저장 payload 로 지문을 다시 계산해 대조한다.
 * ② 지문 대상이 아닌 mediaPreviews/knowledgeSnapshot 은 별도 필드 비교로 대조한다.
 */
describe('ANI-1787 DoD B — readback 정합', () => {
  const copies = {
    instagram: { caption: '본문 원문', cta: '예약하기' },
    threads: { content: '스레드 원문' },
  }

  function saveRequest() {
    return new Request('http://localhost/api/missions/first-post/revise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ missionId, expectedFingerprint: initialFp, copies }),
    })
  }

  it('① 저장된 payload 로 승인 지문을 다시 계산한 값이 저장 지문과 같다', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    expect((await POST(saveRequest())).status).toBe(200)

    const stored = mockDb.getCaptured().capturedUpdatePayload.metadata.draft
    const recalculated = calculateApprovalFingerprint({
      workspaceId: stored.workspaceId,
      missionId: stored.missionId,
      channels: stored.channels,
      copies: stored.copies,
      imageIds: stored.selectedImageIds,
      boundVersions: stored.boundVersions,
      rights: stored.rights,
    })

    expect(recalculated).toBe(stored.approvalFingerprint)
    expect(stored.copies.instagram.caption).toBe(copies.instagram.caption)
  })

  it('① 지문 대상 필드(caption)가 readback 에서 달라지면 성공으로 닫지 않는다', async () => {
    const mockDb = createMockDb({
      mutateReadback: (stored) => ({
        ...stored,
        copies: { ...stored.copies, instagram: { ...stored.copies.instagram, caption: '다른 본문' } },
      }),
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(saveRequest())

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('READBACK_VERIFICATION_FAILED')
  })

  it('② 지문은 같지만 mediaPreviews.url 이 다르면 성공으로 닫지 않는다', async () => {
    const mockDb = createMockDb({
      mutateReadback: (stored) => ({
        ...stored,
        mediaPreviews: stored.mediaPreviews.map((preview: any) => ({
          ...preview,
          url: `${preview.url}?tampered=1`,
        })),
      }),
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(saveRequest())

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('READBACK_VERIFICATION_FAILED')
  })

  it('② 지문은 같지만 knowledgeSnapshot 이 다르면 성공으로 닫지 않는다', async () => {
    const mockDb = createMockDb({
      mutateReadback: (stored) => ({
        ...stored,
        knowledgeSnapshot: { ...stored.knowledgeSnapshot, businessName: '다른 가게' },
      }),
    })
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(saveRequest())

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('READBACK_VERIFICATION_FAILED')
  })
})

/**
 * ANI-1787 DoD C — 요청 본문 형태와 문구 형태 실패 경로 커버리지.
 * 주의: 구현은 이미 fail-closed 로 존재했고 전용 테스트가 없던 갭이다(우회 실증 아님).
 */
describe('ANI-1787 DoD C — 잘못된 본문/문구', () => {
  it.each([
    ['null', 'null'],
    ['원시 문자열', '"그냥 문자열"'],
    ['배열', '[]'],
  ])('%s 본문이면 422 INVALID_BODY 로 닫히고 update 가 0회다', async (_label, raw) => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(
      new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: raw,
      }),
    )

    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('INVALID_BODY')
    expect(mockDb.getCaptured().updateCalled).toBe(false)
    expect(mocks.compose).not.toHaveBeenCalled()
  })

  it('copies 가 null 이면 422 INVALID_COPY 로 닫히고 update 가 0회다', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(
      new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ missionId, expectedFingerprint: initialFp, copies: null }),
      }),
    )

    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('INVALID_COPY')
    expect(mockDb.getCaptured().updateCalled).toBe(false)
    expect(mocks.compose).not.toHaveBeenCalled()
  })

  it('caption 이 문자열이 아니면 422 INVALID_COPY 로 닫히고 update 가 0회다', async () => {
    const mockDb = createMockDb()
    mocks.createAdmin.mockReturnValue(mockDb)

    const res = await POST(
      new Request('http://localhost/api/missions/first-post/revise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          missionId,
          expectedFingerprint: initialFp,
          copies: { instagram: { caption: 42 }, threads: { content: '스레드' } },
        }),
      }),
    )

    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('INVALID_COPY')
    expect(mockDb.getCaptured().updateCalled).toBe(false)
  })
})
