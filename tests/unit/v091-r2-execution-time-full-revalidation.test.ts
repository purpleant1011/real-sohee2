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
  checkKillSwitchPreflight: vi.fn(),
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
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { executeDualProviderPublish } from '@/features/publishing/dual-provider-publish-service'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'

describe('R2-B5 Execution-time Full Revalidation', () => {
  const mockUser = { id: 'usr_owner_1' }
  const mockWorkspaceId = 'ws_truth_test'
  const mockMissionId = '33333333-4444-5555-6666-777777777777'

  const validPayload = {
    missionId: mockMissionId,
    workspaceId: mockWorkspaceId,
    channels: [{ provider: 'instagram', handle: '@cafe_sohee' }],
    copies: { instagram: { caption: '정본 캡션', hashtags: ['#소희'] }, threads: { content: '정본' } },
    imageIds: ['img_1', 'img_2', 'img_3'],
    boundVersions: {
      knowledge: 1,
      textHarness: 2,
      imageHarness: 1,
      operatingPolicy: 1,
    },
    rights: {
      rightsStatus: 'OWNED',
      consentStatus: 'CONFIRMED',
    },
  }

  const validFingerprint = calculateApprovalFingerprint(validPayload as any)
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
    vi.mocked(checkKillSwitchPreflight).mockResolvedValue({ blocked: false })
  })

  afterEach(() => {
    if (origAllowlist !== undefined) {
      process.env.META_LIVE_WORKSPACE_ALLOWLIST = origAllowlist
    } else {
      delete process.env.META_LIVE_WORKSPACE_ALLOWLIST
    }
  })

  function createMockSupabase(overrides: {
    currentTextHarnessVersion?: number
    channelStatus?: string
    dailyPublishedCount?: number
  } = {}) {
    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
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
            gte: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: mockMissionId,
                workspace_id: mockWorkspaceId,
                status: 'APPROVED',
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
                },
              },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          }
          return builder
        }
        if (table === 'harness_rules') {
          let ruleType = ''
          const builder: any = {
            select: vi.fn(() => builder),
            eq: vi.fn((col: string, val: string) => {
              if (col === 'rule_type') ruleType = val
              return builder
            }),
            limit: vi.fn(() => builder),
            maybeSingle: vi.fn(() => {
              if (ruleType === 'text_generation') {
                return Promise.resolve({
                  data: {
                    id: 'rule_txt',
                    // Test drift: if currentTextHarnessVersion is set to 3, it drifts from bound version 2!
                    version: overrides.currentTextHarnessVersion !== undefined ? overrides.currentTextHarnessVersion : 2,
                    status: 'active',
                  },
                  error: null,
                })
              }
              if (ruleType === 'image_generation') {
                return Promise.resolve({
                  data: { id: 'rule_img', version: 1, status: 'active' },
                  error: null,
                })
              }
              if (ruleType === 'approval_policy') {
                return Promise.resolve({
                  data: { id: 'rule_pol', version: 1, status: 'active', structured_rule: { maxDailyPublishCount: 5 } },
                  error: null,
                })
              }
              return Promise.resolve({ data: null, error: null })
            }),
          }
          return builder
        }
        if (table === 'workspace_knowledge_harnesses') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { harness_version_id: 'kn_1', version_no: 1, is_active: true },
              error: null,
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  channel: 'instagram',
                  status: overrides.channelStatus !== undefined ? overrides.channelStatus : 'connected',
                  account_label: '@cafe_sohee',
                },
              ],
              error: null,
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
    return { mockClient }
  }

  it('1. blocks publish and invalidates approval with HARNESS_VERSION_DRIFT_DETECTED when text harness was updated post-approval', async () => {
    // Current text harness is version 3, but mission was approved with version 2!
    createMockSupabase({ currentTextHarnessVersion: 3 })

    const req = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: mockMissionId }),
    })

    const res = await publishRoute(req)
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.code).toBe('HARNESS_VERSION_DRIFT_DETECTED')
    expect(executeDualProviderPublish).not.toHaveBeenCalled()
  })

  it('2. blocks publish with CHANNEL_CREDENTIALS_INVALID when target channel connection status is disconnected or error', async () => {
    createMockSupabase({ channelStatus: 'disconnected' })

    const req = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({ missionId: mockMissionId }),
    })

    const res = await publishRoute(req)
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.code).toBe('CHANNEL_CREDENTIALS_INVALID')
    expect(executeDualProviderPublish).not.toHaveBeenCalled()
  })
})
