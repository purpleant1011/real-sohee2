import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/missions/first-post/revise/route'
import { calculateApprovalFingerprint, type FirstPostMissionDraft } from '@/features/missions/conversational-first-post'
import { saveFirstPostDraftCopies } from './draft-save-client'

/**
 * ANI-1787 API ↔ client 계약 테스트 (UNIT / contract).
 *
 * - 실제 saveFirstPostDraftCopies 의 fetchImpl 을 **실제 POST(req) handler** 에 연결한다.
 * - DB 는 in-memory mock 이지만 .eq 는 workspace/updated_at 을 **실제로 필터**하고,
 *   update 는 실제로 0행/1행을 반영한다.
 * - readback 은 기대값을 돌려주지 않고 **handler 가 실제로 갱신한 mockDb.metadata.draft** 를 읽는다.
 *
 * 네트워크/실 Auth/실 DB/LLM 0. 실DB 증거가 아니며 migration schema 도 검증하지 않는다.
 */

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999'
const MISSION = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-25T00:00:00.000Z'

type Row = {
  id: string
  workspace_id: string
  status: string
  metadata: { draft: FirstPostMissionDraft }
  updated_at: string
}

/** .eq 를 실제로 적용하는 in-memory 테이블. update 는 실제 0행/1행을 반환한다. */
type DbState = { rows: Row[]; updateCalls: number; updateMatched: number }

function createDb(initialRows: Row[]) {
  const state: DbState = { rows: initialRows, updateCalls: 0, updateMatched: 0 }
  return {
    get rows() {
      return state.rows
    },
    get updateCalls() {
      return state.updateCalls
    },
    get updateMatched() {
      return state.updateMatched
    },
    from(table: string) {
      if (table !== 'marketing_missions') throw new Error('Unexpected table: ' + table)
      return {
        select(cols: string) {
          const filters: Array<[string, unknown]> = []
          const q: any = {
            eq(field: string, value: unknown) {
              filters.push([field, value])
              return q
            },
            async maybeSingle() {
              const match = state.rows.find((r) => filters.every(([f, v]) => (r as any)[f] === v))
              if (!match) return { data: null, error: null }
              if (cols === 'metadata') return { data: { metadata: match.metadata }, error: null }
              return { data: { ...match }, error: null }
            },
          }
          return q
        },
        update(payload: any) {
          const filters: Array<[string, unknown]> = []
          const q: any = {
            eq(field: string, value: unknown) {
              filters.push([field, value])
              return q
            },
            async select() {
              state.updateCalls += 1
              const matched = state.rows.filter((r) => filters.every(([f, v]) => (r as any)[f] === v))
              state.updateMatched = matched.length
              if (matched.length === 0) return { data: [], error: null }
              for (const row of matched) Object.assign(row, payload)
              return { data: matched.map((r) => ({ id: r.id, status: r.status })), error: null }
            },
          }
          return q
        },
      }
    },
  }
}

function baseDraft(overrides: Partial<FirstPostMissionDraft> = {}): FirstPostMissionDraft {
  const copies = {
    instagram: { caption: '원문 인스타 본문', cta: '예약하기' },
    threads: { content: '원문 스레드' },
  }
  const payload = {
    workspaceId: WORKSPACE,
    missionId: MISSION,
    channels: [{ provider: 'instagram', handle: '@shop' }],
    copies,
    imageIds: ['img-1'],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: { rightsStatus: 'OWNED' as const, consentStatus: 'NOT_APPLICABLE' as const },
  }
  return {
    missionId: MISSION,
    workspaceId: WORKSPACE,
    status: 'AWAITING_EXACT_APPROVAL',
    topic: '첫 인사',
    goal: '첫 게시물',
    copies,
    selectedImageIds: ['img-1'],
    mediaPreviews: [{ id: 'img-1', url: '/api/workspaces/' + WORKSPACE + '/media/img-1' }],
    boundVersions: payload.boundVersions,
    rights: payload.rights,
    channels: payload.channels,
    approvalFingerprint: calculateApprovalFingerprint(payload),
    createdAt: UPDATED_AT,
    knowledgeSnapshot: { businessName: '가게' },
    ...overrides,
  }
}

function makeRow(draft: FirstPostMissionDraft, workspaceId = WORKSPACE): Row {
  return {
    id: MISSION,
    workspace_id: workspaceId,
    status: 'AWAITING_APPROVAL',
    metadata: { draft },
    updated_at: UPDATED_AT,
  }
}

const authMocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createAdmin: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: authMocks.createServer }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: authMocks.createAdmin }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: authMocks.resolve }))

/** client 의 fetchImpl 을 실제 POST(req) handler 에 연결한다. */
function makeHandlerFetch() {
  const calls: Array<{ url: string; body: any }> = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init && init.body ? init.body : '{}')) })
    const request = new Request(new URL(String(url), 'http://localhost'), init)
    return POST(request)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

/** handler 가 실제로 갱신한 mockDb 의 draft 를 읽는다 (기대값 반환 금지). */
function makeReadback(db: ReturnType<typeof createDb>) {
  const calls: string[] = []
  const readback = async (missionId: string, workspaceId: string) => {
    calls.push(workspaceId + ':' + missionId)
    const row = db.rows.find((r) => r.id === missionId && r.workspace_id === workspaceId)
    if (!row) throw new Error('not found')
    return row.metadata.draft
  }
  return { readback, calls }
}

describe('ANI-1787 save API ↔ client contract (실 handler + in-memory DB)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.createServer.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@shop.com' } } }) },
    })
    authMocks.resolve.mockResolvedValue({
      success: true,
      workspaceId: WORKSPACE,
      role: 'owner',
      status: 'active',
    })
  })

  it('원고 공백/개행/CTA 를 그대로 저장하고, 1 POST · 1 readback 으로 saved 에 도달한다', async () => {
    const draft = baseDraft()
    const db = createDb([makeRow(draft)])
    authMocks.createAdmin.mockReturnValue(db)
    const { fetchImpl, calls: fetchCalls } = makeHandlerFetch()
    const { readback, calls: readbackCalls } = makeReadback(db)

    const rawCopies = {
      instagram: {
        caption: '  앞뒤 공백\n\n\n여러 개행   포함  ',
        cta: '  원문 CTA  ',
        hashtags: ['가을'],
      },
      threads: { content: '\t탭과 공백\n\n보존\n', cta: '문의\n' },
    }

    const result = await saveFirstPostDraftCopies({
      draft,
      copies: rawCopies,
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('saved')
    expect(fetchCalls).toHaveLength(1)
    expect(readbackCalls).toHaveLength(1)

    // 실제 handler 가 DB 를 갱신했다는 증거: update 1회/1행.
    // handler 미도달이면 updateCalls=0 이므로 이 케이스는 saved 가 될 수 없다.
    expect(db.updateCalls).toBe(1)
    expect(db.updateMatched).toBe(1)

    const stored = db.rows[0]!.metadata.draft
    expect(stored.copies.instagram.caption).toBe(rawCopies.instagram.caption)
    expect(stored.copies.instagram.cta).toBe(rawCopies.instagram.cta)
    expect(stored.copies.threads.content).toBe(rawCopies.threads.content)
    expect(stored.copies.threads.cta).toBe(rawCopies.threads.cta)

    expect(stored.selectedImageIds).toEqual(draft.selectedImageIds)
    expect(stored.rights).toEqual(draft.rights)
    expect(stored.approvalFingerprint).not.toBe(draft.approvalFingerprint)
    expect(stored.approvalFingerprint).toMatch(/^[a-f0-9]{64}$/)

    expect((result as { kind: 'saved'; newFingerprint: string }).newFingerprint).toBe(stored.approvalFingerprint)
  })

  it('stale 지문이면 409 conflict 로 닫히고 DB write 가 0건이다', async () => {
    const draft = baseDraft()
    const db = createDb([makeRow(draft)])
    authMocks.createAdmin.mockReturnValue(db)
    const { fetchImpl, calls } = makeHandlerFetch()
    const { readback, calls: readbackCalls } = makeReadback(db)

    const result = await saveFirstPostDraftCopies({
      draft: { ...draft, approvalFingerprint: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' },
      copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('conflict')
    expect(calls).toHaveLength(1)
    expect(readbackCalls).toHaveLength(0)
    expect(db.updateCalls).toBe(0)
    expect(db.rows[0]!.metadata.draft.copies.instagram.caption).toBe(draft.copies.instagram.caption)
  })

  it('role 이 owner/manager 가 아니면 403 unauthorized 로 닫히고 DB write 가 0건이다', async () => {
    const draft = baseDraft()
    const db = createDb([makeRow(draft)])
    authMocks.createAdmin.mockReturnValue(db)
    authMocks.resolve.mockResolvedValue({
      success: true,
      workspaceId: WORKSPACE,
      role: 'viewer',
      status: 'active',
    })
    const { fetchImpl } = makeHandlerFetch()
    const { readback, calls: readbackCalls } = makeReadback(db)

    const result = await saveFirstPostDraftCopies({
      draft,
      copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('unauthorized')
    expect(readbackCalls).toHaveLength(0)
    expect(db.updateCalls).toBe(0)
  })

  it('다른 tenant 의 mission 이면 조회 0건으로 닫히고 그 워크스페이스 row 에 write 가 없다', async () => {
    const draft = baseDraft({ workspaceId: OTHER_WORKSPACE })
    const db = createDb([makeRow(draft, OTHER_WORKSPACE)])
    authMocks.createAdmin.mockReturnValue(db)
    const { fetchImpl } = makeHandlerFetch()
    const { readback } = makeReadback(db)

    const result = await saveFirstPostDraftCopies({
      draft,
      copies: { instagram: { caption: '타 tenant 쓰기 시도' }, threads: { content: '시도' } },
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('unknown')
    expect((result as { doNotRetry: boolean }).doNotRetry).toBe(true)
    expect(db.updateCalls).toBe(0)
    expect(db.rows[0]!.metadata.draft.copies.instagram.caption).toBe('원문 인스타 본문')
  })

  it('readback 내용이 저장본과 어긋나면 unknown(saved 아님)이고 자동 재POST 하지 않는다', async () => {
    const draft = baseDraft()
    const db = createDb([makeRow(draft)])
    authMocks.createAdmin.mockReturnValue(db)
    const { fetchImpl, calls: fetchCalls } = makeHandlerFetch()

    const readback = async (missionId: string, workspaceId: string) => {
      const row = db.rows.find((r) => r.id === missionId && r.workspace_id === workspaceId)
      if (!row) throw new Error('not found')
      row.metadata.draft.copies.instagram.caption = '서버가 다른 값으로 저장함'
      return row.metadata.draft
    }

    const result = await saveFirstPostDraftCopies({
      draft,
      copies: { instagram: { caption: '사장님이 고친 원문' }, threads: { content: '수정' } },
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('unknown')
    if (result.kind === 'unknown') {
      expect(result.doNotRetry).toBe(true)
      expect(result.mismatches).toContain('copies.instagram.caption')
    }
    expect(fetchCalls).toHaveLength(1)
  })

  it('[characterization] 기존 정상 입력은 saved 로 유지된다 (새 계약 반례 아님)', async () => {
    const draft = baseDraft()
    const db = createDb([makeRow(draft)])
    authMocks.createAdmin.mockReturnValue(db)
    const { fetchImpl } = makeHandlerFetch()
    const { readback } = makeReadback(db)

    const result = await saveFirstPostDraftCopies({
      draft,
      copies: { instagram: { caption: '수정' }, threads: { content: '수정' } },
      fetchImpl,
      readback,
    })

    expect(result.kind).toBe('saved')
  })
})
