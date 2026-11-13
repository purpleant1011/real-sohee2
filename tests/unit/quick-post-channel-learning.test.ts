import { describe, it, expect, vi, afterEach } from 'vitest'
import { createQuickDraft, reviseQuickDraft } from '@/features/quick-start/quick-post-service'
import * as quickCopyModule from '@/features/quick-start/quick-copy'

vi.mock('@/features/quick-start/quick-post-credits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/quick-start/quick-post-credits')>()
  return {
    ...actual,
    reserveQuickPostCredits: vi.fn().mockResolvedValue({
      reservationId: 'res-test-1',
      state: 'reserved',
      requestedCredits: 100,
      isReplay: false,
    }),
    settleQuickPostCredits: vi.fn().mockResolvedValue({ state: 'settled' }),
    releaseQuickPostCredits: vi.fn().mockResolvedValue({ state: 'released' }),
  }
})

vi.mock('@/features/quick-start/quick-image', () => ({
  generateAndStoreQuickImage: vi.fn().mockResolvedValue({ assetId: 'img-asset-1' }),
}))

describe('QuickPost Service with Channel Learning (ANI-2203)', () => {
  const mockWorkspaceId = '11111111-1111-4111-8111-111111111111'
  const mockUserId = 'usr-test-1'
  const prevEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED

  afterEach(() => {
    if (prevEnv !== undefined) {
      process.env.SOHEE_CHANNEL_LEARNING_ENABLED = prevEnv
    } else {
      delete process.env.SOHEE_CHANNEL_LEARNING_ENABLED
    }
    vi.restoreAllMocks()
  })

  function createMockAdmin(params?: {
    channelRpcResult?: { data: any; error: any }
    validateResult?: boolean
  }) {
    const channelRpc = params?.channelRpcResult ?? {
      data: {
        epoch: 2,
        items: [
          {
            id: 'fact-ch-1',
            category: 'MENU',
            content: '수제 딸기 생크림 케이크 38,000원',
            source_type: 'channel',
            dependencies: [
              { workspaceId: mockWorkspaceId, sourceId: 'src-insta-1', revision: 1 },
            ],
          },
        ],
      },
      error: null,
    }

    const validateRes = params?.validateResult ?? true

    return {
      from: vi.fn((table: string) => {
        if (table === 'business_profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    business_name: '봄날 케이크',
                    industry: '디저트 카페',
                    location: '서울 마포구',
                    summary: '매일 아침 굽는 생크림 케이크 전문점',
                  },
                  error: null,
                }),
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
                      data: { version_no: 1, offerings: ['케이크', '커피'] },
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
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { version: 1, structured_rule: { style: '정갈한' } },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'channel_connections') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ channel: 'instagram', status: 'connected', account_label: '@bomnal' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [],
                count: 0,
                error: null,
              }),
            }),
          }
        }
        if (table === 'marketing_missions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  gte: vi.fn().mockResolvedValue({ count: 0, error: null }),
                }),
              }),
            }),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'mission-1',
                    status: 'AWAITING_APPROVAL',
                    metadata: {
                      payload: {
                      copies: { instagram: { caption: 'test' }, threads: { content: 'test' } },
                      imageIds: [],
                      channels: [],
                      boundVersions: {
                        knowledgeVersion: 1,
                        textHarnessVersion: 1,
                        imageHarnessVersion: 1,
                        operatingPolicyVersion: 1,
                      },
                      rights: {
                        rightsStatus: 'OWNED',
                        consentStatus: 'NOT_APPLICABLE',
                      },
                    },
                      execution_state: 'NEEDS_DECISION',
                      outcome_state: 'PENDING',
                    },
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              })),
            })),
          }
        }
        const defaultChain: any = {
          select: vi.fn(() => defaultChain),
          eq: vi.fn(() => defaultChain),
          in: vi.fn(() => defaultChain),
          order: vi.fn(() => defaultChain),
          limit: vi.fn(() => defaultChain),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          insert: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        }
        return defaultChain
      }),
      rpc: vi.fn((name: string, args: any) => {
        if (name === 'get_approved_learning_context') {
          return Promise.resolve(channelRpc)
        }
        if (name === 'validate_learning_result') {
          return Promise.resolve({ data: validateRes, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      }),
    }
  }

  it('SOHEE_CHANNEL_LEARNING_ENABLED === 1 일 때 채널 지식을 초안 생성 팩트에 포함한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    const composeSpy = vi.spyOn(quickCopyModule, 'composeQuickPostCopy').mockResolvedValue({
      instagram: { caption: '봄날 케이크 소개', hashtags: ['#케이크'] },
      threads: { content: '봄날 케이크입니다.' },
    })

    const mockAdmin = createMockAdmin()

    await createQuickDraft({
      admin: mockAdmin as any,
      workspaceId: mockWorkspaceId,
      userId: mockUserId,
      topic: '시그니처 딸기 케이크',
      textOnly: true,
    })

    // composeQuickPostCopy에 채널에서 학습된 딸기 생크림 케이크 팩트가 전달되었는지 확인
    expect(composeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmedFacts: expect.arrayContaining(['수제 딸기 생크림 케이크 38,000원']),
      })
    )
  })

  it('채널 지식이 주입되었으나 사후 게이트 validate_learning_result가 false이면 저장을 거부하고 에러를 던진다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    vi.spyOn(quickCopyModule, 'composeQuickPostCopy').mockResolvedValue({
      instagram: { caption: '봄날 케이크 소개', hashtags: ['#케이크'] },
      threads: { content: '봄날 케이크입니다.' },
    })

    const mockAdmin = createMockAdmin({ validateResult: false })

    await expect(
      createQuickDraft({
        admin: mockAdmin as any,
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        topic: '시그니처 딸기 케이크',
        textOnly: true,
      })
    ).rejects.toThrow('가게 공식 채널 정보가 변경되어 초안을 저장하지 못했어요.')
  })

  it('reviseQuickDraft 시에도 confirmedFacts에 채널 지식을 주입하고 validate_learning_result 검증을 수행한다', async () => {
    process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
    const composeSpy = vi.spyOn(quickCopyModule, 'composeQuickPostCopy').mockResolvedValue({
      instagram: { caption: '봄날 케이크 수정본', hashtags: ['#케이크'] },
      threads: { content: '봄날 케이크 수정본입니다.' },
    })

    const existingMission = {
      id: 'mission-1',
      workspace_id: mockWorkspaceId,
      status: 'AWAITING_APPROVAL',
      metadata: {
        lane: 'QUICK_POST',
        execution_state: 'NEEDS_DECISION',
        outcome_state: 'PENDING',
        quick: { revision: 1, topic: '시그니처 딸기 케이크' },
        payload: {
          copies: { instagram: { caption: '봄날' }, threads: { content: '봄날' } },
          imageIds: [],
          channels: [],
          boundVersions: { knowledgeVersion: 1, textHarnessVersion: 1, imageHarnessVersion: 1, operatingPolicyVersion: 1 },
          rights: { rightsStatus: 'OWNED', consentStatus: 'NOT_APPLICABLE' },
        },
      },
    }

    const mockAdmin = createMockAdmin({ validateResult: false })
    // Return existing mission on query
    const updateChain: any = {
      eq: vi.fn(() => updateChain),
      select: vi.fn(() => updateChain),
      single: vi.fn().mockResolvedValue({ data: existingMission, error: null }),
      then: (resolve: any) => resolve({ data: existingMission, error: null }),
    }

    mockAdmin.from = vi.fn((table: string) => {
      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existingMission, error: null }),
              }),
            }),
          }),
          update: vi.fn(() => updateChain),
        }
      }
      return (createMockAdmin().from as any)(table)
    })

    await expect(
      reviseQuickDraft({
        admin: mockAdmin as any,
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        missionId: 'mission-1',
        feedback: '더 친근하게 써줘',
        scope: 'text',
      })
    ).rejects.toThrow('가게 공식 채널 정보가 변경되어 초안을 저장하지 못했어요.')
  })
})
