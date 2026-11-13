import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proposalUploadQuery } from '../fixtures/first-post-upload-query'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(),
}))

vi.mock('@/features/sohee-ready/admission-guard', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    requireSoheeReady: vi.fn(),
  }
})

import { POST } from '@/app/api/missions/first-post/propose/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireSoheeReady } from '@/features/sohee-ready/admission-guard'
import { loadReadiness } from '@/features/readiness/load'

vi.mock('@/features/readiness/load', () => ({ loadReadiness: vi.fn() }))
vi.mock('@/features/missions/conversational-first-post', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/missions/conversational-first-post')>(),
  composeFirstPostWithGemini: vi.fn().mockResolvedValue({
    instagram: { caption: '첫 인사입니다', hashtags: ['#첫인사'] },
    threads: { content: '첫 인사입니다' },
  }),
}))

describe('R2-B1 Proposal Truth & R2-B2 Server-Authored Draft Mission', () => {
  const mockUser = { id: 'usr_owner_1' }
  const mockWorkspaceId = 'ws_truth_test'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadReadiness).mockResolvedValue({
      prepared: true, stage: 'PUBLISH_READY', verifiedChannels: ['instagram'],
      businessVerified: true, progressPercent: 100, connectionHint: null,
      trialAutoPublishEnabled: false, facts: {
        BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true }, TEXT_HARNESS_CONFIRMED: { verified: true },
        IMAGE_HARNESS_CONFIRMED: { verified: true }, OPERATING_POLICY_CONFIRMED: { verified: true },
      } as any, blockers: [],
    })
    vi.mocked(requireSoheeReady).mockResolvedValue({
      workspaceId: mockWorkspaceId,
      ready: true,
      blockers: [],
      facts: {
        BUSINESS_VERIFIED: { verified: true },
        INSTAGRAM_VERIFIED: { verified: true },
        THREADS_VERIFIED: { verified: true },
        BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true },
        TEXT_HARNESS_CONFIRMED: { verified: true },
        IMAGE_HARNESS_CONFIRMED: { verified: true },
        OPERATING_POLICY_CONFIRMED: { verified: true },
      } as any,
      timestamp: new Date().toISOString(),
    } as any)
  })

  function createMockSupabase(overrides: {
    channels?: any[]
    imageHarnessRule?: any
    textHarnessRule?: any
    policyRule?: any
    knowledgeHarness?: any
    workspaceName?: string
    insertSpy?: any
    upload?: Parameters<typeof proposalUploadQuery>[1]
  } = {}) {
    const insertSpy = overrides.insertSpy || vi.fn().mockResolvedValue({ error: null })

    const mockClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
      },
      from: vi.fn((table: string) => {
        if (table === 'knowledge_facts') return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }
        if (table === 'media_assets') return proposalUploadQuery(mockWorkspaceId, overrides.upload)
        if (table === 'workspace_members') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: mockWorkspaceId }] }),
          }
        }
        if (table === 'workspaces') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { name: overrides.workspaceName ?? '성수 카페 소희' },
              error: null,
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: overrides.channels ?? [
                {
                  channel: 'instagram',
                  status: 'verified',
                  account_label: '@sohee_cafe',
                  external_account_id: 'ig_12345',
                  profile_metadata: { profileUrl: 'https://instagram.com/sohee_cafe' },
                },
                {
                  channel: 'threads',
                  status: 'verified',
                  account_label: '@sohee_cafe',
                  external_account_id: 'th_12345',
                  profile_metadata: { profileUrl: 'https://threads.net/@sohee_cafe' },
                },
              ],
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
              data: overrides.knowledgeHarness !== undefined ? overrides.knowledgeHarness : {
                harness_version_id: 'kn_ver_1',
                version_no: 2,
                is_active: true,
              },
              error: null,
            }),
          }
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
                  data: overrides.textHarnessRule !== undefined ? overrides.textHarnessRule : {
                    id: 'rule_txt_1',
                    version: 3,
                    status: 'active',
                    structured_rule: {
                      brandVoice: '차분하고 정돈된',
                      rules: ['친근한 존댓말', '이모지 최대 2개'],
                    },
                  },
                  error: null,
                })
              }
              if (ruleType === 'image_generation') {
                return Promise.resolve({
                  data: overrides.imageHarnessRule !== undefined ? overrides.imageHarnessRule : {
                    id: 'rule_img_1',
                    version: 2,
                    status: 'active',
                    structured_rule: {
                      goldenImageIds: ['asset_1', 'asset_2', 'asset_3'],
                      rules: {
                        rightsStatus: 'OWNED',
                        consentStatus: 'CONFIRMED',
                      },
                    },
                  },
                  error: null,
                })
              }
              if (ruleType === 'approval_policy') {
                return Promise.resolve({
                  data: overrides.policyRule !== undefined ? overrides.policyRule : {
                    id: 'rule_pol_1',
                    version: 1,
                    status: 'active',
                    structured_rule: {
                      publishApprovalLevel: 'always_require',
                      dailySpendLimitKrw: 0,
                      maxDailyPublishCount: 2,
                    },
                  },
                  error: null,
                })
              }
              return Promise.resolve({ data: null, error: null })
            }),
          }
          return builder
        }
        if (table === 'marketing_missions') {
          return {
            insert: insertSpy,
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
    return { mockClient, insertSpy }
  }

  it('1. permits a channel-free PREPARE_ONLY draft without synthesizing fake handles', async () => {
    vi.mocked(loadReadiness).mockResolvedValueOnce({
      prepared: true, stage: 'PREPARE_ONLY', verifiedChannels: [],
      businessVerified: false, progressPercent: 75, connectionHint: '채널을 연결하면 발행할 수 있어요',
      trialAutoPublishEnabled: false, facts: {
        BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true }, TEXT_HARNESS_CONFIRMED: { verified: true },
        IMAGE_HARNESS_CONFIRMED: { verified: true }, OPERATING_POLICY_CONFIRMED: { verified: true },
      } as any, blockers: [],
    })
    const { insertSpy } = createMockSupabase({ channels: [] })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물 만들어줘' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.draft.channels).toEqual([])
    expect(insertSpy.mock.calls[0][0].metadata.payload.channels).toEqual([])
  })

  it('2. requires a photo instead of fabricating golden assets when no upload exists', async () => {
    createMockSupabase({
      upload: { empty: true },
      imageHarnessRule: {
        id: 'rule_img_missing',
        version: 2,
        status: 'active',
        structured_rule: {
          goldenImageIds: [], // Empty!
          rules: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
        },
      },
    })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물 만들어줘' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('MEDIA_SELECTION_REQUIRED')
  })

  it('3. does not default an uploaded photo to OWNED without copyright evidence', async () => {
    createMockSupabase({
      upload: { copyright: 'unknown' },
      imageHarnessRule: {
        id: 'rule_img_no_rights',
        version: 2,
        status: 'active',
        structured_rule: {
          goldenImageIds: ['img_1', 'img_2', 'img_3'],
          rules: { consentStatus: 'CONFIRMED' }, // rightsStatus missing!
        },
      },
    })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('MEDIA_SELECTION_INVALID')
  })

  it('4. rejects an uploaded photo with people but no consent reference', async () => {
    createMockSupabase({
      upload: { identifiablePeople: 'consented' },
      imageHarnessRule: {
        id: 'rule_img_no_consent',
        version: 2,
        status: 'active',
        structured_rule: {
          goldenImageIds: ['img_1', 'img_2', 'img_3'],
          rules: { rightsStatus: 'OWNED' }, // consentStatus missing!
        },
      },
    })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.code).toBe('MEDIA_SELECTION_INVALID')
  })

  it('5. fails closed when confirmed Business Knowledge or Text Harness is missing without version fallback', async () => {
    createMockSupabase({
      knowledgeHarness: null, // Knowledge missing!
    })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '첫 게시물' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.code).toBe('KNOWLEDGE_HARNESS_MISSING')
  })

  it('6. persists canonical DRAFT/AWAITING_APPROVAL mission in marketing_missions before returning draft to client', async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    createMockSupabase({ insertSpy })

    const req = new Request('http://localhost/api/missions/first-post/propose', {
      method: 'POST',
      body: JSON.stringify({ utterance: '성수 카페 오픈 안내 첫 게시물' }),
    })

    const res = await POST(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.draft).toBeDefined()
    expect(json.draft.missionId).toBeDefined()

    // Assert DB persistence occurred with AWAITING_APPROVAL/DRAFT status
    expect(insertSpy).toHaveBeenCalledTimes(1)
    const insertedRecord = insertSpy.mock.calls[0][0]
    expect(insertedRecord.id).toBe(json.draft.missionId)
    expect(insertedRecord.workspace_id).toBe(mockWorkspaceId)
    expect(insertedRecord.status).toBe('AWAITING_APPROVAL')
    expect(insertedRecord.metadata).toBeDefined()
    expect(insertedRecord.metadata.draftFingerprint).toBe(json.draft.approvalFingerprint)
  })
})
