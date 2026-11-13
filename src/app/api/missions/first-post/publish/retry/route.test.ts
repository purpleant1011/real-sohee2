import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveApprovedFacts,
  type ApprovedFactRow,
} from '@/features/knowledge/approved-fact-resolver'
import type { ApprovedFactSnapshot } from '@/features/publishing/fact-snapshot-gate'

const missionId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'

const validSnapshot: ApprovedFactSnapshot = {
  workspaceId,
  resolvedAt: '2026-01-01T00:00:00.000Z',
  facts: [
    {
      id: 'fact-1',
      workspace_id: workspaceId,
      category: 'pricing',
      content: '기본 펌 40,000원',
      status: 'active',
      source_candidate_id: 'cand-1',
      approved_by_user_id: 'user-1',
      approved_at: '2026-01-01T00:00:00.000Z',
      valid_from: '2026-01-01T00:00:00.000Z',
      valid_until: null,
      supersedes_fact_id: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  hash: 'hash-40000',
}

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  retryFailedChannelPublish: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }))
vi.mock('@/features/publishing/dual-provider-publish-service', () => ({ retryFailedChannelPublish: mocks.retryFailedChannelPublish }))
vi.mock('@/features/missions/conversational-first-post', () => ({ validateApprovalForPublish: vi.fn() }))

import { POST } from './route'
const request = () => new Request('http://localhost/api/missions/first-post/publish/retry', {
  method: 'POST', body: JSON.stringify({ missionId, targetChannel: 'instagram' }),
})

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

function database(role = 'owner', options?: { factSnapshot?: any; currentFactRows?: ApprovedFactRow[]; factError?: Error }) {
  const currentFactSnapshot = options?.factSnapshot !== undefined
    ? options.factSnapshot
    : resolveApprovedFacts({
        workspaceId,
        at: new Date().toISOString(),
        rows: options?.currentFactRows ?? [baseFact40k],
      })

  const row: any = {
    id: missionId, workspace_id: workspaceId, status: 'FAILED', updated_at: '2026-01-01T00:00:00.000Z',
    metadata: {
      approvedMission: { missionId, approvedFingerprint: 'dummy', approvalId: 'appr-1', status: 'APPROVED_FOR_PUBLISH' },
      payload: { missionId, workspaceId, channels: [{ provider: 'instagram' }] },
      executionResult: { receipts: {} },
      factSnapshot: currentFactSnapshot,
    },
  }
  const faults: { readError?: boolean; readNull?: boolean; beforeWrite?: (patch: any) => void } = {}
  const admin = {
    from(table: string) {
      if (table === 'knowledge_facts') {
        return {
          select: (_cols?: string, _opts?: { count?: string }) => ({
            eq: async () => {
              if (options?.factError) return { data: null, error: options.factError, count: null }
              const rows = options?.currentFactRows ?? [baseFact40k]
              return { data: rows, error: null, count: rows.length }
            },
          }),
        }
      }
      const predicates: Array<(value: any) => boolean> = []
      let change: any = null
      const chain: any = {
        select: () => chain,
        update: (value: any) => { change = value; return chain },
        insert: async () => ({ error: null }),
        eq: (key: string, expected: any) => { predicates.push((value) => key === 'metadata' ? JSON.stringify(value.metadata) === expected : key === 'metadata->>retryLock' ? value.metadata?.retryLock === expected : value[key] === expected); return chain },
        is: (key: string, expected: null) => { predicates.push((value) => (key === 'metadata' ? value.metadata : value.metadata?.retryLock) == expected); return chain },
        maybeSingle: async () => table === 'marketing_missions'
          ? { data: faults.readError || faults.readNull ? null : structuredClone(row), error: faults.readError ? new Error('latest read failed') : null }
          : { data: { workspace_id: workspaceId, role }, error: null },
        then: (resolve: any) => {
          if (table !== 'marketing_missions') return resolve({ data: null, error: null })
          faults.beforeWrite?.(change)
          if (!predicates.every((predicate) => predicate(row))) return resolve({ data: [], error: null })
          Object.assign(row, change)
          return resolve({ data: [{ id: row.id, status: row.status }], error: null })
        },
      }
      return chain
    },
  }
  return { admin, row, faults }
}

describe('first-post channel retry authorization and concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) } })
  })

  it('rejects a viewer before invoking the external publisher', async () => {
    mocks.createAdminSupabaseClient.mockReturnValue(database('viewer').admin)
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe('이 작업은 매장 대표 또는 관리자만 할 수 있어요')
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('never retries a channel already externally verified', async () => {
    const { admin, row } = database()
    row.metadata.executionResult.receipts.instagram = { stage: 'EXTERNALLY_VERIFIED' }
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('permits only one external invocation for concurrent retries of the same channel', async () => {
    const { admin } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    let finish!: (value: any) => void
    mocks.retryFailedChannelPublish.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const first = POST(request())
    const second = POST(request())
    const raced = await Promise.race([first.then(() => 'first'), second.then(() => 'second')])
    expect(raced).toBe('second')
    const rejected = await second
    expect(rejected.status).toBe(409)
    expect(mocks.retryFailedChannelPublish).toHaveBeenCalledTimes(1)
    finish({ overallStatus: 'FAILED', receipts: {} })
    expect((await first).status).toBe(200)
  })

  it('pause-between-latest-read-and-final-write saves receipts without undoing pause', async () => {
    const { admin, row, faults } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.retryFailedChannelPublish.mockResolvedValueOnce({ overallStatus: 'ALL_VERIFIED', receipts: { instagram: { providerPostId: 'published', stage: 'EXTERNALLY_VERIFIED' } } })
    let paused = false
    faults.beforeWrite = (patch) => {
      if (patch.metadata.executionResult?.overallStatus && !paused) {
        paused = true
        row.status = 'PAUSED'
        Object.assign(row.metadata, { execution_state: 'PAUSED', control_epoch: 3, snapshot_version: 8, multi_receipts: [{ receiptId: 'prior' }] })
      }
    }
    expect((await POST(request())).status).toBe(200)
    expect(row.status).toBe('PAUSED')
    expect(row.metadata).toMatchObject({ execution_state: 'PAUSED', control_epoch: 3, snapshot_version: 9, multi_receipts: [{ receiptId: 'prior' }], executionResult: { receipts: { instagram: { providerPostId: 'published' } } } })
    expect(row.metadata.retryLock).toBeUndefined()
    expect(mocks.retryFailedChannelPublish).toHaveBeenCalledTimes(1)
  })

  it.each(['CANCELLED', 'FAILED'])('preserves concurrent %s while attaching the external result', async (status) => {
    const { admin, row } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.retryFailedChannelPublish.mockImplementationOnce(async () => {
      row.status = status
      row.metadata.control_epoch = 7
      row.metadata.snapshot_version = 10
      return { overallStatus: 'ALL_VERIFIED', receipts: {} }
    })
    expect((await POST(request())).status).toBe(200)
    expect(row.status).toBe(status)
    expect(row.metadata.snapshot_version).toBe(11)
    expect(mocks.retryFailedChannelPublish).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'null'])('latest read %s retains lock and requires reconciliation without stale fallback', async (failure) => {
    const { admin, row, faults } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.retryFailedChannelPublish.mockImplementationOnce(async () => {
      faults.readError = failure === 'error'
      faults.readNull = failure === 'null'
      return { overallStatus: 'ALL_VERIFIED', receipts: {} }
    })
    const response = await POST(request())
    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe('RECONCILIATION_REQUIRED')
    expect(row.metadata.retryLock).toBeTruthy()
    expect(row.metadata.executionResult.overallStatus).toBeUndefined()
    expect(mocks.retryFailedChannelPublish).toHaveBeenCalledTimes(1)
  })

  it('retry claim cannot overwrite same-status snapshot changes', async () => {
    const { admin, row, faults } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    faults.beforeWrite = () => Object.assign(row.metadata, { control_epoch: 9, snapshot_version: 12 })
    expect((await POST(request())).status).toBe(409)
    expect(row.metadata).toMatchObject({ control_epoch: 9, snapshot_version: 12 })
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('legacy FAILED retry claims EXECUTING before the real provider write gate', async () => {
    const { admin } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.retryFailedChannelPublish.mockImplementationOnce(async (input) => {
      await input.assertMissionGateAllowed({ workspaceId, missionId })
      return { overallStatus: 'ALL_VERIFIED', receipts: {} }
    })
    expect((await POST(request())).status).toBe(200)
  })

  it('rejects with 409 FACT_REVIEW_REQUIRED when fact snapshot is stale before retryLock', async () => {
    const oldSnapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k, replacementFact50k],
    })
    const { admin } = database('owner', {
      factSnapshot: oldSnapshot,
      currentFactRows: [baseFact40k, replacementFact50k],
    })
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('FACTS_CHANGED')
    expect(body.error).toBe('가게 정보를 다시 확인해야 해요. 글도 함께 다시 만들어 주세요.')
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('rejects with 409 FACT_REVIEW_REQUIRED when fact snapshot is missing on retry', async () => {
    const { admin } = database('owner', { factSnapshot: null })
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    const response = await POST(request())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('FACT_REVIEW_REQUIRED')
    expect(body.reason).toBe('SNAPSHOT_MISSING')
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('fails closed with 503 FACT_READ_FAILED when fact ledger query errors on retry', async () => {
    const snapshot = resolveApprovedFacts({
      workspaceId,
      at: '2026-10-10T00:00:00Z',
      rows: [baseFact40k],
    })
    const { admin } = database('owner', {
      factSnapshot: snapshot,
      factError: new Error('Fact DB read error'),
    })
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    const response = await POST(request())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.code).toBe('FACT_READ_FAILED')
    expect(body.reason).toBe('READ_FAILED')
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })

  it('never reports success: true when retryResult overallStatus is PARTIAL_SUCCESS (prevents false success)', async () => {
    const { admin } = database()
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    mocks.retryFailedChannelPublish.mockResolvedValueOnce({
      overallStatus: 'PARTIAL_SUCCESS',
      missionId,
      approvalFingerprint: 'dummy',
      receipts: { instagram: { stage: 'FAILED', errorMessage: 'Provider rejected' } },
      completedAt: new Date().toISOString(),
    })
    const response = await POST(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.executionResult.overallStatus).toBe('PARTIAL_SUCCESS')
  })

  it('rejects cross-tenant retry when user is not a member of the mission workspace (tenant isolation)', async () => {
    const { admin } = database('none')
    // Override workspace_members check to return empty/null
    const origFrom = admin.from
    admin.from = (table: string) => {
      const chain = origFrom(table)
      if (table === 'workspace_members') {
        chain.maybeSingle = async () => ({ data: null, error: null })
      }
      return chain
    }
    mocks.createAdminSupabaseClient.mockReturnValue(admin)
    const response = await POST(request())
    expect(response.status).toBe(404)
    expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
  })
})
