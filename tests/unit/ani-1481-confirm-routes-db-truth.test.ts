import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockWorkspaceId, mockUserId, mockTextRpcResult, mockImageRpcResult } = vi.hoisted(() => ({
  mockWorkspaceId: '11111111-1111-4111-8111-111111111111',
  mockUserId: '33333333-3333-4333-8333-333333333333',
  mockTextRpcResult: {
    id: 'rule-text-uuid-from-db-v2',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    rule_key: 'text-harness-v1',
    rule_type: 'text_generation',
    version: 2,
    status: 'active',
  },
  mockImageRpcResult: {
    id: 'rule-img-uuid-from-db-v3',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    rule_key: 'image-harness-v1',
    rule_type: 'image_generation',
    version: 3,
    status: 'active',
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: mockUserId } } }),
    },
    from: vi.fn((table: string) => {
      if (table === 'workspace_members') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ workspace_id: mockWorkspaceId }],
                error: null,
              }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis() }
    }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
    rpc: vi.fn((fnName: string, params: any) => {
      if (fnName === 'activate_harness_rule_version') {
        if (params.p_rule_type === 'text_generation') {
          return {
            single: vi.fn().mockResolvedValue({ data: mockTextRpcResult, error: null }),
          }
        }
        if (params.p_rule_type === 'image_generation') {
          return {
            single: vi.fn().mockResolvedValue({ data: mockImageRpcResult, error: null }),
          }
        }
      }
      return { single: vi.fn().mockResolvedValue({ data: null, error: null }) }
    }),
  }),
}))

import { POST as confirmTextPOST } from '@/app/api/onboarding/text-harness/confirm/route'
import { POST as confirmImagePOST } from '@/app/api/onboarding/image-harness/confirm/route'

describe('ANI-1481: Confirm Routes Return DB Truth (Version & ID)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('text-harness confirm route returns DB-persisted version 2 when client sent draft version 1', async () => {
    const req = new Request('http://localhost/api/onboarding/text-harness/confirm', {
      method: 'POST',
      body: JSON.stringify({
        draft: {
          id: 'draft-client-1',
          workspaceId: mockWorkspaceId,
          versionNumber: 1, // Client draft says 1
          rules: { toneAndManner: '다정하고 친근한 톤' },
          testRunsCount: 1,
        },
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
      }),
    })

    const res = await confirmTextPOST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // confirmedVersion must be the DB TRUTH, not client draft's version 1!
    expect(json.confirmedVersion.versionNumber).toBe(2)
    expect(json.confirmedVersion.id).toBe('rule-text-uuid-from-db-v2')
  })

  it('image-harness confirm route returns DB-persisted version 3 when client sent version 1', async () => {
    const validGoldenAssets = [
      {
        id: 'gold-1',
        workspaceId: mockWorkspaceId,
        storagePath: 'p1',
        publicUrl: 'u1',
        category: 'STORE_EXTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 1,
        isGolden: true,
      },
      {
        id: 'gold-2',
        workspaceId: mockWorkspaceId,
        storagePath: 'p2',
        publicUrl: 'u2',
        category: 'SIGNATURE_MENU',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 2,
        isGolden: true,
      },
      {
        id: 'gold-3',
        workspaceId: mockWorkspaceId,
        storagePath: 'p3',
        publicUrl: 'u3',
        category: 'ATMOSPHERE',
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: 'CONFIRMED',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 3,
        isGolden: true,
      },
    ]

    const req = new Request('http://localhost/api/onboarding/image-harness/confirm', {
      method: 'POST',
      body: JSON.stringify({
        assets: validGoldenAssets,
        rules: { modelStyle: '자연 채광' },
        testRunsCount: 1,
        userConfirmationPhrase: '이 기준으로 사용',
        isExplicitlyApproved: true,
        versionNumber: 1, // Client sent 1
      }),
    })

    const res = await confirmImagePOST(req)
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // Must return DB truth!
    expect(json.confirmedVersion.versionNumber).toBe(3)
    expect(json.confirmedVersion.id).toBe('rule-img-uuid-from-db-v3')
  })
})
