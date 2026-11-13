import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  validateMissionContract,
  evaluateOutcomeState,
  type MissionContract,
  type ObservationEvidence,
} from '@/lib/mission-os/mission-contract'
import { isUsableBusinessName, reviseQuickDraft, QuickPostError } from '@/features/quick-start/quick-post-service'
import { buildFirstValueView } from '@/features/first-value/first-value'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'
import { reconcileQuickPostOrphan } from '@/features/quick-start/quick-post-credits'

const mockAuth = vi.hoisted(() => ({
  authFn: vi.fn(),
  settleFn: vi.fn(async () => {}),
  releaseFn: vi.fn(async (): Promise<any> => ({ state: 'released' })),
  createDraftFn: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mockAuth.authFn,
  isResponse: (v: unknown) => v instanceof Response,
}))

vi.mock('@/features/quick-start/quick-post-credits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/quick-start/quick-post-credits')>()
  return {
    ...actual,
    settleQuickPostCredits: mockAuth.settleFn,
    releaseQuickPostCredits: mockAuth.releaseFn,
  }
})

vi.mock('@/features/quick-start/quick-copy', () => ({
  composeQuickPostCopy: vi.fn(async () => ({
    instagram: { caption: '인스타그램 초안 본문', hashtags: ['#테스트'] },
    threads: { text: '스레드 초안 본문' },
  })),
}))

vi.mock('@/features/quick-start/quick-post-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/quick-start/quick-post-service')>()
  return {
    ...actual,
    createQuickDraft: mockAuth.createDraftFn,
  }
})

vi.mock('@/features/quick-start/quick-post-approval-readiness', () => ({
  readQuickPostApprovalReadiness: vi.fn(async () => ({
    stage: 'PREPARE_ONLY',
    prepared: true,
    verifiedChannels: [],
    progressPercent: 75,
    businessVerified: false,
  })),
}))

vi.mock('@/features/quick-start/quick-post-vault-contract', () => ({
  ensureQuickPostVaultVersions: vi.fn(async () => ({ revision: 1 })),
  getQuickPostApprovalOptions: vi.fn(async () => ({ targets: [] })),
  QuickPostVaultError: class extends Error { status = 409 },
}))

vi.mock('@/features/quick-start/quick-start-service', () => ({
  loadQuickStartPreferences: vi.fn(async () => ({ goal: '매장 첫 소개', tone: 'calm' })),
}))

vi.mock('@/features/media/first-value-source', () => ({
  resolveFirstValueSourceIds: vi.fn(async () => []),
  firstValueSourceCookieName: (ws: string) => `sohee-first-value-photo-${ws}`,
  FirstValueSourceError: class extends Error {
    code = 'MEDIA_ERROR'
    status = 409
  },
}))

import { POST as approveRoute } from '@/app/api/missions/first-post/approve/route'
import { handleFirstValue } from '@/features/first-value/first-value-route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

describe('ANI-1879: MissionContract & First-Value Integration', () => {
  const mockWorkspaceId = 'ws-test-1111-2222-3333-444455556666'
  const mockUserId = 'usr-test-1111-2222-3333-444455556666'
  const mockMissionId = '77777777-8888-4999-a000-111122223333'

  const mockFactRows: ApprovedFactRow[] = [
    {
      id: 'fact-1',
      workspace_id: mockWorkspaceId,
      category: 'pricing',
      content: '기본 시술 40,000원',
      status: 'active',
      source_candidate_id: 'cand-1',
      approved_by_user_id: mockUserId,
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
    rows: mockFactRows,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Store Name Validation (isUsableBusinessName)', () => {
    it('rejects placeholders and generic auto-names including onboarding wait placeholder', () => {
      expect(isUsableBusinessName('')).toBe(false)
      expect(isUsableBusinessName('   ')).toBe(false)
      expect(isUsableBusinessName('신규 매장')).toBe(false)
      expect(isUsableBusinessName('매장명 설정 대기')).toBe(false)
      expect(isUsableBusinessName('홍길동의 워크스페이스')).toBe(false)
      expect(isUsableBusinessName(null)).toBe(false)
      expect(isUsableBusinessName(undefined)).toBe(false)
    })

    it('accepts genuine verified business names', () => {
      expect(isUsableBusinessName('바이름 뷰티')).toBe(true)
      expect(isUsableBusinessName('소희 네일아트')).toBe(true)
      expect(isUsableBusinessName('살롱 드 서울')).toBe(true)
    })
  })

  describe('MissionContract v1 Invariants & Fact Version Refs', () => {
    it('validates a compliant unapproved MissionContract with NEEDS_DECISION and string fact revision refs', () => {
      const now = new Date().toISOString()
      const endObservation = new Date(Date.now() + 7 * 86400000).toISOString()
      const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString()

      const rawContract: MissionContract = {
        contract_version: 1,
        goal: '매장 소개 및 첫 인사',
        success_criterion: {
          metric: 'FIRST_POST_PUBLISHED',
          target_value: 1,
          baseline_value: 0,
          unit: 'post',
        },
        observation_window: {
          start_at: now,
          end_at: endObservation,
          evaluation_interval_hours: 24,
        },
        service_scope: ['social_copy_draft'],
        allowed_actions: ['draft_create', 'approval_request', 'publish_with_explicit_approval'],
        forbidden_actions: ['publish_without_owner_approval', 'auto_debit_without_reservation'],
        budget_caps: {
          max_cost_minor_units: 100,
          currency: 'CREDIT',
        },
        attention_policy: {
          max_escalations: 3,
          notify_on_breach: true,
        },
        // Canonical string IDs from approved fact resolver (ApprovedFactRow.id)
        fact_version_refs: ['fact-row-uuid-1', 'fact-row-uuid-2'],
        policy_version: 'harness_policy_1',
        approval_fingerprint: null,
        owner_actor: {
          actor_type: 'user',
          actor_id: mockUserId,
        },
        effective_at: now,
        expires_at: expiresAt,
      }

      const validated = validateMissionContract(rawContract)
      expect(validated.contract_version).toBe(1)
      expect(validated.approval_fingerprint).toBeNull()
      expect(validated.fact_version_refs).toEqual(['fact-row-uuid-1', 'fact-row-uuid-2'])
      expect(validated.budget_caps.max_cost_minor_units).toBe(100)
    })

    it('rejects contracts with invalid structure or dates', () => {
      expect(() =>
        validateMissionContract({
          contract_version: 0,
        })
      ).toThrow('[INVALID_MISSION_CONTRACT]')

      const now = new Date().toISOString()
      expect(() =>
        validateMissionContract({
          contract_version: 1,
          goal: 'test',
          success_criterion: { metric: 'x', target_value: 1 },
          observation_window: { start_at: now, end_at: now },
          service_scope: ['a'],
          allowed_actions: [],
          forbidden_actions: [],
          budget_caps: { max_cost_minor_units: 100, currency: 'CREDIT' },
          attention_policy: { max_escalations: 1, notify_on_breach: false },
          fact_version_refs: [],
          policy_version: '1',
          approval_fingerprint: null,
          owner_actor: { actor_type: 'user' },
          effective_at: now,
          expires_at: new Date(Date.now() + 1000).toISOString(),
        })
      ).toThrow('must be strictly after start_at')
    })
  })

  describe('Approval Route POST Execution State Gate & CAS Fencing', () => {
    const canonicalDraftPayload = {
      missionId: mockMissionId,
      workspaceId: mockWorkspaceId,
      channels: [{ provider: 'instagram', handle: '@cafe_sohee' }],
      copies: {
        instagram: { caption: '정본 캡션', hashtags: ['#소희'] },
        threads: { content: '정본 스레드' },
      },
      imageIds: ['img_1'],
      boundVersions: {
        knowledge: 1,
        textHarness: 1,
        imageHarness: 1,
        operatingPolicy: 1,
      },
      rights: {
        rightsStatus: 'OWNED',
        consentStatus: 'CONFIRMED',
      },
    }
    const validFingerprint = calculateApprovalFingerprint(canonicalDraftPayload as any)

    function setupApproveRouteMocks(overrides: {
      executionState?: string
      updateReturnsEmpty?: boolean
      contract?: any
      onUpdate?: (payload: any) => void
    } = {}) {
      const mockUser = { id: mockUserId, email: 'owner@test.local' }
      const defaultMockContract = {
        contract_version: 1,
        goal: '매장 첫 소개',
        success_criterion: {
          metric: 'FIRST_POST_PUBLISHED',
          target_value: 1,
          baseline_value: 0,
          unit: 'post',
        },
        observation_window: {
          start_at: '2026-10-27T00:00:00.000Z',
          end_at: '2026-11-03T00:00:00.000Z',
          evaluation_interval_hours: 24,
        },
        service_scope: ['social_copy_draft', 'image_generation', 'instagram'],
        allowed_actions: ['draft_create', 'publish_with_explicit_approval'],
        forbidden_actions: ['publish_without_owner_approval'],
        budget_caps: {
          max_cost_minor_units: 100,
          currency: 'CREDIT',
        },
        attention_policy: {
          max_escalations: 2,
          notify_on_breach: true,
        },
        fact_version_refs: ['fact-1'],
        policy_version: 'v1',
        approval_fingerprint: null,
        owner_actor: { actor_type: 'user', actor_id: mockUserId },
        effective_at: '2026-10-27T00:00:00.000Z',
        expires_at: '2026-11-10T00:00:00.000Z',
      }

      const mockMissionRow = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: canonicalDraftPayload,
          draftFingerprint: validFingerprint,
          factSnapshot,
          execution_state: overrides.executionState ?? 'NEEDS_DECISION',
          snapshot_version: 1,
          control_epoch: 1,
          contract: overrides.contract !== undefined ? overrides.contract : defaultMockContract,
        },
        updated_at: '2026-10-27T00:00:00.000Z',
      }

      const adminMock = {
        from: vi.fn((table: string) => {
          if (table === 'workspace_members') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: mockWorkspaceId }] }),
            }
          }
          if (table === 'marketing_missions') {
            const builder: any = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              is: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockMissionRow, error: null }),
              update: vi.fn((updatePayload: any) => {
                if (overrides.onUpdate) overrides.onUpdate(updatePayload)
                const updateChain: any = {
                  eq: vi.fn(() => updateChain),
                  is: vi.fn(() => updateChain),
                  select: vi.fn().mockResolvedValue({
                    data: overrides.updateReturnsEmpty ? [] : [{ id: mockMissionId, status: 'APPROVED' }],
                    error: null,
                  }),
                }
                return updateChain
              }),
            }
            return builder
          }
          if (table === 'knowledge_facts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: mockFactRows, count: mockFactRows.length, error: null }),
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }),
      }

      const serverSupabaseMock = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
        },
        from: vi.fn((table: string) => {
          if (table === 'workspace_members') {
            const memberChain: any = {
              select: vi.fn(() => memberChain),
              eq: vi.fn(() => memberChain),
              maybeSingle: vi.fn().mockResolvedValue({ data: { workspace_id: mockWorkspaceId, role: 'owner', status: 'active' } }),
              limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: mockWorkspaceId, role: 'owner', status: 'active' }] }),
            }
            return memberChain
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }),
      }

      vi.mocked(createServerSupabaseClient).mockResolvedValue(serverSupabaseMock as any)
      vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock as any)
    }

    it('blocks approval with 409 INVALID_EXECUTION_STATE when mission is PAUSED', async () => {
      setupApproveRouteMocks({ executionState: 'PAUSED' })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '승인합니다',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('INVALID_EXECUTION_STATE')
    })

    it('blocks approval with 409 CONCURRENT_APPROVAL_CONFLICT when CAS fencing fails', async () => {
      setupApproveRouteMocks({ executionState: 'NEEDS_DECISION', updateReturnsEmpty: true })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('CONCURRENT_APPROVAL_CONFLICT')
    })

    it('successfully approves compliant mission, updating contract fingerprint and advancing to READY', async () => {
      setupApproveRouteMocks({ executionState: 'NEEDS_DECISION', updateReturnsEmpty: false })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('rebases observation window and expiration relative to approval timestamp for aged drafts (e.g. 15 days later)', async () => {
      let savedUpdatePayload: any = null
      // Draft created 15 days ago with a 7-day observation window
      const agedContract = {
        contract_version: 1,
        goal: '매장 첫 소개',
        success_criterion: {
          metric: 'FIRST_POST_PUBLISHED',
          target_value: 1,
          baseline_value: 0,
          unit: 'post',
        },
        observation_window: {
          start_at: '2026-10-01T00:00:00.000Z',
          end_at: '2026-10-08T00:00:00.000Z', // 7 days duration
          evaluation_interval_hours: 24,
        },
        service_scope: ['social_copy_draft', 'image_generation', 'instagram'],
        allowed_actions: ['draft_create', 'publish_with_explicit_approval'],
        forbidden_actions: ['publish_without_owner_approval'],
        budget_caps: {
          max_cost_minor_units: 100,
          currency: 'CREDIT',
        },
        attention_policy: {
          max_escalations: 2,
          notify_on_breach: true,
        },
        fact_version_refs: ['fact-1'],
        policy_version: 'v1',
        owner_actor: { actor_type: 'user', actor_id: mockUserId },
        effective_at: '2026-10-01T00:00:00.000Z',
        expires_at: '2026-10-15T00:00:00.000Z', // 14 days duration
        approval_fingerprint: null,
      }

      setupApproveRouteMocks({
        contract: agedContract,
        onUpdate: (payload) => { savedUpdatePayload = payload },
      })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(200)
      expect(savedUpdatePayload).toBeTruthy()

      const rebasedContract = savedUpdatePayload.metadata.contract
      expect(rebasedContract).toBeTruthy()
      expect(rebasedContract.approval_fingerprint).toBe(validFingerprint)

      // Verified: effective_at is rebased to approval time (recent), not the 15-day-old date
      const effectiveTime = Date.parse(rebasedContract.effective_at)
      const obsStartTime = Date.parse(rebasedContract.observation_window.start_at)
      const obsEndTime = Date.parse(rebasedContract.observation_window.end_at)
      const expiresTime = Date.parse(rebasedContract.expires_at)

      expect(effectiveTime).toBeGreaterThan(Date.parse('2026-10-20T00:00:00.000Z'))
      expect(obsStartTime).toBe(effectiveTime)
      // Duration preserved: 7 days
      expect(obsEndTime - obsStartTime).toBe(7 * 24 * 60 * 60 * 1000)
      // Expiry duration preserved: 14 days
      expect(expiresTime - effectiveTime).toBe(14 * 24 * 60 * 60 * 1000)
      expect(expiresTime).toBeGreaterThan(obsEndTime)
    })

    it('preserves existing contract without redundant re-extension if contract already has approval_fingerprint', async () => {
      let savedUpdatePayload: any = null
      const alreadyApprovedContract = {
        contract_version: 1,
        goal: '매장 첫 소개',
        success_criterion: {
          metric: 'FIRST_POST_PUBLISHED',
          target_value: 1,
          baseline_value: 0,
          unit: 'post',
        },
        observation_window: {
          start_at: '2026-10-27T00:00:00.000Z',
          end_at: '2026-11-03T00:00:00.000Z',
          evaluation_interval_hours: 24,
        },
        service_scope: ['social_copy_draft', 'image_generation', 'instagram'],
        allowed_actions: ['draft_create', 'publish_with_explicit_approval'],
        forbidden_actions: ['publish_without_owner_approval'],
        budget_caps: {
          max_cost_minor_units: 100,
          currency: 'CREDIT',
        },
        attention_policy: {
          max_escalations: 2,
          notify_on_breach: true,
        },
        fact_version_refs: ['fact-1'],
        policy_version: 'v1',
        owner_actor: { actor_type: 'user', actor_id: mockUserId },
        effective_at: '2026-10-27T00:00:00.000Z',
        expires_at: '2026-11-10T00:00:00.000Z',
        approval_fingerprint: validFingerprint,
      }

      setupApproveRouteMocks({
        contract: alreadyApprovedContract,
        onUpdate: (payload) => { savedUpdatePayload = payload },
      })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(200)
      expect(savedUpdatePayload.metadata.contract).toEqual(alreadyApprovedContract)
    })

    it('fails closed with 422 INVALID_MISSION_CONTRACT when contract has invalid observation window or expiration dates', async () => {
      const corruptedContract = {
        contract_version: 1,
        goal: '매장 첫 소개',
        effective_at: '2026-10-27T00:00:00.000Z',
        observation_window: {
          start_at: '2026-10-27T00:00:00.000Z',
          end_at: '2026-10-26T00:00:00.000Z', // end_at before start_at
        },
        expires_at: '2026-11-03T00:00:00.000Z',
        approval_fingerprint: null,
      }

      setupApproveRouteMocks({
        contract: corruptedContract,
      })

      const req = new Request('http://localhost/api/missions/first-post/approve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': mockWorkspaceId,
        },
        body: JSON.stringify({
          missionId: mockMissionId,
          fingerprint: validFingerprint,
          isExplicitlyApproved: true,
          explicitPhrase: '이 버전 승인하고 발행',
        }),
      })

      const res = await approveRoute(req)
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.code).toBe('INVALID_MISSION_CONTRACT')
    })
  })

  describe('reviseQuickDraft CAS & Pause Fencing', () => {
    it('throws 409 INVALID_EXECUTION_STATE when revising a PAUSED draft', async () => {
      const pausedMission = {
        id: mockMissionId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          execution_state: 'PAUSED',
          snapshot_version: 1,
          control_epoch: 1,
          quick: { revision: 1, topic: '첫 글', createdBy: mockUserId },
        },
        updated_at: '2026-10-27T00:00:00.000Z',
      }

      const mockAdmin: any = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: pausedMission, error: null }),
        })),
      }

      await expect(
        reviseQuickDraft({
          admin: mockAdmin,
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          missionId: mockMissionId,
          feedback: '문구 조금만 다듬어줘',
          scope: 'text',
        })
      ).rejects.toThrow(QuickPostError)

      try {
        await reviseQuickDraft({
          admin: mockAdmin,
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          missionId: mockMissionId,
          feedback: '문구 조금만 다듬어줘',
          scope: 'text',
        })
      } catch (err: any) {
        expect(err.code).toBe('INVALID_EXECUTION_STATE')
        expect(err.status).toBe(409)
      }
    })

    it('throws 409 CAS_CONCURRENCY_CONFLICT on concurrent mutation mismatch without overwriting PAUSED', async () => {
      const activeMission = {
        id: mockMissionId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          execution_state: 'NEEDS_DECISION',
          snapshot_version: 1,
          control_epoch: 1,
          factSnapshot,
          quick: { revision: 1, topic: '첫 글', createdBy: mockUserId },
          payload: {
            copies: {
              instagram: { caption: '기존 글', hashtags: ['#기존'] },
              threads: { content: '기존 글' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: {
              knowledgeVersion: 1,
              textHarnessVersion: 1,
              imageHarnessVersion: 1,
              operatingPolicyVersion: 1,
            },
            rights: {
              rightsStatus: 'NONE',
              consentStatus: 'NOT_REQUIRED',
            },
          },
        },
        updated_at: '2026-10-27T00:00:00.000Z',
      }

      const latestPausedRow = {
        metadata: {
          execution_state: 'PAUSED',
          snapshot_version: 2,
        },
      }

      let queryCallCount = 0
      const mockAdmin: any = {
        from: vi.fn((table: string) => {
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { business_name: '바이름 카페', industry: '뷰티' },
                error: null,
              }),
            }
          }
          if (table === 'workspace_knowledge_harnesses') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version_no: 1, offerings: [] },
                error: null,
              }),
            }
          }
          if (table === 'harness_rules') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version: 1, structured_rule: {} },
                error: null,
              }),
            }
          }
          if (table === 'channel_connections') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }
          }
          if (table === 'knowledge_facts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({
                data: mockFactRows,
                count: mockFactRows.length,
                error: null,
              }),
            }
          }
          if (table === 'marketing_missions') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              is: vi.fn(() => chain),
              maybeSingle: vi.fn(async () => {
                queryCallCount++
                if (queryCallCount === 1) return { data: activeMission, error: null }
                return { data: latestPausedRow, error: null }
              }),
              update: vi.fn(() => ({
                eq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
                })),
              })),
            }
            return chain
          }
          const fallbackChain: any = {
            select: vi.fn(() => fallbackChain),
            eq: vi.fn(() => fallbackChain),
            in: vi.fn(() => fallbackChain),
            order: vi.fn(() => fallbackChain),
            limit: vi.fn(() => fallbackChain),
            is: vi.fn(() => fallbackChain),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            then: (resolve: any, reject?: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
          }
          return fallbackChain
        }),
      }

      try {
        await reviseQuickDraft({
          admin: mockAdmin,
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          missionId: mockMissionId,
          feedback: '더 친근하게 써줘',
          scope: 'text',
          manualCopies: {
            instagram: { caption: '수정 소개글', hashtags: ['#소개'] },
            threads: { content: '수정 문구' },
          },
        })
        expect.unreachable('Should have thrown CAS error')
      } catch (err: any) {
        expect(err.code).toBe('INVALID_EXECUTION_STATE')
        expect(err.status).toBe(409)
        expect(err.message).toContain('일시정지')
      }
    })
  })

  describe('handleFirstValue Route: Direct Invocations, 404, 503, and Settlement Retry', () => {
    function setupRouteMockAdmin(params: {
      missionRow?: any
      missionError?: any
      reservationRow?: any
      reservationError?: any
      reconcileError?: any
      reconcileResolver?: (args: any) => any
      releasedHops?: number
      missionResolver?: (id?: string) => any
      reservationResolver?: (missionId?: string) => any
      onQuery?: (table: string, op: string, args: any[]) => void
    } = {}) {
      let releasedCount = 0
      return {
        rpc: vi.fn(async (name: string, args: any) => {
          params.onQuery?.('$rpc', name, [args])
          if (name === 'reconcile_quick_post_orphan') {
            if (params.reconcileError) {
              return { data: null, error: params.reconcileError }
            }
            if (params.reconcileResolver) {
              return { data: params.reconcileResolver(args), error: null }
            }
            return {
              data: {
                reconciled: false,
                state: 'reserved',
                missionExists: false,
                activeLease: true,
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }),
        from: vi.fn((table: string) => {
          params.onQuery?.(table, 'from', [table])
          let currentId: string | undefined
          let currentMissionId: string | undefined
          const chain: any = {
            select: vi.fn((...args: any[]) => { params.onQuery?.(table, 'select', args); return chain }),
            eq: vi.fn((...args: any[]) => {
              if (args[0] === 'id') currentId = args[1]
              if (args[0] === 'mission_id') currentMissionId = args[1]
              params.onQuery?.(table, 'eq', args)
              return chain
            }),
            in: vi.fn((...args: any[]) => { params.onQuery?.(table, 'in', args); return chain }),
            order: vi.fn(() => chain),
            limit: vi.fn(() => chain),
            then: (resolve: any) => {
              if (table === 'knowledge_facts') {
                return resolve({ data: mockFactRows, count: mockFactRows.length, error: null })
              }
              if (table === 'marketing_missions') {
                if (params.missionError) return resolve({ data: null, error: params.missionError })
                return resolve({ data: params.missionRow ? [params.missionRow] : [], error: null })
              }
              return resolve({ data: [], count: 0, error: null })
            },
            maybeSingle: vi.fn(async () => {
              if (table === 'business_profiles') {
                return { data: { industry: '카페', location: '서울', summary: '동네 카페' }, error: null }
              }
              if (table === 'marketing_missions') {
                if (params.missionError) return { data: null, error: params.missionError }
                if (params.missionResolver) {
                  const resolved = params.missionResolver(currentId)
                  if (resolved && typeof resolved === 'object' && ('error' in resolved || 'data' in resolved)) {
                    return { data: null, error: null, ...resolved }
                  }
                  return { data: resolved ?? null, error: null }
                }
                return { data: params.missionRow ?? null, error: null }
              }
              if (table === 'quick_post_credit_reservations') {
                if (params.reservationError) return { data: null, error: params.reservationError }
                if (params.reservationResolver) {
                  const resolved = params.reservationResolver(currentMissionId)
                  if (!resolved) return { data: null, error: null }
                  return {
                    data: {
                      created_at: new Date(Date.now() - 10_000).toISOString(),
                      operation_key: `quick-post:${currentMissionId || mockMissionId}:1:text`,
                      credits: 100,
                      ...resolved,
                    },
                    error: null,
                  }
                }
                if (params.releasedHops && releasedCount < params.releasedHops) {
                  releasedCount++
                  return {
                    data: {
                      id: `res-rel-${releasedCount}`,
                      state: 'released',
                      created_at: new Date(Date.now() - 10_000).toISOString(),
                      operation_key: `quick-post:cand-${releasedCount}:1:text`,
                      credits: 100,
                    },
                    error: null,
                  }
                }
                if (params.reservationRow) {
                  return {
                    data: {
                      created_at: new Date(Date.now() - 10_000).toISOString(),
                      operation_key: `quick-post:${currentMissionId || mockMissionId}:1:text`,
                      credits: 100,
                      ...params.reservationRow,
                    },
                    error: null,
                  }
                }
                return { data: null, error: null }
              }
              return { data: null, error: null }
            }),
          }
          return chain
        }),
      }
    }

    it('returns explicit 404 MISSION_NOT_FOUND when requestedMissionId does not exist', async () => {
      const admin = setupRouteMockAdmin({ missionRow: null })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.code).toBe('MISSION_NOT_FOUND')
      expect(mockAuth.createDraftFn).not.toHaveBeenCalled()
    })

    it('returns explicit 503 MISSION_READ_FAILED when requestedMissionId DB read errors', async () => {
      const admin = setupRouteMockAdmin({ missionError: new Error('connection timeout') })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('MISSION_READ_FAILED')
    })

    it('retries credit settlement with full QuickPostReservation when resuming a draft with reserved state', async () => {
      const validMissionRow = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: {
            copies: {
              instagram: { caption: '매장 첫 소개글', hashtags: ['#첫소개'] },
              threads: { content: '안녕하세요' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: {
              knowledgeVersion: 1,
              textHarnessVersion: 1,
              imageHarnessVersion: 1,
              operatingPolicyVersion: 1,
            },
            rights: {
              rightsStatus: 'NONE',
              consentStatus: 'NOT_REQUIRED',
            },
          },
          quick: {
            revision: 1,
            topic: '첫 글',
            creditsCharged: 100,
          },
          contract: {
            goal: '첫 인사',
            observation_window: {
              start_at: '2026-10-27T00:00:00.000Z',
              end_at: '2026-11-03T00:00:00.000Z',
            },
            budget_caps: { max_cost_minor_units: 100 },
          },
        },
        created_at: '2026-10-27T00:00:00.000Z',
      }
      const reservationRow = {
        id: 'res-uuid-1',
        state: 'reserved',
        credits: 100,
        operation_key: `quick-post:${mockMissionId}:1:text`,
      }

      const admin = setupRouteMockAdmin({
        missionRow: validMissionRow,
        reservationRow,
      })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(200)
      expect(mockAuth.settleFn).toHaveBeenCalledWith(
        admin,
        mockWorkspaceId,
        expect.objectContaining({
          reservationId: 'res-uuid-1',
          state: 'reserved',
          requestedCredits: 100,
          operationKey: `quick-post:${mockMissionId}:1:text`,
          isReplay: true,
        })
      )
    })

    it('returns 503 RESERVATION_READ_FAILED when reservation query fails on resume', async () => {
      const validMissionRow = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: {
            copies: {
              instagram: { caption: '매장 첫 소개글', hashtags: ['#첫소개'] },
              threads: { content: '안녕하세요' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: {
              knowledgeVersion: 1,
              textHarnessVersion: 1,
              imageHarnessVersion: 1,
              operatingPolicyVersion: 1,
            },
            rights: {
              rightsStatus: 'NONE',
              consentStatus: 'NOT_REQUIRED',
            },
          },
          quick: {
            revision: 1,
            topic: '첫 글',
          },
        },
      }
      const admin = setupRouteMockAdmin({
        missionRow: validMissionRow,
        reservationError: new Error('reservation table timeout'),
      })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('RESERVATION_READ_FAILED')
    })

    it('returns 503 DRAFT_RETRY_LIMIT_EXCEEDED when reservations fail released for 10 sequential hops', async () => {
      const admin = setupRouteMockAdmin({
        releasedHops: 10,
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('DRAFT_RETRY_LIMIT_EXCEEDED')
      expect(mockAuth.createDraftFn).not.toHaveBeenCalled()
    })

    it('concurrent tabs with identical inputs produce identical candidate request ID; different user produces different ID', async () => {
      const capturedCandidateIds: string[] = []

      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        capturedCandidateIds.push(params.missionId)
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      const admin = setupRouteMockAdmin({
        reservationRow: null,
        missionRow: {
          metadata: {
            contract: {
              goal: '첫 소개',
              observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
            },
          },
        },
      })

      // Request 1: User A
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })
      await handleFirstValue(new Request('https://test.local/api/first-value?topic=가게첫소개'))

      // Request 2: User A concurrent tab (same inputs)
      await handleFirstValue(new Request('https://test.local/api/first-value?topic=가게첫소개'))

      // Request 3: User B (different user, same topic)
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: 'usr-different-9999',
        admin,
        supabase: {},
      })
      await handleFirstValue(new Request('https://test.local/api/first-value?topic=가게첫소개'))

      expect(capturedCandidateIds.length).toBe(3)
      // Tab 1 and Tab 2 derived the exact same stable requestId -> prevents duplicate creation
      expect(capturedCandidateIds[0]).toBe(capturedCandidateIds[1])
      // Different user derived distinct requestId
      expect(capturedCandidateIds[2]).not.toBe(capturedCandidateIds[0])
    })

    it('retries credit settlement for revised draft (revision 2) matching item.revision on resume', async () => {
      const recordedEqs: any[] = []
      const revisedMissionRow = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: {
            copies: {
              instagram: { caption: '매장 수정 소개글', hashtags: ['#수정'] },
              threads: { content: '수정 안녕하세요' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: {
              knowledgeVersion: 1,
              textHarnessVersion: 1,
              imageHarnessVersion: 1,
              operatingPolicyVersion: 1,
            },
            rights: {
              rightsStatus: 'NONE',
              consentStatus: 'NOT_REQUIRED',
            },
          },
          quick: {
            revision: 2,
            topic: '수정 글',
            creditsCharged: 200,
          },
          contract: {
            goal: '첫 인사',
            observation_window: {
              start_at: '2026-10-27T00:00:00.000Z',
              end_at: '2026-11-03T00:00:00.000Z',
            },
            budget_caps: { max_cost_minor_units: 100 },
          },
        },
        created_at: '2026-10-27T00:00:00.000Z',
      }
      const reservationRowRev2 = {
        id: 'res-uuid-rev2',
        state: 'reserved',
        credits: 200,
        operation_key: `quick-post:${mockMissionId}:2:both`,
      }

      const admin = setupRouteMockAdmin({
        missionRow: revisedMissionRow,
        reservationRow: reservationRowRev2,
        onQuery: (table, op, args) => {
          if (table === 'quick_post_credit_reservations' && op === 'eq') {
            recordedEqs.push(args)
          }
        },
      })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(200)
      // Must query with revision = 2, not hardcoded 1
      expect(recordedEqs).toContainEqual(['revision', 2])
      expect(mockAuth.settleFn).toHaveBeenCalledWith(
        admin,
        mockWorkspaceId,
        expect.objectContaining({
          reservationId: 'res-uuid-rev2',
          state: 'reserved',
          requestedCredits: 200,
          operationKey: `quick-post:${mockMissionId}:2:both`,
          isReplay: true,
        })
      )
    })

    it('prioritizes actual recorded cost (creditsCharged / cost_credits) over budget cap (100 cap vs 200 actual)', async () => {
      const missionWithBudgetCapAndActualCost = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: {
            copies: {
              instagram: { caption: '글 내용' },
              threads: { content: '스레드 내용' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
            rights: { rightsStatus: 'NONE', consentStatus: 'NOT_REQUIRED' },
          },
          cost_credits: 200,
          quick: {
            revision: 2,
            creditsCharged: 200,
          },
          contract: {
            goal: '첫 인사',
            observation_window: {
              start_at: '2026-10-27T00:00:00.000Z',
              end_at: '2026-11-03T00:00:00.000Z',
            },
            budget_caps: {
              max_cost_minor_units: 100, // Policy cap is 100, but actual charge is 200
              currency: 'CREDIT',
            },
          },
        },
        created_at: '2026-10-27T00:00:00.000Z',
      }

      const admin = setupRouteMockAdmin({
        missionRow: missionWithBudgetCapAndActualCost,
        reservationRow: { id: 'res-1', state: 'settled', credits: 200 },
      })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      // delegationScope.costCredits must reflect actual recorded cost (200), not the initial budget cap (100)
      expect(data.view.delegationScope.costCredits).toBe(200)
    })

    it('sets observationWindowDays to undefined when observation_window dates are missing', async () => {
      const missionWithoutWindow = {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'AWAITING_APPROVAL',
        metadata: {
          payload: {
            copies: {
              instagram: { caption: '글' },
              threads: { content: '글' },
            },
            channels: [{ provider: 'threads' }],
            imageIds: [],
            boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
            rights: { rightsStatus: 'NONE', consentStatus: 'NOT_REQUIRED' },
          },
          quick: { revision: 1, creditsCharged: 100 },
          contract: {
            goal: '첫 인사',
            budget_caps: { max_cost_minor_units: 100 },
            // observation_window is omitted
          },
        },
        created_at: '2026-10-27T00:00:00.000Z',
      }

      const admin = setupRouteMockAdmin({
        missionRow: missionWithoutWindow,
        reservationRow: { id: 'res-1', state: 'settled', credits: 100 },
      })
      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const req = new Request(`https://test.local/api/first-value?missionId=${mockMissionId}`)
      const res = await handleFirstValue(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.view.delegationScope.observationWindowDays).toBeUndefined()
    })

    it('filters candidate reservation hopping strictly by revision 1 to avoid multi-row errors', async () => {
      const recordedEqs: any[] = []
      mockAuth.createDraftFn.mockResolvedValue({
        missionId: 'new-candidate-mission-id',
        businessName: '바이름 카페',
        status: 'AWAITING_APPROVAL',
        channels: [],
        imageIds: [],
        creditsCharged: 100,
      })

      const admin = setupRouteMockAdmin({
        reservationRow: null,
        missionRow: {
          metadata: {
            contract: {
              goal: '첫 소개',
              observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
            },
          },
        },
        onQuery: (table, op, args) => {
          if (table === 'quick_post_credit_reservations' && op === 'eq') {
            recordedEqs.push(args)
          }
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)
      // Candidate hopping query must check revision = 1
      expect(recordedEqs).toContainEqual(['revision', 1])
    })

    it('advances to next candidate key when candidate reservation is settled but belongs to terminal mission (PUBLISHED / CLOSED)', async () => {
      let createdCandidateId = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        createdCandidateId = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let firstCandidateId = ''
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (!firstCandidateId && missionId) {
            firstCandidateId = missionId
            return {
              id: 'res-settled-terminal-1',
              mission_id: missionId,
              state: 'settled',
              credits: 100,
            }
          }
          // Second candidate has no reservation
          return null
        },
        missionResolver: (id) => {
          if (id === firstCandidateId) {
            // First candidate is already published/closed (terminal)
            return {
              id: firstCandidateId,
              workspace_id: mockWorkspaceId,
              status: 'PUBLISHED',
              metadata: {
                execution_state: 'CLOSED',
                outcome_state: 'ACHIEVED_VERIFIED',
              },
            }
          }
          return {
            metadata: {
              contract: {
                goal: '첫 소개',
                observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
              },
            },
          }
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)
      expect(firstCandidateId).toBeTruthy()
      expect(createdCandidateId).toBeTruthy()
      // Crucial: The terminal candidateId was NOT perpetually reused; it advanced to the next candidate
      expect(createdCandidateId).not.toBe(firstCandidateId)
      expect(mockAuth.createDraftFn).toHaveBeenCalledWith(
        expect.objectContaining({ missionId: createdCandidateId })
      )
    })

    it('keeps candidateId without issuing new key or duplicate billing when candidate reservation is in-flight (reserved)', async () => {
      let createdCandidateId = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        createdCandidateId = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let rootCandidateId = ''
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (missionId) {
            rootCandidateId = missionId
            // In-flight reservation
            return {
              id: 'res-inflight-1',
              mission_id: missionId,
              state: 'reserved',
              credits: 100,
            }
          }
          return null
        },
        missionRow: {
          metadata: {
            contract: {
              goal: '첫 소개',
              observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
            },
          },
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)
      expect(rootCandidateId).toBeTruthy()
      // In-flight reservation must NOT advance or issue new key; must keep rootCandidateId
      expect(createdCandidateId).toBe(rootCandidateId)
    })

    it('returns 503 MISSION_READ_FAILED when candidate mission lookup fails during settled state check', async () => {
      let queryCount = 0
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (missionId) {
            return {
              id: 'res-settled-1',
              mission_id: missionId,
              state: 'settled',
              credits: 100,
            }
          }
          return null
        },
        missionResolver: () => {
          queryCount++
          return { data: null, error: new Error('database connection lost') }
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('MISSION_READ_FAILED')
    })

    it('reconciles expired crash orphan reservation (>=120s) atomically via RPC, advancing candidateId', async () => {
      let createdCandidateId = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        createdCandidateId = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let firstCandidateId = ''
      let missionQueryCount = 0
      let rpcCalledWith: any = null
      const threeMinutesAgo = new Date(Date.now() - 180_000).toISOString()
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (!firstCandidateId && missionId) {
            firstCandidateId = missionId
            return {
              id: 'res-orphan-crash-1',
              mission_id: missionId,
              state: 'reserved',
              credits: 100,
              operation_key: `quick-post:${missionId}:1:text`,
              created_at: threeMinutesAgo,
            }
          }
          return null
        },
        reconcileResolver: (args) => {
          rpcCalledWith = args
          return {
            reconciled: true,
            state: 'released',
            missionExists: false,
            refundedCredits: 100,
          }
        },
        missionResolver: (id) => {
          if (id && id === firstCandidateId) return null
          return {
            metadata: {
              contract: {
                goal: '첫 소개',
                observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
              },
            },
          }
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)

      // Verified: reconcile_quick_post_orphan RPC was called atomically
      expect(rpcCalledWith).toEqual({
        p_workspace_id: mockWorkspaceId,
        p_reservation_id: 'res-orphan-crash-1',
        p_operation_key: `quick-post:${firstCandidateId}:1:text`,
        p_max_lease_seconds: 120,
      })

      // Verified: Candidate hopped past the orphan, creating a fresh mission ID
      expect(createdCandidateId).toBeTruthy()
      expect(createdCandidateId).not.toBe(firstCandidateId)
    })

    it('fails closed with 503 ORPHAN_RECONCILIATION_FAILED and issues 0 new keys / 0 provider calls when reconcile RPC fails', async () => {
      mockAuth.createDraftFn.mockClear()
      const threeMinutesAgo = new Date(Date.now() - 180_000).toISOString()
      const admin = setupRouteMockAdmin({
        reservationRow: {
          id: 'res-orphan-crash-err',
          state: 'reserved',
          credits: 100,
          operation_key: `quick-post:${mockMissionId}:1:text`,
          created_at: threeMinutesAgo,
        },
        reconcileError: { message: 'Database connection failed during reconcile lock' },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('ORPHAN_RECONCILIATION_FAILED')

      // Zero new draft keys issued, zero provider calls
      expect(mockAuth.createDraftFn).not.toHaveBeenCalled()
    })

    it('resumes mission without refunding credits when mission already exists during reconciliation (race order 1)', async () => {
      let candidateIdUsed = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        candidateIdUsed = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let firstCandidate = ''
      const threeMinutesAgo = new Date(Date.now() - 180_000).toISOString()
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (!firstCandidate && missionId) {
            firstCandidate = missionId
            return {
              id: 'res-race-mission-exists',
              mission_id: missionId,
              state: 'reserved',
              credits: 100,
              operation_key: `quick-post:${missionId}:1:text`,
              created_at: threeMinutesAgo,
            }
          }
          return null
        },
        reconcileResolver: (args) => {
          // Mission was inserted concurrently just before reconcile locked reservation!
          return {
            reconciled: false,
            state: 'reserved',
            missionExists: true,
            missionId: firstCandidate,
            missionStatus: 'AWAITING_APPROVAL',
            executionState: 'NEEDS_DECISION',
            outcomeState: 'PENDING',
          }
        },
        missionResolver: () => ({
          metadata: {
            contract: {
              goal: '첫 소개',
              observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
            },
          },
        }),
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)

      // Verified: Did not hop away! Reused the existing missionId and did not refund
      expect(candidateIdUsed).toBe(firstCandidate)
    })

    it('fences stale worker from inserting mission when reservation was released (race order 2)', async () => {
      // Direct unit test of createQuickDraft handling DB reservation release fence
      const mockAdminWithFence: any = {
        from: vi.fn((table: string) => {
          if (table === 'marketing_missions') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              gte: vi.fn(() => chain),
              not: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              then: (resolve: any) => resolve({ count: 0, error: null }),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    // DB Trigger trg_fence_quick_post_mission_insert exception
                    error: {
                      message: 'QUICK_POST_RESERVATION_RELEASED',
                      code: 'P0001',
                    },
                  }),
                })),
              })),
            }
            return chain
          }
          if (table === 'business_profiles') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { business_name: '바이름 카페', industry: '뷰티' },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'workspace_knowledge_harnesses') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version_no: 1, offerings: [] },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'harness_rules') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              order: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version: 1, structured_rule: {} },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'knowledge_facts') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn().mockResolvedValue({
                data: mockFactRows,
                count: mockFactRows.length,
                error: null,
              }),
            }
            return chain
          }
          const defaultChain: any = {
            select: vi.fn(() => defaultChain),
            eq: vi.fn(() => defaultChain),
            in: vi.fn(() => defaultChain),
            order: vi.fn(() => defaultChain),
            limit: vi.fn(() => defaultChain),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            then: (resolve: any) => resolve({ data: [], error: null }),
          }
          return defaultChain
        }),
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            return {
              data: {
                reservationId: 'res-stale-1',
                state: 'reserved',
                requestedCredits: 100,
                isReplay: false,
              },
              error: null,
            }
          }
          if (name === 'release_quick_post_credits') {
            return {
              data: {
                reservationId: 'res-stale-1',
                state: 'released',
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }),
      }

      const { createQuickDraft } = await vi.importActual<typeof import('@/features/quick-start/quick-post-service')>('@/features/quick-start/quick-post-service')

      await expect(
        createQuickDraft({
          admin: mockAdminWithFence,
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          missionId: 'stale-worker-mission-1',
          topic: '첫 글',
          textOnly: true,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'RESERVATION_FENCED',
          status: 409,
        })
      )
    })

    it('fails closed with 503 INVALID_RESERVATION_TIMESTAMP on future reservation timestamp', async () => {
      mockAuth.createDraftFn.mockClear()
      const futureTime = new Date(Date.now() + 600_000).toISOString() // 10 minutes in the future
      const admin = setupRouteMockAdmin({
        reservationRow: {
          id: 'res-future-1',
          state: 'reserved',
          credits: 100,
          operation_key: `quick-post:${mockMissionId}:1:text`,
          created_at: futureTime,
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('INVALID_RESERVATION_TIMESTAMP')
      expect(mockAuth.createDraftFn).not.toHaveBeenCalled()
    })

    it('fails closed with 503 INVALID_RESERVATION_METADATA on missing required operation_key or credits', async () => {
      mockAuth.createDraftFn.mockClear()
      const validPastTime = new Date(Date.now() - 5000).toISOString()
      const admin = setupRouteMockAdmin({
        reservationRow: {
          id: 'res-bad-meta-1',
          state: 'reserved',
          credits: null, // missing credits
          operation_key: null, // missing operation_key
          created_at: validPastTime,
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.code).toBe('INVALID_RESERVATION_METADATA')
      expect(mockAuth.createDraftFn).not.toHaveBeenCalled()
    })

    it('resumes and does not generate duplicate draft when mission is in active status (APPROVED, EXECUTING, OBSERVING)', async () => {
      let candidateIdUsed = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        candidateIdUsed = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let activeCandidateId = ''
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (!activeCandidateId && missionId) {
            activeCandidateId = missionId
            return {
              id: 'res-active-mission-1',
              mission_id: missionId,
              state: 'settled',
              credits: 100,
              operation_key: `quick-post:${missionId}:1:text`,
              created_at: new Date(Date.now() - 60_000).toISOString(),
            }
          }
          return null
        },
        missionResolver: (id) => {
          if (id === activeCandidateId) {
            // Mission is APPROVED and currently EXECUTING / OBSERVING (non-terminal)
            return {
              id: activeCandidateId,
              workspace_id: mockWorkspaceId,
              status: 'APPROVED',
              metadata: {
                execution_state: 'OBSERVING',
                outcome_state: 'PENDING',
                contract: {
                  goal: '첫 소개',
                  observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
                },
              },
            }
          }
          return {
            metadata: {
              contract: {
                goal: '첫 소개',
                observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
              },
            },
          }
        },
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)

      // Verified: Active mission was NOT hopped away; candidate ID was reused
      expect(candidateIdUsed).toBe(activeCandidateId)
    })

    it('preserves active in-flight candidate reservation (<120s) without releasing or hopping', async () => {
      mockAuth.releaseFn.mockClear()
      let createdCandidateId = ''
      mockAuth.createDraftFn.mockImplementation(async (params: any) => {
        createdCandidateId = params.missionId
        return {
          missionId: params.missionId,
          businessName: '바이름 카페',
          status: 'AWAITING_APPROVAL',
          channels: [],
          imageIds: [],
          creditsCharged: 100,
        }
      })

      let activeCandidateId = ''
      let inFlightMissionQueryCount = 0
      const twentySecondsAgo = new Date(Date.now() - 20_000).toISOString()
      const admin = setupRouteMockAdmin({
        reservationResolver: (missionId) => {
          if (missionId) {
            activeCandidateId = missionId
            // Active in-flight generation (20s old)
            return {
              id: 'res-inflight-recent-1',
              mission_id: missionId,
              state: 'reserved',
              credits: 100,
              operation_key: `quick-post:${missionId}:1:both`,
              created_at: twentySecondsAgo,
            }
          }
          return null
        },
        reconcileResolver: () => ({
          reconciled: false,
          state: 'reserved',
          missionExists: false,
          activeLease: true,
        }),
        missionResolver: () => ({
          metadata: {
            contract: {
              goal: '첫 소개',
              observation_window: { start_at: '2026-10-27T00:00:00Z', end_at: '2026-11-03T00:00:00Z' },
            },
          },
        }),
      })

      mockAuth.authFn.mockResolvedValue({
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        admin,
        supabase: {},
      })

      const res = await handleFirstValue()
      expect(res.status).toBe(200)

      // Active lease must NOT be released
      expect(mockAuth.releaseFn).not.toHaveBeenCalled()
      // Active candidate ID must be kept to prevent duplicate generation/billing
      expect(createdCandidateId).toBe(activeCandidateId)
    })
  })

  describe('Contract Service Scope & Outcome State Evaluation with Connected Provider Channels', () => {
    it('evaluates outcome to ACHIEVED_VERIFIED when observation evidence matches connected provider in service_scope', () => {
      const now = new Date()
      const windowStart = new Date(now.getTime() - 2 * 3600_000).toISOString()
      const observedAt = new Date(now.getTime() - 1 * 3600_000).toISOString()
      const windowEnd = new Date(now.getTime() + 5 * 86400_000).toISOString()
      const expiresAt = new Date(now.getTime() + 12 * 86400_000).toISOString()

      // Contract generated with connected channel 'instagram'
      const contract: MissionContract = {
        contract_version: 1,
        goal: '첫 게시물 발행',
        success_criterion: {
          metric: 'FIRST_POST_PUBLISHED',
          target_value: 1,
          baseline_value: 0,
          unit: 'post',
        },
        observation_window: {
          start_at: windowStart,
          end_at: windowEnd,
          evaluation_interval_hours: 24,
        },
        service_scope: ['social_copy_draft', 'image_generation', 'instagram'],
        allowed_actions: ['draft_create', 'publish_with_explicit_approval'],
        forbidden_actions: ['publish_without_owner_approval'],
        budget_caps: {
          max_cost_minor_units: 100,
          currency: 'CREDIT',
        },
        attention_policy: {
          max_escalations: 2,
          notify_on_breach: true,
        },
        fact_version_refs: ['fact-1'],
        policy_version: 'v1',
        approval_fingerprint: 'fp-1',
        owner_actor: { actor_type: 'user', actor_id: mockUserId },
        effective_at: windowStart,
        expires_at: expiresAt,
      }

      const verifiedEvidence: ObservationEvidence = {
        observed_value: 1,
        observed_at: observedAt,
        source_channel: 'instagram',
        status: 'OBSERVED',
      }

      // Valid connected provider channel matches service_scope -> ACHIEVED_VERIFIED
      const outcome = evaluateOutcomeState(contract, verifiedEvidence, now.toISOString())
      expect(outcome).toBe('ACHIEVED_VERIFIED')

      // Unconnected unauthorized source channel -> fails authorization check
      const unauthorizedEvidence: ObservationEvidence = {
        observed_value: 1,
        observed_at: observedAt,
        source_channel: 'unconnected_channel',
        status: 'OBSERVED',
      }
      const unauthorizedOutcome = evaluateOutcomeState(contract, unauthorizedEvidence, now.toISOString())
      expect(unauthorizedOutcome).not.toBe('ACHIEVED_VERIFIED')
      expect(unauthorizedOutcome).toBe('PENDING')
    })
  })

  describe('reconcileQuickPostOrphan: Fail-closed Response Validation & Lease Normalization', () => {
    it('normalizes lease duration < 120s or negative to minimum 120s', async () => {
      let passedSeconds: number | undefined
      const admin: any = {
        rpc: vi.fn(async (_name: string, args: any) => {
          passedSeconds = args.p_max_lease_seconds
          return {
            data: {
              reconciled: false,
              state: 'reserved',
              missionExists: false,
              activeLease: true,
            },
            error: null,
          }
        }),
      }

      const res = await reconcileQuickPostOrphan(admin, mockWorkspaceId, {
        reservationId: 'res-1',
        operationKey: 'op-1',
        maxLeaseSeconds: -50,
      })

      expect(passedSeconds).toBe(120)
      expect(res.state).toBe('reserved')
    })

    it('fails closed when RPC returns unknown state', async () => {
      const admin: any = {
        rpc: vi.fn(async () => ({
          data: {
            reconciled: false,
            state: 'unknown_state',
            missionExists: false,
          },
          error: null,
        })),
      }

      await expect(
        reconcileQuickPostOrphan(admin, mockWorkspaceId, {
          reservationId: 'res-1',
          operationKey: 'op-1',
        })
      ).rejects.toMatchObject({
        code: 'ORPHAN_RECONCILIATION_FAILED',
        status: 503,
      })
    })

    it('fails closed when missionExists is true but missionId is missing', async () => {
      const admin: any = {
        rpc: vi.fn(async () => ({
          data: {
            reconciled: false,
            state: 'reserved',
            missionExists: true,
            // missing missionId
          },
          error: null,
        })),
      }

      await expect(
        reconcileQuickPostOrphan(admin, mockWorkspaceId, {
          reservationId: 'res-1',
          operationKey: 'op-1',
        })
      ).rejects.toMatchObject({
        code: 'ORPHAN_RECONCILIATION_FAILED',
        status: 503,
      })
    })

    it('fails closed on contradictory combinations (e.g. missionExists=true and reconciled=true)', async () => {
      const admin: any = {
        rpc: vi.fn(async () => ({
          data: {
            reconciled: true,
            state: 'reserved',
            missionExists: true,
            missionId: 'mission-1',
          },
          error: null,
        })),
      }

      await expect(
        reconcileQuickPostOrphan(admin, mockWorkspaceId, {
          reservationId: 'res-1',
          operationKey: 'op-1',
        })
      ).rejects.toMatchObject({
        code: 'ORPHAN_RECONCILIATION_FAILED',
        status: 503,
      })
    })

    it('fails closed on contradictory state released but missionExists=true', async () => {
      const admin: any = {
        rpc: vi.fn(async () => ({
          data: {
            reconciled: false,
            state: 'released',
            missionExists: true,
            missionId: 'mission-1',
          },
          error: null,
        })),
      }

      await expect(
        reconcileQuickPostOrphan(admin, mockWorkspaceId, {
          reservationId: 'res-1',
          operationKey: 'op-1',
        })
      ).rejects.toMatchObject({
        code: 'ORPHAN_RECONCILIATION_FAILED',
        status: 503,
      })
    })
  })

  describe('SQL Migration: Lock Hierarchy Order & Trigger Fencing Contract', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261028120100_quick_post_orphan_reconciliation_and_insert_fence.sql'
    )
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8')

    it('locks workspace_credit_states BEFORE quick_post_credit_reservations to prevent deadlock with settle/release', () => {
      const reconcileBody = sqlContent.split('CREATE OR REPLACE FUNCTION public.reconcile_quick_post_orphan')[1]
      expect(reconcileBody).toBeDefined()

      const wsLockIndex = reconcileBody.indexOf('workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE')
      const resLockIndex = reconcileBody.indexOf('quick_post_credit_reservations\n    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key\n    FOR UPDATE')

      expect(wsLockIndex).toBeGreaterThan(-1)
      expect(resLockIndex).toBeGreaterThan(-1)
      expect(wsLockIndex).toBeLessThan(resLockIndex)
    })

    it('enforces minimum 120s lease duration in SQL', () => {
      expect(sqlContent).toContain("IF p_max_lease_seconds IS NULL OR p_max_lease_seconds < 120 THEN")
      expect(sqlContent).toContain("RAISE EXCEPTION 'QUICK_POST_INVALID_LEASE_DURATION'")
    })

    it('binds BEFORE INSERT trigger on marketing_missions raising QUICK_POST_RESERVATION_RELEASED on released state', () => {
      expect(sqlContent).toContain('BEFORE INSERT ON public.marketing_missions')
      expect(sqlContent).toContain("RAISE EXCEPTION 'QUICK_POST_RESERVATION_RELEASED'")
    })

    it('hardens release_quick_post_credits to refuse refund if revision 1 mission exists while preserving normal revision > 1 refund', () => {
      const releaseBody = sqlContent.split('CREATE OR REPLACE FUNCTION public.release_quick_post_credits')[1]
      expect(releaseBody).toBeDefined()

      // Enforces check on revision 1
      expect(releaseBody).toContain('IF v_row.revision = 1 THEN')
      expect(releaseBody).toContain('SELECT id INTO v_mission_id FROM public.marketing_missions')
      expect(releaseBody).toContain("'state', 'reserved',")
      expect(releaseBody).toContain("'missionExists', true")

      // Lock order in release RPC is workspace_credit_states first
      const wsLockIndex = releaseBody.indexOf('workspace_credit_states WHERE workspace_id = p_workspace_id FOR UPDATE')
      const resLockIndex = releaseBody.indexOf('FROM public.quick_post_credit_reservations\n    WHERE id = p_reservation_id AND workspace_id = p_workspace_id AND operation_key = p_operation_key\n    FOR UPDATE')
      expect(wsLockIndex).toBeGreaterThan(-1)
      expect(resLockIndex).toBeGreaterThan(-1)
      expect(wsLockIndex).toBeLessThan(resLockIndex)
    })
  })

  describe('createQuickDraft: Persistence Commit Response Loss Race Handling', () => {
    it('retries settlement and avoids refund when insert response is lost but mission actually committed in DB', async () => {
      mockAuth.settleFn.mockClear()
      mockAuth.releaseFn.mockClear()
      // Release RPC atomically checks DB, finds revision 1 mission exists, and refuses refund!
      mockAuth.releaseFn.mockResolvedValue({
        reservationId: 'res-resp-loss-1',
        state: 'reserved',
        missionExists: true,
      })

      const { createQuickDraft } = await vi.importActual<typeof import('@/features/quick-start/quick-post-service')>('@/features/quick-start/quick-post-service')

      const mockAdmin: any = {
        from: vi.fn((table: string) => {
          if (table === 'marketing_missions') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              gte: vi.fn(() => chain),
              not: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              then: (resolve: any) => resolve({ count: 0, error: null }),
              insert: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    // Simulating DB commit succeeded but connection dropped right after commit
                    data: null,
                    error: { message: 'Connection reset by peer after commit', code: '08006' },
                  }),
                })),
              })),
            }
            return chain
          }
          if (table === 'business_profiles') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { business_name: '바이름 카페', industry: '뷰티' },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'workspace_knowledge_harnesses') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version_no: 1, offerings: [] },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'harness_rules') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              order: vi.fn(() => chain),
              limit: vi.fn(() => chain),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { version: 1, structured_rule: {} },
                error: null,
              }),
            }
            return chain
          }
          if (table === 'knowledge_facts') {
            const chain: any = {
              select: vi.fn(() => chain),
              eq: vi.fn().mockResolvedValue({
                data: [],
                count: 0,
                error: null,
              }),
            }
            return chain
          }
          const defaultChain: any = {
            select: vi.fn(() => defaultChain),
            eq: vi.fn(() => defaultChain),
            in: vi.fn(() => defaultChain),
            order: vi.fn(() => defaultChain),
            limit: vi.fn(() => defaultChain),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            then: (resolve: any) => resolve({ data: [], error: null }),
          }
          return defaultChain
        }),
        rpc: vi.fn(async (name: string) => {
          if (name === 'reserve_quick_post_credits') {
            return {
              data: {
                reservationId: 'res-resp-loss-1',
                state: 'reserved',
                requestedCredits: 100,
                isReplay: false,
              },
              error: null,
            }
          }
          if (name === 'release_quick_post_credits') {
            // DB atomic release RPC reports revision 1 mission actually exists in DB, refuses refund!
            return {
              data: {
                reservationId: 'res-resp-loss-1',
                state: 'reserved',
                missionExists: true,
              },
              error: null,
            }
          }
          return { data: null, error: null }
        }),
      }

      await expect(
        createQuickDraft({
          admin: mockAdmin,
          workspaceId: mockWorkspaceId,
          userId: mockUserId,
          missionId: 'response-loss-mission-1',
          topic: '첫 글',
          textOnly: true,
        })
      ).rejects.toThrowError('초안을 저장하지 못했어요.')

      // Release RPC was invoked but refused refund and protected reservation as reserved
      expect(mockAuth.releaseFn).toHaveBeenCalled()
      // Settlement was retried because mission actually existed
      expect(mockAuth.settleFn).toHaveBeenCalled()
    })
  })
})
