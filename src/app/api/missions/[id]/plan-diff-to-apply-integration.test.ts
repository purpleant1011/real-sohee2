import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  buildAuthoritativePlanDiffContext,
  computePlanDiff,
} from '@/lib/mission-os/mission-plan-diff'

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  resolveCurrentWorkspaceContext: vi.fn(),
  readPreferredWorkspaceIdFromCookies: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
}))

vi.mock('@/features/auth/active-workspace.server', () => ({
  readPreferredWorkspaceIdFromCookies: mocks.readPreferredWorkspaceIdFromCookies,
}))

vi.mock('@/features/auth/current-workspace', () => ({
  resolveCurrentWorkspaceContext: mocks.resolveCurrentWorkspaceContext,
}))

import { POST as planDiffPOST } from './plan-diff/route'
import { POST as applyDiffPOST } from './apply-diff/route'
import { POST as pausePOST } from './pause/route'
import { POST as rehearsalPOST, PUT as rehearsalPUT } from './rehearsal/route'

describe('PlanDiff Context & Preview-to-Apply Integration Regression', () => {
  const workspaceId = 'ws-test-preview-apply'
  const missionId = 'm-test-preview-apply-99'
  const testUserId = 'user-auth-verified-42'

  const mockContractV1 = {
    contract_version: 1,
    goal: '가을 시그니처 펌 예약 10건 유치',
    success_criterion: {
      metric: 'verified_reservations',
      target_value: 10,
    },
    observation_window: {
      start_at: '2026-10-27T00:00:00.000Z',
      end_at: '2026-11-03T00:00:00.000Z',
    },
    service_scope: ['instagram', 'threads'],
    allowed_actions: ['PUBLISH_POST'],
    forbidden_actions: ['DISCOUNT_OVER_30_PERCENT'],
    budget_caps: {
      max_cost_minor_units: 5000000,
      currency: 'KRW',
    },
    attention_policy: {
      max_escalations: 2,
      notify_on_breach: true,
    },
    fact_version_refs: {},
    policy_version: 'v1',
    approval_fingerprint: 'a'.repeat(64),
    owner_actor: { actor_type: 'user', actor_id: testUserId },
    effective_at: '2026-10-27T00:00:00.000Z',
    expires_at: '2099-11-05T00:00:00.000Z',
  }

  const baseMissionRow = {
    id: missionId,
    workspace_id: workspaceId,
    trace_id: 'trace-test-99',
    status: 'PLANNING',
    goal: '가을 시그니처 펌 예약 10건 유치',
    approval_id: 'appr-uuid-456',
    metadata: {
      snapshot_version: 1,
      contract: mockContractV1,
      applied_plan_idempotency_map: {},
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readPreferredWorkspaceIdFromCookies.mockResolvedValue(workspaceId)
    mocks.resolveCurrentWorkspaceContext.mockResolvedValue({
      status: 'success',
      context: { workspaceId, userId: testUserId, role: 'owner' },
    })
  })

  describe('1. Authoritative PlanDiff Context Builder Invariants', () => {
    it('MUST NOT fabricate synthetic steps or effects when none exist in DB (honest empty/unknown)', () => {
      const emptyMission = {
        id: missionId,
        metadata: {
          snapshot_version: 2,
        },
      }

      const context = buildAuthoritativePlanDiffContext(emptyMission)
      expect(context.missionId).toBe(missionId)
      expect(context.expectedSnapshotVersion).toBe(2)
      expect(context.alreadySubmittedEffects).toEqual([])
      expect(context.unexecutedSteps).toEqual([])
      expect(context.existingApprovals).toEqual([])
    })

    it('faithfully canonicalizes multi_receipts and actual approvals from mission aggregate', () => {
      const missionWithReceiptsAndApprovals = {
        ...baseMissionRow,
        metadata: {
          ...baseMissionRow.metadata,
          multi_receipts: [
            {
              receiptId: 'rcpt-insta-1',
              provider: 'instagram',
              actionType: 'PUBLISH',
              verifiedAt: '2026-10-27T01:00:00.000Z',
              createdAt: '2026-10-27T00:55:00.000Z',
            },
            {
              receiptId: 'rcpt-threads-2',
              provider: 'threads',
              actionType: 'PUBLISH',
              verifiedAt: null, // submitted but not verified
              createdAt: '2026-10-27T01:05:00.000Z',
            },
          ],
          steps: [
            { step_id: 'step-1', summary: '인스타그램 피드 발행', status: 'pending' },
            { step_id: 'step-2', summary: '스레드 소식 등록', status: 'ready' },
          ],
        },
      }

      const context = buildAuthoritativePlanDiffContext(missionWithReceiptsAndApprovals, {
        idempotencyKey: 'idemp_key_custom',
      })

      expect(context.alreadySubmittedEffects).toHaveLength(2)
      expect(context.alreadySubmittedEffects![0]).toEqual({
        effect_id: 'rcpt-insta-1',
        action_type: 'PUBLISH',
        target_channel: 'instagram',
        status: 'VERIFIED',
        submitted_at: '2026-10-27T00:55:00.000Z',
        details: undefined,
      })
      expect(context.alreadySubmittedEffects![1]).toEqual({
        effect_id: 'rcpt-threads-2',
        action_type: 'PUBLISH',
        target_channel: 'threads',
        status: 'SUBMITTED',
        submitted_at: '2026-10-27T01:05:00.000Z',
        details: undefined,
      })
      expect(context.unexecutedSteps).toEqual(['인스타그램 피드 발행', '스레드 소식 등록'])
      expect(context.existingApprovals).toContain('appr-uuid-456')
      expect(context.existingApprovals).toContain('a'.repeat(64))
    })

    it('filters out executed/submitted/running steps and only includes pending/planned/ready steps, ignoring plain strings in steps', () => {
      const missionWithDiverseSteps = {
        ...baseMissionRow,
        metadata: {
          ...baseMissionRow.metadata,
          steps: [
            { step_id: 's1', summary: '완료된 이미지 생성', status: 'completed' },
            { step_id: 's2', summary: '검증된 발행', status: 'verified' },
            { step_id: 's3', summary: '송신된 메시지', status: 'submitted' },
            { step_id: 's4', summary: '실행중인 워커', status: 'running' },
            { step_id: 's5', summary: '대기중인 스레드 발행', status: 'pending' },
            { step_id: 's6', summary: '계획된 피드 게시', status: 'planned' },
            { step_id: 's7', summary: '준비된 알림 전송', status: 'ready' },
            '상태 불명의 일반 문자열 단계', // 일반 문자열은 미실행으로 단정하지 않음
          ],
        },
      }

      const context = buildAuthoritativePlanDiffContext(missionWithDiverseSteps)
      // Only pending, planned, ready should be included. completed/verified/submitted/running and plain strings excluded.
      expect(context.unexecutedSteps).toEqual([
        '대기중인 스레드 발행',
        '계획된 피드 게시',
        '준비된 알림 전송',
      ])
    })

    it('strips secret and PII details from receipt payloads allowing only safe allowlisted keys', () => {
      const missionWithSensitiveReceipts = {
        ...baseMissionRow,
        metadata: {
          ...baseMissionRow.metadata,
          multi_receipts: [
            {
              receiptId: 'rcpt-secret-leak',
              actionType: 'PUBLISH',
              createdAt: '2026-10-27T02:00:00.000Z',
              details: {
                oauth_access_token: 'EAABw...secret_token',
                customer_phone: '010-9999-8888',
                user_email: 'target@example.com',
                raw_http_headers: { Authorization: 'Bearer xxx' },
                action_summary: '안전한 요약 문구',
                published_post_id: 'post_12345678',
                target_url: 'https://instagram.com/p/12345',
              },
            },
            {
              receiptId: 'rcpt-pure-secret',
              actionType: 'PUBLISH',
              createdAt: '2026-10-27T02:00:00.000Z',
              details: {
                api_secret: 'super_secret_value',
                client_cookie: 'session=abc',
              },
            },
          ],
        },
      }

      const context = buildAuthoritativePlanDiffContext(missionWithSensitiveReceipts)
      expect(context.alreadySubmittedEffects).toHaveLength(2)

      // Only allowlisted keys remain; all secrets/PII stripped
      expect(context.alreadySubmittedEffects![0].details).toEqual({
        action_summary: '안전한 요약 문구',
        published_post_id: 'post_12345678',
        target_url: 'https://instagram.com/p/12345',
      })
      expect((context.alreadySubmittedEffects![0].details as any)?.oauth_access_token).toBeUndefined()
      expect((context.alreadySubmittedEffects![0].details as any)?.customer_phone).toBeUndefined()

      // When no allowlisted keys exist, details is undefined (no raw empty leak)
      expect(context.alreadySubmittedEffects![1].details).toBeUndefined()
    })

    it('does not fabricate current timestamp when stable creation date is missing and produces 0 timestamp drift across repeated queries', () => {
      const missionWithoutDates = {
        id: 'mission-timeless',
        metadata: {
          snapshot_version: 1,
          multi_receipts: [
            {
              receiptId: 'rcpt-no-date',
              actionType: 'PUBLISH',
              // No createdAt, created_at, or submitted_at provided
            },
          ],
        },
      }

      const contextQuery1 = buildAuthoritativePlanDiffContext(missionWithoutDates)
      const contextQuery2 = buildAuthoritativePlanDiffContext(missionWithoutDates)

      // Effect must NOT be dropped, but submitted_at must honestly be null (not Date.now())
      expect(contextQuery1.alreadySubmittedEffects).toHaveLength(1)
      expect(contextQuery1.alreadySubmittedEffects![0].effect_id).toBe('rcpt-no-date')
      expect(contextQuery1.alreadySubmittedEffects![0].submitted_at).toBeNull()

      // Repeated queries must produce exact identical submitted_at (0 fabrication / 0 drift)
      expect(contextQuery1.alreadySubmittedEffects![0].submitted_at).toBe(
        contextQuery2.alreadySubmittedEffects![0].submitted_at
      )
    })
  })

  describe('2. Preview-to-Apply Flow Integration with Same Data', () => {
    it('seamlessly previews plan diff and applies it with exact matching payload_hash and context', async () => {
      // Setup DB mocks for both POST /plan-diff and POST /apply-diff
      const mockSupabase = {
        auth: {
          getUser: async () => ({ data: { user: { id: testUserId } } }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: baseMissionRow, error: null }),
                single: async () => ({ data: baseMissionRow, error: null }),
              }),
            }),
          }),
        }),
      }

      let capturedRpcParams: any = null
      const mockAdmin = {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: baseMissionRow, error: null }),
              }),
            }),
          }),
        }),
        rpc: async (fnName: string, params: any) => {
          if (fnName === 'update_mission_snapshot_atomic') {
            capturedRpcParams = params
            return {
              data: {
                ...baseMissionRow,
                metadata: {
                  ...baseMissionRow.metadata,
                  snapshot_version: 2,
                  contract: { ...mockContractV1, contract_version: 2, service_scope: ['instagram'] },
                },
              },
              error: null,
            }
          }
          return { data: null, error: null }
        },
      }

      mocks.createServerSupabaseClient.mockResolvedValue(mockSupabase)
      mocks.createAdminSupabaseClient.mockReturnValue(mockAdmin)

      // Step 1: Preview Plan Diff via POST /api/missions/[id]/plan-diff
      const previewReq = new Request(`http://localhost/api/missions/${missionId}/plan-diff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intentText: '인스타만 해줘, 예산 그대로',
          expectedSnapshotVersion: 1,
        }),
      })

      const previewRes = await planDiffPOST(previewReq, { params: Promise.resolve({ id: missionId }) })
      expect(previewRes.status).toBe(200)
      const previewJson = await previewRes.json()
      expect(previewJson.success).toBe(true)
      expect(previewJson.is_ambiguous).toBe(false)
      const generatedPlanDiff = previewJson.plan_diff
      expect(generatedPlanDiff).toBeDefined()
      expect(generatedPlanDiff.proposed_contract.service_scope).toEqual(['instagram'])
      // Verified honest steps: should be empty array, not fabricated Naver steps!
      expect(generatedPlanDiff.impacted_unexecuted_steps).toEqual([])

      // Step 2: Apply Plan Diff via POST /api/missions/[id]/apply-diff
      const applyReq = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planDiff: generatedPlanDiff,
          expectedSnapshotVersion: 1,
        }),
      })

      const applyRes = await applyDiffPOST(applyReq, { params: Promise.resolve({ id: missionId }) })
      expect(applyRes.status).toBe(200)
      const applyJson = await applyRes.json()
      expect(applyJson.success).toBe(true)
      expect(applyJson.new_contract_version).toBe(2)

      // Step 3: Verify that actual authenticated user ID was recorded as actorId in RPC
      expect(capturedRpcParams).toBeDefined()
      expect(capturedRpcParams.p_actor_id).toBe(testUserId)
      expect(capturedRpcParams.p_actor_type).toBe('user')
    })
  })

  describe('3. Hardened Validation & Explicit Authentication for Mutations', () => {
    it('apply-diff rejects unauthenticated session (user: null) with 401', async () => {
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: null } }) },
      })

      const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planDiff: {
            proposed_contract: mockContractV1,
            idempotency_key: 'idemp-1234',
            payload_hash: 'a'.repeat(64),
          },
          expectedSnapshotVersion: 1,
        }),
      })

      const res = await applyDiffPOST(req, { params: Promise.resolve({ id: missionId }) })
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toContain('인증 세션이 필요합니다')
    })

    it('apply-diff rejects invalid expectedSnapshotVersion (not safe positive integer) with 400', async () => {
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: { id: testUserId } } }) },
      })

      const testCases = [0, -1, 1.5, '1', null, undefined]
      for (const invalidVersion of testCases) {
        const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planDiff: {
              proposed_contract: mockContractV1,
              idempotency_key: 'idemp-1234',
              payload_hash: 'a'.repeat(64),
            },
            expectedSnapshotVersion: invalidVersion,
          }),
        })

        const res = await applyDiffPOST(req, { params: Promise.resolve({ id: missionId }) })
        expect(res.status).toBe(400)
      }
    })

    it('apply-diff rejects invalid idempotency_key syntax / length with 400', async () => {
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: { id: testUserId } } }) },
      })

      const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planDiff: {
            proposed_contract: mockContractV1,
            idempotency_key: 'invalid key with spaces & symbols!',
            payload_hash: 'a'.repeat(64),
          },
          expectedSnapshotVersion: 1,
        }),
      })

      const res = await applyDiffPOST(req, { params: Promise.resolve({ id: missionId }) })
      expect(res.status).toBe(400)
    })

    it('apply-diff rejects invalid payload_hash (not 64-char hex) with 400', async () => {
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: { id: testUserId } } }) },
      })

      const req = new Request(`http://localhost/api/missions/${missionId}/apply-diff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planDiff: {
            proposed_contract: mockContractV1,
            idempotency_key: 'idemp_valid_123',
            payload_hash: 'too_short_not_hex',
          },
          expectedSnapshotVersion: 1,
        }),
      })

      const res = await applyDiffPOST(req, { params: Promise.resolve({ id: missionId }) })
      expect(res.status).toBe(400)
    })

    it('pause route rejects unauthenticated session with 401 and records user.id on success', async () => {
      // 1. Unauthenticated test
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: null } }) },
      })

      const unauthReq = new Request(`http://localhost/api/missions/${missionId}/pause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSnapshotVersion: 1 }),
      })

      const unauthRes = await pausePOST(unauthReq, { params: Promise.resolve({ id: missionId }) })
      expect(unauthRes.status).toBe(401)

      // 2. Authenticated test recording actorId
      let pauseActorId: string | null = null
      mocks.createServerSupabaseClient.mockResolvedValueOnce({
        auth: { getUser: async () => ({ data: { user: { id: testUserId } } }) },
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: baseMissionRow, error: null }),
              }),
            }),
          }),
        }),
      })

      mocks.createAdminSupabaseClient.mockReturnValueOnce({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: baseMissionRow, error: null }),
              }),
            }),
          }),
        }),
        rpc: async (_fnName: string, params: any) => {
          pauseActorId = params.p_actor_id
          return {
            data: {
              ...baseMissionRow,
              metadata: { ...baseMissionRow.metadata, control_epoch: 2, snapshot_version: 2 },
            },
            error: null,
          }
        },
      })

      const authReq = new Request(`http://localhost/api/missions/${missionId}/pause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSnapshotVersion: 1 }),
      })

      const authRes = await pausePOST(authReq, { params: Promise.resolve({ id: missionId }) })
      expect(authRes.status).toBe(200)
      expect(pauseActorId).toBe(testUserId)
    })

    it('rehearsal POST and PUT reject unauthenticated session with 401', async () => {
      mocks.createServerSupabaseClient.mockResolvedValue({
        auth: { getUser: async () => ({ data: { user: null } }) },
      })

      const postReq = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSnapshotVersion: 1 }),
      })
      const postRes = await rehearsalPOST(postReq, { params: Promise.resolve({ id: missionId }) })
      expect(postRes.status).toBe(401)

      const putReq = new Request(`http://localhost/api/missions/${missionId}/rehearsal`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSnapshotVersion: 1 }),
      })
      const putRes = await rehearsalPUT(putReq, { params: Promise.resolve({ id: missionId }) })
      expect(putRes.status).toBe(401)
    })
  })
})
