import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

import { POST as approveRoute } from '@/app/api/missions/first-post/approve/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { calculateApprovalFingerprint } from '@/features/missions/conversational-first-post'
import { resolveApprovedFacts, type ApprovedFactRow } from '@/features/knowledge/approved-fact-resolver'

describe('R2-B3 Server Exact Approval Update-Only State Transition', () => {
  const mockUser = { id: 'usr_owner_1' }
  const mockWorkspaceId = 'ws_truth_test'
  const mockMissionId = '11111111-2222-3333-4444-555555555555'

  const canonicalDraftPayload = {
    missionId: mockMissionId,
    workspaceId: mockWorkspaceId,
    channels: [{ provider: 'instagram', handle: '@cafe_sohee' }],
    copies: {
      instagram: { caption: '정본 캡션', hashtags: ['#소희'] },
      threads: { content: '정본 스레드' },
    },
    imageIds: ['img_1', 'img_2', 'img_3'],
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

  function createMockSupabase(overrides: {
    existingMission?: any
    updateError?: any
    updatedRows?: any[]
    updateSpy?: any
  } = {}) {
    const updateSpy = overrides.updateSpy || vi.fn().mockImplementation(() => {
      const builder: any = {
        eq: vi.fn(() => builder),
        in: vi.fn(() => builder),
        select: vi.fn().mockResolvedValue({
          data: overrides.updatedRows ?? [{ id: mockMissionId, status: 'APPROVED' }],
          error: overrides.updateError ?? null,
        }),
      }
      return builder
    })

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
            maybeSingle: vi.fn().mockResolvedValue({
              data: overrides.existingMission !== undefined ? overrides.existingMission : {
                id: mockMissionId,
                workspace_id: mockWorkspaceId,
                status: 'AWAITING_APPROVAL',
                metadata: {
                  payload: canonicalDraftPayload,
                  draftFingerprint: validFingerprint,
                  factSnapshot,
                },
              },
              error: null,
            }),
            update: updateSpy,
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
          return builder
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockResolvedValue({ data: currentFactRows, error: null, count: currentFactRows.length }),
            })),
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
    return { mockClient, updateSpy }
  }

  it('1. rejects approval when mission does not exist in DB (cannot upsert arbitrary client mission)', async () => {
    createMockSupabase({ existingMission: null })

    const req = new Request('http://localhost/api/missions/first-post/approve', {
      method: 'POST',
      body: JSON.stringify({
        missionId: mockMissionId,
        fingerprint: validFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
      }),
    })

    const res = await approveRoute(req)
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.code).toBe('MISSION_NOT_FOUND')
  })

  it('2. rejects approval when mission is not in AWAITING_APPROVAL/DRAFT state', async () => {
    createMockSupabase({
      existingMission: {
        id: mockMissionId,
        workspace_id: mockWorkspaceId,
        status: 'EXECUTING', // Already executing!
        metadata: { payload: canonicalDraftPayload },
      },
    })

    const req = new Request('http://localhost/api/missions/first-post/approve', {
      method: 'POST',
      body: JSON.stringify({
        missionId: mockMissionId,
        fingerprint: validFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
      }),
    })

    const res = await approveRoute(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('INVALID_MISSION_STATE')
  })

  it('3. ignores client-sent payload and verifies fingerprint against server-persisted draft payload', async () => {
    createMockSupabase()

    // Client attempts to send forged payload with different copy
    const forgedClientPayload = {
      ...canonicalDraftPayload,
      copies: {
        instagram: { caption: '변조된 캡션', hashtags: ['#해킹'] },
        threads: { content: '변조된 스레드' },
      },
    }

    const req = new Request('http://localhost/api/missions/first-post/approve', {
      method: 'POST',
      body: JSON.stringify({
        missionId: mockMissionId,
        payload: forgedClientPayload, // Forged payload should be ignored!
        fingerprint: validFingerprint, // Valid against server draft
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
      }),
    })

    const res = await approveRoute(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // The approved mission must have the SERVER's canonical caption, NOT the forged client caption!
    expect(json.approved.approvedFingerprint).toBe(validFingerprint)
  })

  it('4. performs atomic update-only transition from AWAITING_APPROVAL to APPROVED', async () => {
    const { updateSpy } = createMockSupabase()

    const req = new Request('http://localhost/api/missions/first-post/approve', {
      method: 'POST',
      body: JSON.stringify({
        missionId: mockMissionId,
        fingerprint: validFingerprint,
        isExplicitlyApproved: true,
        explicitPhrase: '이 버전 승인하고 발행',
      }),
    })

    const res = await approveRoute(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(updateSpy).toHaveBeenCalled()
  })
})
