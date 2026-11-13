import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { executeDualProviderPublish } from '@/features/publishing/dual-provider-publish-service'

describe('R2-B4 Publish API Client Fallback Elimination', () => {
  const mockUser = { id: 'usr_owner_1' }
  const mockWorkspaceId = 'ws_truth_test'
  const mockMissionId = '22222222-3333-4444-5555-666666666666'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createMockSupabase(overrides: {
    missionRow?: any
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
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: overrides.missionRow !== undefined ? overrides.missionRow : {
                id: mockMissionId,
                workspace_id: mockWorkspaceId,
                status: 'APPROVED',
                metadata: {}, // Empty metadata! Corrupted!
              },
              error: null,
            }),
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
    }

    vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as any)
    vi.mocked(createAdminSupabaseClient).mockReturnValue(mockClient as any)
    return { mockClient }
  }

  it('1. fails closed with CORRUPTED_APPROVAL_METADATA when server metadata is missing, even if client supplies body.approvedMission or body.currentPayload', async () => {
    createMockSupabase({
      missionRow: {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'APPROVED',
        metadata: {}, // Missing approvedMission and payload in DB
      },
    })

    const clientSuppliedRescue = {
      approvedMission: {
        missionId: mockMissionId,
        workspaceId: mockWorkspaceId,
        approvedFingerprint: 'fake_fp',
        approvedAt: new Date().toISOString(),
      },
      currentPayload: {
        missionId: mockMissionId,
        workspaceId: mockWorkspaceId,
        channels: [],
        copies: { instagram: { caption: '가짜' }, threads: { content: '가짜' } },
        imageIds: [],
        boundVersions: { knowledge: 1, textHarness: 1, imageHarness: 1, operatingPolicy: 1 },
        rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
      },
    }

    const req = new Request('http://localhost/api/missions/first-post/publish', {
      method: 'POST',
      body: JSON.stringify({
        missionId: mockMissionId,
        ...clientSuppliedRescue, // Client tries to rescue corrupted DB with body
      }),
    })

    const res = await publishRoute(req)
    const json = await res.json()

    // Must FAIL CLOSED! Client body must NEVER rescue server ledger!
    expect(res.status).toBe(422)
    expect(json.code).toBe('CORRUPTED_APPROVAL_METADATA')
    expect(executeDualProviderPublish).not.toHaveBeenCalled()
  })
})
