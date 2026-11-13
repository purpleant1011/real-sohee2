// Route orchestration with a snapshot-fenced claim RPC double.
// Actual PostgreSQL locking is verified by the dedicated DB concurrency suite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn(),
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ blocked: false }),
}))

vi.mock('@/features/publishing/dual-provider-publish-service', () => ({
  executeDualProviderPublish: vi.fn(),
}))

import { POST as publishRoute } from '@/app/api/missions/first-post/publish/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireSoheeReady } from '@/features/sohee-ready/admission-guard'
import { requireFirstPostReady } from '@/features/quick-start/first-post-readiness'

vi.mock('@/features/quick-start/first-post-readiness', () => ({ requireFirstPostReady: vi.fn() }))
import { executeDualProviderPublish } from '@/features/publishing/dual-provider-publish-service'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'

describe('R2-B6 Atomic Durable Idempotency & R2-B7 Persistence Failure Reconciliation', () => {
  const mockUser = { id: 'usr_owner_1' }
  const mockWorkspaceId = 'ws_truth_test'
  const mockMissionId = '44444444-5555-6666-7777-888888888888'

  const validPayload = {
    missionId: mockMissionId,
    workspaceId: mockWorkspaceId,
    channels: [{ provider: 'instagram', handle: '@cafe_sohee' }],
    copies: { instagram: { caption: '정본 캡션', hashtags: ['#소희'] }, threads: { content: '정본' } },
    imageIds: ['img_1', 'img_2', 'img_3'],
    boundVersions: { knowledge: 1, textHarness: 1, imageHarness: 1, operatingPolicy: 1 },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }

  const validFingerprint = calculateApprovalFingerprint(validPayload as any)

  // W7 Fact 재검증 게이트 fixture: 현재 승인 Fact 행과 일치하는 유효 스냅샷 (게이트 완화 아님)
  const currentFactRows: ApprovedFactRow[] = [
    {
      id: 'fact-1',
      workspace_id: mockWorkspaceId,
      category: 'pricing',
      content: '기본 시술 40,000원',
      status: 'active',
      source_candidate_id: 'cand-1',
      approved_by_user_id: 'user-1',
      approved_at: '2026-10-01T00:00:00Z',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: null,
      supersedes_fact_id: null,
      created_at: '2026-10-01T00:00:00Z',
    },
  ]
  const factSnapshot = resolveApprovedFacts({
    workspaceId: mockWorkspaceId,
    at: new Date().toISOString(),
    rows: currentFactRows,
  })
  const knowledgeFactsTable = () => ({
    select: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue({ data: currentFactRows, error: null, count: currentFactRows.length }),
    })),
  })
  /**
   * channel-publish-guard 의 형제 발행 조회 체인:
   * select → eq(workspace_id) → eq(status) → neq(id) → order(updated_at) → limit(20)
   * 형제 행이 없으므로 충돌 없음(null). 가드가 컬럼/메서드를 바꾸면 여기서 즉시 깨지도록 고정한다.
   */
  const noChannelConflictChain = () => ({
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  })
  function missionState() {
    return {
      id: mockMissionId,
      workspace_id: mockWorkspaceId,
      status: 'APPROVED',
      updated_at: new Date().toISOString(),
      metadata: {
        approvedFingerprint: validFingerprint,
        approvedMission: {
          missionId: mockMissionId,
          workspaceId: mockWorkspaceId,
          approvedFingerprint: validFingerprint,
          approvedAt: new Date().toISOString(),
          approvedByUserId: mockUser.id,
        },
        payload: validPayload,
        factSnapshot,
      },
    }
  }

  function claimRpc(row: ReturnType<typeof missionState>) {
    return vi.fn(async (name: string, params: any) => {
      expect(name).toBe('claim_first_post_publish')
      if (row.status !== 'APPROVED' || JSON.stringify(row.metadata) !== JSON.stringify(params.p_expected_metadata)
        || row.updated_at !== params.p_expected_updated_at) {
        return { data: { claimed: false, code: 'CONCURRENT_PUBLISH_IN_PROGRESS' }, error: null }
      }
      row.status = 'EXECUTING'
      Object.assign(row.metadata, { retryLock: params.p_claim_token, snapshot_version: 2 })
      return { data: { claimed: true }, error: null }
    })
  }

  // Apply every predicate at write time, then persist the full patch, like the DB CAS.
  function missionTable(row: any, resultWrite?: () => unknown) {
    const filters: Array<[string, unknown]> = []
    let patch: any = null
    const matches = () => filters.every(([column, value]) => {
      if (column === 'metadata') return JSON.stringify(row.metadata) === value
      if (column === 'metadata->>retryLock') return (row.metadata.retryLock ?? null) === value
      return row[column] === value
    })
    const query: any = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query },
      is: (column: string, value: unknown) => { filters.push([column, value]); return query },
      ...noChannelConflictChain(),
      maybeSingle: async () => ({ data: matches() ? structuredClone(row) : null, error: null }),
      update: (value: any) => { patch = value; return query },
      then: (resolve: (result: unknown) => void) => {
        if (!patch || !matches()) return resolve({ data: [], error: null })
        if (patch.metadata?.executionResult && resultWrite) return resolve(resultWrite())
        Object.assign(row, structuredClone(patch))
        return resolve({ data: [structuredClone(row)], error: null })
      },
    }
    return query
  }

  let origAllowlist: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    origAllowlist = process.env.META_LIVE_WORKSPACE_ALLOWLIST
    process.env.META_LIVE_WORKSPACE_ALLOWLIST = '*'
    vi.mocked(requireFirstPostReady).mockResolvedValue({ ready: true } as any)
    vi.mocked(requireSoheeReady).mockResolvedValue({
      workspaceId: mockWorkspaceId,
      ready: true,
      facts: {} as any,
      blockers: [],
      evaluatedAt: new Date().toISOString(),
    })
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  it('1. prevents double-publish on concurrent requests using CAS on status=APPROVED (exactly one provider call)', async () => {
    const row = missionState()
    const providerSpy = vi.mocked(executeDualProviderPublish).mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      approvalFingerprint: validFingerprint,
      receipts: {
        instagram: {
          channel: 'instagram',
          status: 'EXTERNALLY_VERIFIED',
          stage: 'EXTERNALLY_VERIFIED',
          postId: 'ig_post_100',
          permalink: 'https://instagram.com/p/100',
        },
      },
    } as any)

    const createClient = () => ({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
      rpc: claimRpc(row),
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: mockWorkspaceId }] }),
          }
        }
        if (table === 'marketing_missions') return missionTable(row)
        if (table === 'knowledge_facts') return knowledgeFactsTable()
        if (table === 'workspace_knowledge_harnesses') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { version_no: 1, is_active: true } }),
          }
        }
        if (table === 'harness_rules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1, status: 'active' } }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ channel: 'instagram', status: 'verified', account_label: '@cafe_sohee' }],
            }),
          }
        }
        if (table === 'external_action_requests') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockResolvedValue({ data: { id: 'req_1', status: 'prepared' }, error: null }),
            update: vi.fn().mockReturnThis(),
          }
        }
        if (table === 'mission_events') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    })

    vi.mocked(createServerSupabaseClient).mockImplementation(() => Promise.resolve(createClient() as any))
    vi.mocked(createAdminSupabaseClient).mockImplementation(() => createClient() as any)

    // Send two concurrent requests
    const req1 = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: mockMissionId }),
    })
    const req2 = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: mockMissionId }),
    })

    const [res1, res2] = await Promise.all([publishRoute(req1), publishRoute(req2)])
    const json1 = await res1.json()
    const json2 = await res2.json()

    // Exactly one must succeed (200), and the other must be rejected (409)
    const statuses = [res1.status, res2.status].sort()
    expect(statuses, JSON.stringify([json1, json2])).toEqual([200, 409])

    const rejectedJson = res1.status === 409 ? json1 : json2
    expect(rejectedJson.code).toBe('CONCURRENT_PUBLISH_IN_PROGRESS')

    // Provider must be called EXACTLY ONCE!
    expect(providerSpy).toHaveBeenCalledTimes(1)
    expect(row.status).toBe('PUBLISHED_VERIFIED')
    expect(row.metadata).toMatchObject({ snapshot_version: 3, executionResult: { overallStatus: 'ALL_VERIFIED' } })
    expect(row.metadata).not.toHaveProperty('retryLock')
  })

  it('2. returns RECONCILIATION_REQUIRED (500) and forbids success when provider accepts but DB receipt update fails', async () => {
    const row = missionState()
    const failResultWrite = vi.fn(() => ({ data: null, error: { message: 'Database disk full' } }))
    vi.mocked(executeDualProviderPublish).mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      approvalFingerprint: validFingerprint,
      receipts: {
        instagram: {
          channel: 'instagram',
          status: 'EXTERNALLY_VERIFIED',
          stage: 'EXTERNALLY_VERIFIED',
          postId: 'ig_post_200',
          permalink: 'https://instagram.com/p/200',
        },
      },
    } as any)

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
      rpc: claimRpc(row),
      from: vi.fn((table: string) => {
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: mockWorkspaceId }] }),
          }
        }
        if (table === 'marketing_missions') return missionTable(row, failResultWrite)
        if (table === 'knowledge_facts') return knowledgeFactsTable()
        if (table === 'workspace_knowledge_harnesses') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { version_no: 1, is_active: true } }),
          }
        }
        if (table === 'harness_rules') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1, status: 'active' } }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [{ channel: 'instagram', status: 'verified', account_label: '@cafe_sohee' }],
            }),
          }
        }
        if (table === 'mission_events') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }),
    }

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as any)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockClient as any)

    const req = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: mockMissionId }),
    })

    const res = await publishRoute(req)
    const json = await res.json()

    // Must NOT be success! Must be 500 RECONCILIATION_REQUIRED
    expect(res.status).toBe(500)
    expect(json.code).toBe('RECONCILIATION_REQUIRED')
    expect(json.success).toBe(false)
    expect(executeDualProviderPublish).toHaveBeenCalledTimes(1)
    expect(failResultWrite).toHaveBeenCalledTimes(1)
    expect(row.status).toBe('EXECUTING')
    expect(row.metadata).toMatchObject({ snapshot_version: 2, retryLock: expect.any(String) })
    expect(row.metadata).not.toHaveProperty('executionResult')
    expect(json.executionResult.overallStatus).toBe('ALL_VERIFIED')
  })
})
