import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proposalUploadQuery } from '../fixtures/first-post-upload-query'

const mockUpload = vi.hoisted(() => ({ copyright: 'owned', identifiablePeople: 'none' }))

const { mockWorkspaceId, mockUserId, mockImageHarnessRule } = vi.hoisted(() => ({
  mockWorkspaceId: '11111111-1111-4111-8111-111111111111',
  mockUserId: '33333333-3333-4333-8333-333333333333',
  mockImageHarnessRule: {
    data: {
      id: 'rule-img-active-1',
      version: 1,
      status: 'active',
      structured_rule: {
        rules: {
          modelStyle: '소상공인 맞춤 정갈한 사진',
          environment: '자연 채광',
        },
        goldenImageIds: ['gold-1', 'gold-2', 'gold-3'],
        goldenAssets: [
          {
            id: 'gold-1',
            rightsStatus: 'OWNED',
            consentStatus: 'NOT_APPLICABLE',
            rightsConfirmedAt: '2026-09-17T00:00:00Z',
          },
          {
            id: 'gold-2',
            rightsStatus: 'LICENSED',
            consentStatus: 'NOT_APPLICABLE',
            rightsConfirmedAt: '2026-09-17T00:00:00Z',
          },
          {
            id: 'gold-3',
            rightsStatus: 'USER_CONFIRMED',
            consentStatus: 'CONFIRMED',
            rightsConfirmedAt: '2026-09-17T00:00:00Z',
          },
        ],
      },
    },
    error: null,
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

vi.mock('@/features/sohee-ready/admission-guard', () => ({
  requireSoheeReady: vi.fn().mockResolvedValue({ ready: true }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn().mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'knowledge_facts') return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      }
      if (table === 'media_assets') return proposalUploadQuery(mockWorkspaceId, mockUpload)
      if (table === 'workspaces') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { name: '바이름 헤어' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'workspace_knowledge_harnesses') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      harness_version_id: 'bkv_1',
                      version_no: 1,
                      is_active: true,
                      offerings: {},
                      policies: [{ key: 'HOURS', value: '10:00-20:00' }],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'harness_rules') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              return {
                eq: vi.fn().mockImplementation((c2: string, v2: string) => {
                  if (v2 === 'text_generation') {
                    return {
                      eq: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: {
                              id: 'rule-text-1',
                              version: 1,
                              status: 'active',
                              structured_rule: {
                                brandVoice: '친근한 말투',
                                rules: ['과장 없는 정직한 소통'],
                              },
                            },
                            error: null,
                          }),
                        }),
                      }),
                    }
                  }
                  if (v2 === 'image_generation') {
                    return {
                      eq: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue(mockImageHarnessRule),
                        }),
                      }),
                    }
                  }
                  if (v2 === 'approval_policy') {
                    return {
                      eq: vi.fn().mockReturnValue({
                        limit: vi.fn().mockReturnValue({
                          maybeSingle: vi.fn().mockResolvedValue({
                            data: {
                              id: 'rule-policy-1',
                              version: 1,
                              status: 'active',
                              structured_rule: {
                                publishApprovalLevel: 'EXACT_APPROVAL',
                              },
                            },
                            error: null,
                          }),
                        }),
                      }),
                    }
                  }
                  return {
                    eq: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                      }),
                    }),
                  }
                }),
              }
            }),
          }),
        }
      }
      if (table === 'channel_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ channel: 'instagram', account_label: '@byreum_official' }],
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'marketing_missions') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return { select: vi.fn().mockReturnThis() }
    }),
  }),
}))

vi.mock('@/features/missions/conversational-first-post', () => ({
  proposeFirstPostMission: vi.fn().mockReturnValue({
    missionId: 'mission-1',
    draft: { caption: '첫 게시물' },
    rights: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
  }),
  composeFirstPostWithGemini: vi.fn().mockResolvedValue({
    instagram: { caption: '인스타그램 카피' },
    threads: { content: '스레드 카피' },
  }),
}))

vi.mock('@/features/readiness/load', () => ({
  loadReadiness: vi.fn().mockResolvedValue({
    prepared: true, stage: 'PREPARE_ONLY', verifiedChannels: [], businessVerified: false,
    progressPercent: 75, connectionHint: '채널을 연결하면 발행할 수 있어요', trialAutoPublishEnabled: false,
    facts: { BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true }, TEXT_HARNESS_CONFIRMED: { verified: true },
      IMAGE_HARNESS_CONFIRMED: { verified: true }, OPERATING_POLICY_CONFIRMED: { verified: true } },
    blockers: [],
  }),
}))

import { POST as proposePOST } from '@/app/api/missions/first-post/propose/route'

describe('ANI-1481: Image Harness Durable Evidence Runtime Reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.copyright = 'owned'
    mockUpload.identifiablePeople = 'none'
  })

  it('accepts a rights-confirmed upload without requiring artificial harness rules.rightsStatus', async () => {
    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물 제안해줘' }),
    })

    const res = await proposePOST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it('fails closed when the selected upload lacks copyright evidence', async () => {
    mockUpload.copyright = 'unknown'

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물 제안해줘' }),
    })

    const res = await proposePOST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('MEDIA_SELECTION_INVALID')
  })

  it('fails closed when people in the selected upload lack a consent reference', async () => {
    mockUpload.identifiablePeople = 'consented'

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물 제안해줘' }),
    })

    const res = await proposePOST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('MEDIA_SELECTION_INVALID')
  })
})
