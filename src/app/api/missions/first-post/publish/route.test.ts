// DB 원자성은 실제 PG suite에서, 라우트의 RPC 계약과 저장 fence는 여기서 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveApprovedFacts,
  type ApprovedFactRow,
} from '@/features/knowledge/approved-fact-resolver'
import { calculateApprovalFingerprint } from '@/lib/evidence/approval-fingerprint'

const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  admin: vi.fn(),
  resolve: vi.fn(),
  executeDual: vi.fn(),
  readiness: vi.fn(),
  killSwitch: vi.fn(),
  funnel: vi.fn(),
  channelGuard: vi.fn(),
}))
vi.mock('@/features/publishing/channel-publish-guard', () => ({ findChannelPublishConflict: mocks.channelGuard }))

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.server }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolve }))
vi.mock('@/features/publishing/dual-provider-publish-service', () => ({
  executeDualProviderPublish: mocks.executeDual,
}))
vi.mock('@/features/quick-start/first-post-readiness', () => ({
  requireFirstPostReady: mocks.readiness,
}))
vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: mocks.killSwitch,
}))
vi.mock('@/features/quick-start/funnel-events', () => ({
  recordFunnelEvent: mocks.funnel,
}))

import { POST } from './route'

const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherWorkspaceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const baseFact40k: ApprovedFactRow = {
  id: 'fact-1',
  workspace_id: workspaceId,
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
}

const replacementFact50k: ApprovedFactRow = {
  id: 'fact-2',
  workspace_id: workspaceId,
  category: 'pricing',
  content: '기본 시술 50,000원',
  status: 'active',
  source_candidate_id: 'cand-2',
  approved_by_user_id: 'user-1',
  approved_at: '2026-10-15T00:00:00Z',
  valid_from: '2026-10-15T00:00:00Z',
  valid_until: null,
  supersedes_fact_id: 'fact-1',
  created_at: '2026-10-15T00:00:00Z',
}

function makePayload() {
  return {
    workspaceId,
    missionId,
    channels: [{ provider: 'threads', handle: 'test-store' }],
    copies: {
      instagram: { caption: '확인한 가격 40,000원' },
      threads: { content: '확인한 가격 40,000원' },
    },
    imageIds: [],
    boundVersions: {
      knowledgeVersion: 1,
      textHarnessVersion: 1,
      imageHarnessVersion: 1,
      operatingPolicyVersion: 1,
    },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }
}

function buildDatabase(options: {
  storedFactSnapshot?: any
  currentFactRows?: ApprovedFactRow[] | null
  factReadError?: Error | null
}) {
  const payload = makePayload()
  const fingerprint = calculateApprovalFingerprint(payload)
  const missionRow: Record<string, any> = {
    id: missionId,
    workspace_id: workspaceId,
    status: 'APPROVED',
    metadata: {
      payload,
      approvedFingerprint: fingerprint,
      approvedMission: {
        approvalId: 'appr-1',
        status: 'APPROVED_FOR_PUBLISH',
        approvedFingerprint: fingerprint,
        missionId,
      },
      factSnapshot: options.storedFactSnapshot,
    },
    updated_at: '2026-10-21T00:00:00.000Z',
  }

  const faults: { readError?: boolean; readNull?: boolean; beforeWrite?: (patch: any) => void } = {}
  const client = {
    rpc: async (name: string, args: any) => {
      expect(name).toBe('claim_first_post_publish')
      faults.beforeWrite?.({ metadata: { retryLock: args.p_claim_token } })
      if (missionRow.status !== 'APPROVED' || missionRow.metadata.retryLock || JSON.stringify(missionRow.metadata) !== JSON.stringify(args.p_expected_metadata) || missionRow.updated_at !== args.p_expected_updated_at) {
        return { data: { claimed: false, code: 'STALE_PUBLISH_APPROVAL' } }
      }
      missionRow.status = 'EXECUTING'
      missionRow.metadata = { ...missionRow.metadata, retryLock: args.p_claim_token, snapshot_version: (missionRow.metadata.snapshot_version ?? 1) + 1 }
      return { data: { claimed: true } }
    },
    from: (table: string) => {
      if (table === 'knowledge_facts') {
        return {
          select: (_cols?: string, _opts?: { count?: string }) => ({
            eq: async () => {
              if (options.factReadError) {
                return { data: null, error: options.factReadError, count: null }
              }
              const rows = options.currentFactRows ?? [baseFact40k]
              return { data: rows, error: null, count: rows.length }
            },
          }),
        }
      }

      if (table === 'marketing_missions') {
        const predicates: Array<() => boolean> = []
        let patch: any
        const value = (key: string) => key === 'metadata->>retryLock' ? missionRow.metadata?.retryLock : missionRow[key]
        const query: any = {
          select: () => query,
          eq: (key: string, expected: any) => { predicates.push(() => key === 'metadata' ? JSON.stringify(missionRow.metadata) === expected : value(key) === expected); return query },
          is: (key: string, expected: any) => { predicates.push(() => value(key) == expected); return query },
          maybeSingle: async () => {
            if (faults.readError) return { data: null, error: new Error('latest read failed') }
            if (faults.readNull || !predicates.every((p) => p())) return { data: null, error: null }
            return { data: structuredClone(missionRow), error: null }
          },
          update: (change: any) => { patch = change; return query },
          then: (resolve: any) => {
            faults.beforeWrite?.(patch)
            if (!predicates.every((predicate) => predicate())) return resolve({ data: [], error: null })
            Object.assign(missionRow, patch)
            return resolve({ data: [{ id: missionRow.id, status: missionRow.status }], error: null })
          },
        }
        return query
      }

      if (table === 'mission_events') {
        return {
          insert: async () => ({ error: null }),
        }
      }

      // Supabase harness version / channel tables
      const genericChain: any = {
        select: () => genericChain,
        eq: () => genericChain,
        in: () => Promise.resolve({
          data: [{ channel: 'threads', status: 'verified', account_label: 'test' }],
          error: null,
        }),
        limit: () => genericChain,
        maybeSingle: async () => ({
          data: {
            version_no: 1,
            version: 1,
            is_active: true,
            status: 'active',
          },
        }),
      }
      return genericChain
    },
  }

  return { client, missionRow, faults }
}

function request() {
  return new Request('http://localhost/api/missions/first-post/publish', {
    method: 'POST',
    body: JSON.stringify({ missionId }),
  })
}

describe('first-post publish route Fact snapshot revalidation gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.channelGuard.mockResolvedValue(null)
    mocks.server.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    })
    mocks.resolve.mockResolvedValue({ success: true, workspaceId, role: 'owner' })
    mocks.readiness.mockResolvedValue(undefined)
    mocks.killSwitch.mockResolvedValue({ blocked: false })
    mocks.executeDual.mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      missionId,
      approvalFingerprint: 'dummy',
      receipts: {},
      completedAt: new Date().toISOString(),
    })
  })

  it('rejects with 409 when stored snapshot has 40k price but current fact ledger updated to 50k', async () => {
    const oldSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })
    const db = buildDatabase({
      storedFactSnapshot: oldSnapshot,
      currentFactRows: [baseFact40k, replacementFact50k], // at current time, 50k is active!
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('FACTS_CHANGED')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('rejects with 409 when stored snapshot is missing (legacy missing guard)', async () => {
    const db = buildDatabase({
      storedFactSnapshot: null,
      currentFactRows: [baseFact40k],
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('SNAPSHOT_MISSING')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('rejects with 409 when stored snapshot has workspace mismatch', async () => {
    const mismatchedSnapshot = resolveApprovedFacts({
      workspaceId: otherWorkspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [{ ...baseFact40k, workspace_id: otherWorkspaceId }],
    })
    const db = buildDatabase({
      storedFactSnapshot: mismatchedSnapshot,
      currentFactRows: [baseFact40k],
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('WORKSPACE_MISMATCH')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('fails closed with 503 FACT_READ_FAILED when fact ledger query errors', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k],
    })
    const db = buildDatabase({
      storedFactSnapshot: snapshot,
      factReadError: new Error('Database connection timeout'),
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('FACT_READ_FAILED')
    expect(body.reason).toBe('READ_FAILED')
    expect(body.error).toBe('가게 정보 확인 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('proceeds to execute dual publish when stored snapshot matches current fact ledger', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: new Date().toISOString(),
      rows: [baseFact40k],
    })
    const db = buildDatabase({
      storedFactSnapshot: snapshot,
      currentFactRows: [baseFact40k],
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(mocks.executeDual).toHaveBeenCalledTimes(1)
  })

  it('TOCTOU: prevents publish when fact ledger changes between approval and publish execution', async () => {
    // 1. Approval time: Snapshot was taken with baseFact40k
    const approvalTimeSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })

    // 2. Publish execution time: Date is now 2026-10-22, replacementFact50k is now active!
    const db = buildDatabase({
      storedFactSnapshot: approvalTimeSnapshot,
      currentFactRows: [baseFact40k, replacementFact50k],
    })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({
      ...((await mocks.server()) as any),
      from: db.client.from,
    })

    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('FACTS_CHANGED')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  function readyDatabase() {
    const db = buildDatabase({ storedFactSnapshot: resolveApprovedFacts({ workspaceId, at: new Date().toISOString(), rows: [baseFact40k] }) })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, from: db.client.from })
    return db
  }

  it('pause-between-latest-read-and-final-write retries only result persistence, preserving pause/epoch/version/receipts', async () => {
    const { missionRow, faults } = readyDatabase()
    let paused = false
    faults.beforeWrite = (patch) => {
      if (patch.metadata.executionResult && !paused) {
        paused = true
        missionRow.status = 'PAUSED'
        Object.assign(missionRow.metadata, { execution_state: 'PAUSED', control_epoch: 4, snapshot_version: 9, multi_receipts: [{ receiptId: 'existing' }] })
      }
    }
    expect((await POST(request())).status).toBe(200)
    expect(mocks.executeDual).toHaveBeenCalledTimes(1)
    expect(missionRow.status).toBe('PAUSED')
    expect(missionRow.metadata).toMatchObject({ execution_state: 'PAUSED', control_epoch: 4, snapshot_version: 10, multi_receipts: [{ receiptId: 'existing' }], executionResult: { overallStatus: 'ALL_VERIFIED' } })
    expect(missionRow.metadata.retryLock).toBeUndefined()
  })

  it.each(['error', 'null'])('latest read %s never falls back to stale metadata', async (failure) => {
    const { missionRow, faults } = readyDatabase()
    mocks.executeDual.mockImplementationOnce(async () => {
      faults.readError = failure === 'error'
      faults.readNull = failure === 'null'
      return { overallStatus: 'ALL_VERIFIED', receipts: { threads: { providerPostId: 'submitted' } } }
    })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('RECONCILIATION_REQUIRED')
    expect(missionRow.metadata.retryLock).toBeTruthy()
    expect(missionRow.metadata.executionResult).toBeUndefined()
    expect(mocks.executeDual).toHaveBeenCalledTimes(1)
  })

  it('claim rejects stale same-status metadata instead of overwriting a new snapshot', async () => {
    const { missionRow, faults } = readyDatabase()
    faults.beforeWrite = (patch) => {
      if (patch.metadata.retryLock) Object.assign(missionRow.metadata, { control_epoch: 2, snapshot_version: 7, savedElsewhere: true })
    }
    expect((await POST(request())).status).toBe(409)
    expect(missionRow.metadata).toMatchObject({ control_epoch: 2, snapshot_version: 7, savedElsewhere: true })
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('no-contract legacy claim still permits the real pre-mutation gate', async () => {
    readyDatabase()
    mocks.executeDual.mockImplementationOnce(async (input) => {
      await input.assertMissionGateAllowed({ workspaceId, missionId })
      return { overallStatus: 'ALL_VERIFIED', receipts: {} }
    })
    expect((await POST(request())).status).toBe(200)
  })

  it('G5: 같은 가게·채널에 다른 미션(R1/R2)이 진행 중이면 409로 막고 provider를 호출하지 않는다', async () => {
    const db = buildDatabase({ storedFactSnapshot: resolveApprovedFacts({ workspaceId, at: '2026-10-10T00:00:00Z', rows: [baseFact40k] }), currentFactRows: [baseFact40k] })
    mocks.admin.mockReturnValue(db.client)
    mocks.server.mockResolvedValue({ ...((await mocks.server()) as any), from: db.client.from })
    mocks.channelGuard.mockResolvedValue({ status: 409, body: { error: 'x', code: 'CHANNEL_PUBLISH_IN_PROGRESS' } })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('CHANNEL_PUBLISH_IN_PROGRESS')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('never reports success: true when overallStatus is PARTIAL_SUCCESS (prevents false success)', async () => {
    readyDatabase()
    mocks.executeDual.mockResolvedValueOnce({
      overallStatus: 'PARTIAL_SUCCESS',
      missionId,
      approvalFingerprint: 'dummy',
      receipts: { threads: { stage: 'EXTERNALLY_VERIFIED' } },
      completedAt: new Date().toISOString(),
    })
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.executionResult.overallStatus).toBe('PARTIAL_SUCCESS')
  })

  it('rejects re-publishing an already PUBLISHED_VERIFIED mission with 409 (duplicate publish guard)', async () => {
    const { missionRow } = readyDatabase()
    missionRow.status = 'PUBLISHED_VERIFIED'
    missionRow.metadata.executionResult = { overallStatus: 'ALL_VERIFIED' }
    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('PUBLISH_APPROVAL_CONSUMED')
    expect(body.alreadyPublished).toBe(true)
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('replays existing state without re-dispatching when same Idempotency-Key is provided', async () => {
    const { missionRow } = readyDatabase()
    missionRow.status = 'EXECUTING'
    missionRow.metadata.publishIdempotencyKey = 'test-key-123'
    missionRow.metadata.executionResult = { overallStatus: 'PARTIAL_SUCCESS' }
    const req = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      headers: { 'idempotency-key': 'test-key-123' },
      body: JSON.stringify({ missionId }),
    })
    const response = await POST(req)
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.idempotentReplay).toBe(true)
    expect(body.missionStatus).toBe('EXECUTING')
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })

  it('rejects cross-tenant mission publish when mission belongs to another workspace (tenant isolation)', async () => {
    const { missionRow } = readyDatabase()
    missionRow.workspace_id = otherWorkspaceId
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(mocks.executeDual).not.toHaveBeenCalled()
  })
})
