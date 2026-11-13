// DB 원자성은 실제 PG suite에서, 라우트의 RPC 계약과 저장 fence는 여기서 검증한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/features/publishing/channel-publish-guard', () => ({ findChannelPublishConflict: async () => null }))
import {
  calculateApprovalFingerprint,
  type ExactApprovalPayload,
} from '@/features/missions/conversational-first-post'
import {
  retryFailedChannelPublish,
} from '@/features/publishing/dual-provider-publish-service'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'
import type { ApprovedFactSnapshot } from '@/features/publishing/fact-snapshot-gate'

const missionId = '11111111-1111-4111-8111-111111111111'
const workspaceId = '22222222-2222-4222-8222-222222222222'
const userId = 'user-owner-123'

const baseFact: ApprovedFactRow = {
  id: 'fact-1',
  workspace_id: workspaceId,
  category: 'pricing',
  content: '기본 시술 40,000원',
  status: 'active',
  source_candidate_id: 'cand-1',
  approved_by_user_id: userId,
  approved_at: '2026-10-21T00:00:00Z',
  valid_from: '2026-10-21T00:00:00Z',
  valid_until: null,
  supersedes_fact_id: null,
  created_at: '2026-10-21T00:00:00Z',
}

const currentSnapshot: ApprovedFactSnapshot = resolveApprovedFacts({
  workspaceId,
  at: '2026-10-21T00:00:00Z',
  rows: [baseFact],
})

function makeBasePayload(): ExactApprovalPayload {
  return {
    missionId,
    workspaceId,
    channels: [{ provider: 'instagram', handle: 'test-store' }],
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
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' } as any,
  }
}

// Hoisted mocks for modules
const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  isMetaLiveAllowed: vi.fn().mockReturnValue(true),
  checkKillSwitchPreflight: vi.fn().mockResolvedValue({ allowed: true }),
  requireFirstPostReady: vi.fn().mockResolvedValue({ isReady: true }),
  recordFunnelEvent: vi.fn().mockResolvedValue(undefined),
  getDefaultFactSnapshotResolver: vi.fn(),
  executeDualProviderPublish: vi.fn(),
  resolveDeterministicWorkspace: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }))
vi.mock('@/features/auth/workspace-context', () => ({ resolveDeterministicWorkspace: mocks.resolveDeterministicWorkspace }))
vi.mock('@/lib/safety/meta-live-allowlist', () => ({ isMetaLiveAllowed: mocks.isMetaLiveAllowed }))
vi.mock('@/lib/safety/kill-switch-guard', () => ({ checkKillSwitchPreflight: mocks.checkKillSwitchPreflight }))
vi.mock('@/features/quick-start/first-post-readiness', () => ({ requireFirstPostReady: mocks.requireFirstPostReady }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.recordFunnelEvent }))
vi.mock('@/features/publishing/dual-provider-publish-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/publishing/dual-provider-publish-service')>()
  return {
    ...actual,
    executeDualProviderPublish: mocks.executeDualProviderPublish,
  }
})

import { POST as publishRoute } from '../publish/route'
import { POST as retryRoute } from '../publish/retry/route'

describe('W7 P0 Duplicate Publish Safeguards (R1 - R6)', () => {
  const mockMissionTable: Record<string, any> = {}
  const mockMemberTable: Record<string, any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveDeterministicWorkspace.mockResolvedValue({ success: true, workspaceId, role: 'owner' })

    const payload = makeBasePayload()
    const fingerprint = calculateApprovalFingerprint(payload)

    mockMemberTable[userId] = {
      workspace_id: workspaceId,
      user_id: userId,
      role: 'owner',
      status: 'active',
    }

    mockMissionTable[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      status: 'APPROVED',
      updated_at: '2026-10-21T00:00:00.000Z',
      metadata: {
        lane: 'QUICK_POST',
        payload,
        approvedFingerprint: fingerprint,
        approvedMission: {
          approvalId: 'appr-1',
          missionId,
          approvedFingerprint: fingerprint,
          status: 'APPROVED_FOR_PUBLISH',
        },
        factSnapshot: currentSnapshot,
        boundVersions: {
          runtimeHarnessVersion: '1.0',
          channelCapabilityVersion: '1.0',
        },
      },
    }

    const mockAdminDb = {
      rpc: async (name: string, args: any) => {
        expect(name).toBe('claim_first_post_publish')
        const row = mockMissionTable[args.p_mission_id]
        if (!row || row.status !== 'APPROVED' || row.metadata.retryLock || JSON.stringify(row.metadata) !== JSON.stringify(args.p_expected_metadata) || row.updated_at !== args.p_expected_updated_at) {
          return { data: { claimed: false, code: 'STALE_PUBLISH_APPROVAL' } }
        }
        row.status = 'EXECUTING'
        row.metadata = { ...row.metadata, retryLock: args.p_claim_token, snapshot_version: (row.metadata.snapshot_version ?? 1) + 1 }
        return { data: { claimed: true } }
      },
      from: (table: string) => {
        if (table === 'knowledge_facts') {
          return {
            select: (_cols?: string, _opts?: { count?: string }) => ({
              eq: async () => ({
                data: [baseFact],
                error: null,
                count: 1,
              }),
            }),
          }
        }

        if (table === 'workspace_members') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: mockMemberTable[userId] ?? null, error: null }),
                  }),
                }),
              }),
            }),
          }
        }

        if (table === 'marketing_missions') {
          const query: any = {
            select: () => query,
            eq: (col: string, val: any) => {
              query._filters = query._filters || {}
              query._filters[col] = val
              return query
            },
            is: (col: string, val: any) => {
              query._isFilters = query._isFilters || {}
              query._isFilters[col] = val
              return query
            },
            maybeSingle: async () => {
              const row = mockMissionTable[missionId]
              return { data: row ? structuredClone(row) : null, error: null }
            },
            update: (patch: any) => {
              query._patch = patch
              return query
            },
            then: (resolve: any) => {
              const row = mockMissionTable[missionId]
              if (!row) return resolve({ data: [], error: null })
              if (query._filters?.status && row.status !== query._filters.status) {
                return resolve({ data: [], error: null })
              }
              if (query._isFilters && 'metadata->>retryLock' in query._isFilters) {
                const expected = query._isFilters['metadata->>retryLock']
                const actual = row.metadata?.retryLock ?? null
                if (actual !== expected) return resolve({ data: [], error: null })
              }
              if (query._filters && 'metadata->>retryLock' in query._filters) {
                const expected = query._filters['metadata->>retryLock']
                const actual = row.metadata?.retryLock
                if (actual !== expected) return resolve({ data: [], error: null })
              }
              if (query._patch) {
                Object.assign(row, query._patch)
                if (query._patch.metadata) {
                  row.metadata = { ...row.metadata, ...query._patch.metadata }
                }
              }
              return resolve({ data: [{ id: row.id, status: row.status }], error: null })
            },
          }
          return query
        }

        if (table === 'mission_events') {
          return { insert: async () => ({ error: null }) }
        }

        // Generic mock for capability / harness versions
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({
            data: [{ channel: 'instagram', status: 'verified', account_label: 'test' }],
            error: null,
          }),
          limit: () => chain,
          maybeSingle: async () => ({
            data: { version_no: 1, version: 1, is_active: true, status: 'active' },
          }),
        }
        return chain
      },
    }

    mocks.createAdminSupabaseClient.mockReturnValue(mockAdminDb)
    mocks.createServerSupabaseClient.mockImplementation(async () => {
      const admin = mocks.createAdminSupabaseClient()
      return {
        auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
        from: admin.from,
      }
    })

    mocks.executeDualProviderPublish.mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      missionId,
      approvalFingerprint: fingerprint,
      receipts: {
        instagram: {
          channel: 'instagram',
          stage: 'EXTERNALLY_VERIFIED',
          permalink: 'https://instagram.com/p/live123',
          receiptId: 'rcpt_1',
          requestId: 'req_1',
          approvalFingerprint: fingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
        },
      },
      completedAt: new Date().toISOString(),
    })
  })

  // --------------------------------------------------------------------------
  // R1: Initial publish is in-flight when retry arrives -> retry 409
  // --------------------------------------------------------------------------
  it('R1: rejects retry with 409 when initial publish is concurrently in flight with shared claimToken', async () => {
    // Suppose initial publish claimed EXECUTING and set retryLock
    mockMissionTable[missionId].status = 'EXECUTING'
    mockMissionTable[missionId].metadata.retryLock = 'initial-claim-token-1234'

    const retryReq = new Request('http://localhost/api/missions/first-post/publish/retry', {
      method: 'POST',
      body: JSON.stringify({ missionId, targetChannel: 'instagram' }),
    })

    const retryRes = await retryRoute(retryReq)
    expect(retryRes.status).toBe(409)
    const body = await retryRes.json()
    expect(body.code).toBe('CONCURRENT_RETRY_IN_PROGRESS')
  })

  // --------------------------------------------------------------------------
  // R2: Legacy EXECUTING + missing target receipt -> 409 HUMAN_REVIEW
  // --------------------------------------------------------------------------
  it('R2: rejects retry with 409 HUMAN_REVIEW when mission is EXECUTING but target receipt is missing', async () => {
    mockMissionTable[missionId].status = 'EXECUTING'
    mockMissionTable[missionId].metadata.retryLock = null // legacy or expired lock
    mockMissionTable[missionId].metadata.executionResult = {
      overallStatus: 'PARTIAL_SUCCESS',
      receipts: {
        threads: { stage: 'EXTERNALLY_VERIFIED', permalink: 'https://threads.net/p/123' },
        // target 'instagram' has NO receipt
      },
    }

    const retryReq = new Request('http://localhost/api/missions/first-post/publish/retry', {
      method: 'POST',
      body: JSON.stringify({ missionId, targetChannel: 'instagram' }),
    })

    const retryRes = await retryRoute(retryReq)
    expect(retryRes.status).toBe(409)
    const body = await retryRes.json()
    expect(body.code).toBe('STRANDED_EXECUTION_NEEDS_REVIEW')
    expect(body.reason).toBe('HUMAN_REVIEW')
  })

  // --------------------------------------------------------------------------
  // R3: CAS claim failure prevents provider dispatch
  // --------------------------------------------------------------------------
  it('R3: fails CAS claim when mission is claimed concurrently and does not dispatch provider', async () => {
    // Mission is APPROVED, but another worker concurrently claimed retryLock
    mockMissionTable[missionId].status = 'APPROVED'
    mockMissionTable[missionId].metadata.retryLock = 'concurrently-claimed-lock'

    const publishReq = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId }),
    })

    const publishRes = await publishRoute(publishReq)
    expect(publishRes.status).toBe(409)
    const body = await publishRes.json()
    expect(body.code).toBe('STALE_PUBLISH_APPROVAL')
    expect(mocks.executeDualProviderPublish).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // R4: RESULT_UNKNOWN without providerPostId blocks automated retry
  // --------------------------------------------------------------------------
  it('R4: blocks automated retry when previous attempt was RESULT_UNKNOWN without providerPostId', async () => {
    mockMissionTable[missionId].status = 'FAILED'
    mockMissionTable[missionId].metadata.retryLock = null
    mockMissionTable[missionId].metadata.executionResult = {
      overallStatus: 'FAILED',
      receipts: {
        instagram: {
          channel: 'instagram',
          stage: 'RESULT_UNKNOWN',
          receiptId: 'rcpt_1',
          requestId: 'req_1',
          approvalFingerprint: mockMissionTable[missionId].metadata.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
          errorMessage: 'Request timeout to Meta API',
        },
      },
    }

    const retryReq = new Request('http://localhost/api/missions/first-post/publish/retry', {
      method: 'POST',
      body: JSON.stringify({ missionId, targetChannel: 'instagram' }),
    })

    const retryRes = await retryRoute(retryReq)
    expect(retryRes.status).toBe(409)
    const body = await retryRes.json()
    expect(body.code).toBe('RESULT_UNKNOWN_RETRY_BLOCKED')
    expect(body.reason).toBe('HUMAN_REVIEW')
  })

  // --------------------------------------------------------------------------
  // R5: Known providerPostId triggers readback only (never calls publish)
  // --------------------------------------------------------------------------
  it('R5: performs readback only without calling publish when providerPostId is already known', async () => {
    const fakePublish = vi.fn()
    const fakeReadback = vi.fn().mockResolvedValue({
      isLive: true,
      permalink: 'https://instagram.com/p/live123',
      verifiedAt: new Date().toISOString(),
    })

    const result = await retryFailedChannelPublish({
      approvedMission: mockMissionTable[missionId].metadata.approvedMission,
      currentPayload: mockMissionTable[missionId].metadata.payload,
      targetChannel: 'instagram',
      existingReceipts: {
        instagram: {
          channel: 'instagram',
          stage: 'PROVIDER_ACCEPTED',
          providerPostId: 'meta-post-999',
          receiptId: 'rcpt_1',
          requestId: 'req_1',
          approvalFingerprint: mockMissionTable[missionId].metadata.approvedFingerprint,
          attemptCount: 1,
          lastAttemptAt: new Date().toISOString(),
        },
      },
      adapters: {
        instagram: {
          publish: fakePublish,
          readback: fakeReadback,
        },
      },
    })

    expect(fakePublish).not.toHaveBeenCalled()
    expect(fakeReadback).toHaveBeenCalledWith('meta-post-999', expect.objectContaining({ channel: 'instagram' }))
    expect(result.overallStatus).toBe('ALL_VERIFIED')
    expect(result.receipts.instagram?.stage).toBe('EXTERNALLY_VERIFIED')
  })

  // --------------------------------------------------------------------------
  // R6: Stale owner fencing rejects completion if retryLock was modified
  // --------------------------------------------------------------------------
  it('R6: fails with RECONCILIATION_REQUIRED when retryLock was stolen before publish completes', async () => {
    // When executeDualProviderPublish runs, another process steals the lock
    mocks.executeDualProviderPublish.mockImplementation(async () => {
      mockMissionTable[missionId].metadata.retryLock = 'stolen-token-999'
      return {
        overallStatus: 'ALL_VERIFIED',
        missionId,
        approvalFingerprint: 'dummy',
        receipts: {
          instagram: {
            channel: 'instagram',
            stage: 'EXTERNALLY_VERIFIED',
            permalink: 'https://instagram.com/p/live123',
            receiptId: 'rcpt_1',
            requestId: 'req_1',
            approvalFingerprint: 'dummy',
            attemptCount: 1,
            lastAttemptAt: new Date().toISOString(),
          },
        },
        completedAt: new Date().toISOString(),
      }
    })

    const publishReq = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId }),
    })

    const publishRes = await publishRoute(publishReq)
    expect(publishRes.status).toBe(500)
    const body = await publishRes.json()
    expect(body.code).toBe('RECONCILIATION_REQUIRED')
  })
})
