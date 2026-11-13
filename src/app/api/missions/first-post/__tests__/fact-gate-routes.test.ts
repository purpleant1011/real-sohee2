import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('@/features/publishing/channel-publish-guard', () => ({ findChannelPublishConflict: async () => null }))
import type {
  ApprovedFactSnapshot,
  FactSnapshotResolver,
} from '@/features/publishing/fact-snapshot-gate'
import * as factGateModule from '@/features/publishing/fact-snapshot-gate'

// Hoisted mocks for dependencies
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveDeterministicWorkspace: vi.fn(),
  executeDualProviderPublish: vi.fn(),
  retryFailedChannelPublish: vi.fn(),
  requireFirstPostReady: vi.fn(),
  checkKillSwitchPreflight: vi.fn(),
  recordFunnelEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: mocks.getUser },
    from: (table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'workspace_knowledge_harnesses'
          ? { version_no: 1, is_active: true }
          : { id: 'rule-1', version: 1, status: 'active' },
      }),
      then: (resolve: any) => resolve({
        data: table === 'channel_connections'
          ? [{ channel: 'threads', status: 'verified', account_label: 'test' }]
          : [],
        error: null,
      }),
    }),
  }),
}))

vi.mock('@/features/auth/workspace-context', () => ({
  resolveDeterministicWorkspace: mocks.resolveDeterministicWorkspace,
}))

vi.mock('@/features/publishing/dual-provider-publish-service', () => ({
  executeDualProviderPublish: mocks.executeDualProviderPublish,
  retryFailedChannelPublish: mocks.retryFailedChannelPublish,
}))

vi.mock('@/features/quick-start/first-post-readiness', () => ({
  requireFirstPostReady: mocks.requireFirstPostReady,
}))

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: mocks.checkKillSwitchPreflight.mockResolvedValue({ blocked: false }),
}))

vi.mock('@/lib/safety/meta-live-allowlist', () => ({
  isMetaLiveAllowed: vi.fn().mockReturnValue(true),
}))

vi.mock('@/features/quick-start/funnel-events', () => ({
  recordFunnelEvent: mocks.recordFunnelEvent.mockResolvedValue({}),
}))

let mockMissionTable: Record<string, any> = {}
let updateCalls: Array<{ id: string; update: any; eqFilters: Record<string, any> }> = []

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    rpc: async (name: string, args: any) => {
      if (name !== 'claim_first_post_publish') throw new Error(`Unexpected RPC: ${name}`)
      const row = mockMissionTable[args.p_mission_id]
      if (!row || row.workspace_id !== args.p_workspace_id || row.status !== 'APPROVED'
        || row.metadata?.retryLock
        || JSON.stringify(row.metadata) !== JSON.stringify(args.p_expected_metadata)
        || (row.updated_at ?? null) !== args.p_expected_updated_at) {
        return { data: { claimed: false, code: 'MISSION_STATE_CONFLICT' }, error: null }
      }
      const update = {
        status: 'EXECUTING',
        metadata: { ...row.metadata, retryLock: args.p_claim_token, snapshot_version: (row.metadata?.snapshot_version ?? 1) + 1 },
      }
      updateCalls.push({ id: row.id, update, eqFilters: { workspace_id: args.p_workspace_id } })
      Object.assign(row, update)
      return { data: { claimed: true }, error: null }
    },
    from: (table: string) => {
      if (table === 'marketing_missions') {
        return {
          select: (cols: string) => ({
            eq: (col1: string, val1: any) => ({
              eq: (col2: string, val2: any) => ({
                maybeSingle: async () => {
                  const m = mockMissionTable[val1]
                  if (m && m.workspace_id === val2) return { data: structuredClone(m), error: null }
                  return { data: null, error: null }
                },
              }),
              maybeSingle: async () => {
                const m = mockMissionTable[val1]
                return { data: m ? structuredClone(m) : null, error: null }
              },
            }),
          }),
          update: (fields: any) => {
            const filters: Record<string, any> = {}
            const builder: any = {
              eq: (col: string, val: any) => {
                filters[col] = val
                return builder
              },
              is: (col: string, val: any) => {
                filters[`is_${col}`] = val
                return builder
              },
              select: async (_cols: string) => {
                const id = filters['id']
                updateCalls.push({ id, update: fields, eqFilters: filters })
                const target = mockMissionTable[id]
                if (!target) return { data: [], error: null }
                if (filters['status'] && target.status !== filters['status']) return { data: [], error: null }
                Object.assign(target, fields)
                return { data: [structuredClone(target)], error: null }
              },
            }
            return builder
          },
        }
      }
      if (table === 'workspace_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { role: 'owner' }, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'mission_events') {
        return {
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    },
  }),
}))

import { POST as approveRoute } from '../approve/route'
import { POST as publishRoute } from '../publish/route'
import { POST as retryRoute } from '../publish/retry/route'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'

describe('Fact Gate on Mission Routes (Approve, Publish, Retry)', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const userId = 'user-owner-123'
  const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  const validSnapshot: ApprovedFactSnapshot = {
    workspaceId,
    resolvedAt: '2026-10-21T00:00:00.000Z',
    facts: [
      {
        id: 'fact-1',
        workspace_id: workspaceId,
        category: 'pricing',
        content: '기본 펌 40,000원',
        status: 'active',
        source_candidate_id: 'cand-1',
        approved_by_user_id: userId,
        approved_at: '2026-10-20T10:00:00.000Z',
        valid_from: '2026-10-20T10:00:00.000Z',
        valid_until: null,
        supersedes_fact_id: null,
        created_at: '2026-10-20T10:00:00.000Z',
      },
    ],
    hash: 'hash-40000',
  }

  const basePayload = {
    workspaceId,
    missionId,
    channels: [{ provider: 'threads' }],
    copies: { instagram: { caption: '', hashtags: [] }, threads: { content: '첫 게시물' } },
    imageIds: ['img-1'],
    boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }

  let liveSnapshot: ApprovedFactSnapshot = validSnapshot
  let resolverSpy: any = null

  // Realistic resolver that compares stored vs live workspace and hash
  const realisticResolver: FactSnapshotResolver = {
    loadApprovedFactSnapshot: vi.fn(async () => liveSnapshot),
    assertFactSnapshotCurrent: vi.fn((prev, curr) => {
      if (prev.workspaceId !== curr.workspaceId || prev.hash !== curr.hash) {
        throw new Error('FACT_SNAPSHOT_STALE')
      }
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls = []
    mockMissionTable = {}
    liveSnapshot = structuredClone(validSnapshot)

    resolverSpy = vi.spyOn(factGateModule, 'getDefaultFactSnapshotResolver').mockReturnValue(realisticResolver)

    mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email: 'owner@example.com' } } })
    mocks.resolveDeterministicWorkspace.mockResolvedValue({
      success: true,
      workspaceId,
      role: 'owner',
      statusCode: 200,
    })

    // Setup happy provider responses
    mocks.executeDualProviderPublish.mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      receipts: {
        threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'p1', permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z' },
      },
    })
    mocks.retryFailedChannelPublish.mockResolvedValue({
      overallStatus: 'ALL_VERIFIED',
      receipts: {
        threads: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'p1', permalink: 'https://threads.net/p/1', verifiedAt: '2026-10-23T00:00:00.000Z' },
      },
    })
  })

  afterEach(() => {
    resolverSpy?.mockRestore()
  })

  describe('Happy Paths (Unchanged source passes gates & preserves metadata)', () => {
    it('approves successfully when facts are current and preserves stored snapshot without replacement', async () => {
      const fingerprint = calculateApprovalFingerprint(basePayload as any)
      mockMissionTable[missionId] = {
        id: missionId,
        workspace_id: workspaceId,
        status: 'AWAITING_APPROVAL',
        updated_at: '2026-10-21T00:00:00.000Z',
        metadata: {
          payload: basePayload,
          factSnapshot: validSnapshot,
        },
      }

      // Live loader returns current snapshot with different resolvedAt but same hash
      liveSnapshot = { ...validSnapshot, resolvedAt: '2026-10-21T12:00:00.000Z' }

      const beforeTime = Date.now()
      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          missionId,
          fingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
          at: '2099-01-01T00:00:00.000Z', // valid future ISO: client must not be able to forge server clock
          factSnapshot: { forged: true, hash: 'client-forged-hash' }, // client must not be able to forge snapshot
        }),
      })

      const res = await approveRoute(req)
      const afterTime = Date.now()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verified loader received authenticated server workspace and current server clock (not 2099)
      expect(realisticResolver.loadApprovedFactSnapshot).toHaveBeenCalledTimes(1)
      const [receivedReader, receivedWorkspaceId, receivedAt] = (realisticResolver.loadApprovedFactSnapshot as any).mock.calls[0]
      expect(receivedWorkspaceId).toBe(workspaceId)
      expect(receivedAt).not.toBe('2099-01-01T00:00:00.000Z')
      const atMs = Date.parse(receivedAt)
      expect(atMs).toBeGreaterThanOrEqual(beforeTime - 2000)
      expect(atMs).toBeLessThanOrEqual(afterTime + 2000)

      // Verified receivedReader is the guarded thin gateway (only knowledge_facts + bound workspace)
      expect(() => receivedReader.from('marketing_missions')).toThrow('UNAUTHORIZED_FACT_TABLE')
      expect(() => receivedReader.from('knowledge_facts').select('id').eq('workspace_id', 'other-workspace')).toThrow('UNAUTHORIZED_FACT_QUERY')

      // Verified 1 CAS update to APPROVED
      expect(updateCalls.length).toBe(1)
      expect(updateCalls[0].update.status).toBe('APPROVED')
      expect(mockMissionTable[missionId].status).toBe('APPROVED')

      // Assert stored metadata factSnapshot was NOT forged by client and NOT auto-replaced with liveSnapshot
      expect(mockMissionTable[missionId].metadata.factSnapshot).toEqual(validSnapshot)
      expect(mockMissionTable[missionId].metadata.factSnapshot.hash).toBe(validSnapshot.hash)
      expect(mockMissionTable[missionId].metadata.factSnapshot.hash).not.toBe('client-forged-hash')
    })

    it('publishes successfully when facts are current and dispatches provider once', async () => {
      const fingerprint = calculateApprovalFingerprint(basePayload as any)
      mockMissionTable[missionId] = {
        id: missionId,
        workspace_id: workspaceId,
        status: 'APPROVED',
        updated_at: '2026-10-21T00:00:00.000Z',
        metadata: {
          payload: basePayload,
          approvedMission: {
            approvalId: 'appr-1',
            missionId,
            approvedFingerprint: fingerprint,
            approvedAt: '2026-10-21T00:00:00.000Z',
            approvedByUserId: userId,
            isExplicitlyApproved: true,
            status: 'APPROVED_FOR_PUBLISH',
          },
          factSnapshot: validSnapshot,
        },
      }

      const req = new Request('http://localhost/api/missions/first-post/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      })

      const res = await publishRoute(req)
      expect(res.status).toBe(200)

      // 1 EXECUTING claim and 1 final PUBLISHED_VERIFIED update
      expect(updateCalls.filter((u) => u.update.status === 'EXECUTING').length).toBe(1)
      expect(mocks.executeDualProviderPublish).toHaveBeenCalledTimes(1)
      expect(mockMissionTable[missionId].status).toBe('PUBLISHED_VERIFIED')
      expect(mockMissionTable[missionId].metadata.factSnapshot).toEqual(validSnapshot)
    })

    it('retries successfully when facts are current and claims retryLock once', async () => {
      const fingerprint = calculateApprovalFingerprint(basePayload as any)
      mockMissionTable[missionId] = {
        id: missionId,
        workspace_id: workspaceId,
        status: 'FAILED',
        updated_at: '2026-10-21T00:00:00.000Z',
        metadata: {
          payload: basePayload,
          approvedMission: {
            approvalId: 'appr-1',
            missionId,
            approvedFingerprint: fingerprint,
            approvedAt: '2026-10-21T00:00:00.000Z',
            approvedByUserId: userId,
            isExplicitlyApproved: true,
            status: 'APPROVED_FOR_PUBLISH',
          },
          factSnapshot: validSnapshot,
          executionResult: {
            overallStatus: 'FAILED',
            receipts: { threads: { stage: 'FAILED', error: 'Network fail' } },
          },
        },
      }

      const req = new Request('http://localhost/api/missions/first-post/publish/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId, targetChannel: 'threads' }),
      })

      const res = await retryRoute(req)
      expect(res.status).toBe(200)

      // 1 claim with retryLock and 1 final update
      expect(updateCalls.filter((u) => u.update.metadata?.retryLock).length).toBe(1)
      expect(mocks.retryFailedChannelPublish).toHaveBeenCalledTimes(1)
      expect(mockMissionTable[missionId].status).toBe('PUBLISHED_VERIFIED')
      expect(mockMissionTable[missionId].metadata.factSnapshot).toEqual(validSnapshot)
    })
  })

  describe('Parameterized Matrix: 0 DB mutations and 0 external provider calls on stale / error', () => {
    type TestCase = {
      name: string
      setup: () => void
      expectedStatus: 409 | 503
      expectedCode: string
      expectedReason?: string
    }

    const testCases: TestCase[] = [
      {
        name: 'missing snapshot in stored mission',
        setup: () => {
          mockMissionTable[missionId].metadata.factSnapshot = null
        },
        expectedStatus: 409,
        expectedCode: 'FACT_REVIEW_REQUIRED',
        expectedReason: 'SNAPSHOT_MISSING',
      },
      {
        name: 'price changed (40k -> 50k, hash mismatch)',
        setup: () => {
          liveSnapshot = {
            ...validSnapshot,
            facts: [{ ...validSnapshot.facts[0], content: '기본 펌 50,000원' }],
            hash: 'hash-50000',
          }
        },
        expectedStatus: 409,
        expectedCode: 'FACT_REVIEW_REQUIRED',
        expectedReason: 'FACTS_CHANGED',
      },
      {
        name: 'promotion event expired (empty facts, hash mismatch)',
        setup: () => {
          liveSnapshot = {
            ...validSnapshot,
            facts: [],
            hash: 'hash-empty-expired',
          }
        },
        expectedStatus: 409,
        expectedCode: 'FACT_REVIEW_REQUIRED',
        expectedReason: 'FACTS_CHANGED',
      },
      {
        name: 'loader throws DB read error',
        setup: () => {
          ;(realisticResolver.loadApprovedFactSnapshot as any).mockRejectedValueOnce(new Error('DB_CONN_TIMEOUT'))
        },
        expectedStatus: 503,
        expectedCode: 'FACT_READ_FAILED',
        expectedReason: 'READ_FAILED',
      },
      {
        name: 'adapter not configured (null getter)',
        setup: () => {
          resolverSpy.mockReturnValue(null)
        },
        expectedStatus: 503,
        expectedCode: 'FACT_SOURCE_UNAVAILABLE',
        expectedReason: 'RESOLVER_UNAVAILABLE',
      },
    ]

    describe.each(testCases)('Case: $name', ({ setup, expectedStatus, expectedCode, expectedReason }) => {
      it('blocks POST /api/missions/first-post/approve with 0 DB updates', async () => {
        const fingerprint = calculateApprovalFingerprint(basePayload as any)
        mockMissionTable[missionId] = {
          id: missionId,
          workspace_id: workspaceId,
          status: 'AWAITING_APPROVAL',
          updated_at: '2026-10-21T00:00:00.000Z',
          metadata: {
            payload: basePayload,
            factSnapshot: structuredClone(validSnapshot),
          },
        }
        setup()

        const req = new Request('http://localhost/api/missions/first-post/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            missionId,
            fingerprint,
            isExplicitlyApproved: true,
            explicitPhrase: '이 버전 승인하고 발행',
          }),
        })

        const res = await approveRoute(req)
        expect(res.status).toBe(expectedStatus)
        const body = await res.json()
        expect(body.code).toBe(expectedCode)
        if (expectedReason) expect(body.reason).toBe(expectedReason)
        expect(updateCalls.length).toBe(0)
        expect(mockMissionTable[missionId].status).toBe('AWAITING_APPROVAL')
      })

      it('blocks POST /api/missions/first-post/publish with 0 EXECUTING claim and 0 provider calls', async () => {
        const fingerprint = calculateApprovalFingerprint(basePayload as any)
        mockMissionTable[missionId] = {
          id: missionId,
          workspace_id: workspaceId,
          status: 'APPROVED',
          updated_at: '2026-10-21T00:00:00.000Z',
          metadata: {
            payload: basePayload,
            approvedMission: {
              approvalId: 'appr-1',
              missionId,
              approvedFingerprint: fingerprint,
              approvedAt: '2026-10-21T00:00:00.000Z',
              approvedByUserId: userId,
              isExplicitlyApproved: true,
              status: 'APPROVED_FOR_PUBLISH',
            },
            factSnapshot: structuredClone(validSnapshot),
          },
        }
        setup()

        const req = new Request('http://localhost/api/missions/first-post/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missionId }),
        })

        const res = await publishRoute(req)
        expect(res.status).toBe(expectedStatus)
        const body = await res.json()
        expect(body.code).toBe(expectedCode)
        if (expectedReason) expect(body.reason).toBe(expectedReason)
        expect(updateCalls.filter((u) => u.update.status === 'EXECUTING').length).toBe(0)
        expect(mocks.executeDualProviderPublish).not.toHaveBeenCalled()
        expect(mockMissionTable[missionId].status).toBe('APPROVED')
      })

      it('blocks POST /api/missions/first-post/publish/retry with 0 retryLock claim and 0 provider calls', async () => {
        const fingerprint = calculateApprovalFingerprint(basePayload as any)
        mockMissionTable[missionId] = {
          id: missionId,
          workspace_id: workspaceId,
          status: 'FAILED',
          updated_at: '2026-10-21T00:00:00.000Z',
          metadata: {
            payload: basePayload,
            approvedMission: {
              approvalId: 'appr-1',
              missionId,
              approvedFingerprint: fingerprint,
              approvedAt: '2026-10-21T00:00:00.000Z',
              approvedByUserId: userId,
              isExplicitlyApproved: true,
              status: 'APPROVED_FOR_PUBLISH',
            },
            factSnapshot: structuredClone(validSnapshot),
            executionResult: {
              overallStatus: 'FAILED',
              receipts: { threads: { stage: 'FAILED', error: 'fail' } },
            },
          },
        }
        setup()

        const req = new Request('http://localhost/api/missions/first-post/publish/retry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ missionId, targetChannel: 'threads' }),
        })

        const res = await retryRoute(req)
        expect(res.status).toBe(expectedStatus)
        const body = await res.json()
        expect(body.code).toBe(expectedCode)
        if (expectedReason) expect(body.reason).toBe(expectedReason)
        expect(updateCalls.filter((u) => u.update.metadata?.retryLock).length).toBe(0)
        expect(mocks.retryFailedChannelPublish).not.toHaveBeenCalled()
      })
    })

    it('preserves idempotent replay without fact gate when mission is already PUBLISHED_VERIFIED', async () => {
      mockMissionTable[missionId] = {
        id: missionId,
        workspace_id: workspaceId,
        status: 'PUBLISHED_VERIFIED',
        metadata: {
          executionResult: { overallStatus: 'ALL_VERIFIED', receipts: {} },
        },
      }

      const req = new Request('http://localhost/api/missions/first-post/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId }),
      })

      const res = await publishRoute(req)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.alreadyPublished).toBe(true)
      expect(realisticResolver.loadApprovedFactSnapshot).not.toHaveBeenCalled()
      expect(mocks.executeDualProviderPublish).not.toHaveBeenCalled()
    })
  })
})
