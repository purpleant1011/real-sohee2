// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { proposalUploadQuery, PROPOSAL_UPLOAD_ID } from '../fixtures/first-post-upload-query'
import {
  composeFirstPostWithGemini,
  FirstPostComposerProviderError,
} from '@/features/missions/conversational-first-post'

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

import { POST as proposePOST } from '@/app/api/missions/first-post/propose/route'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { requireSoheeReady } from '@/features/sohee-ready/admission-guard'
import { loadReadiness } from '@/features/readiness/load'

vi.mock('@/features/readiness/load', () => ({ loadReadiness: vi.fn() }))

describe('First Post Provider Composer & Media Resolution (ANI-1458)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()

    // Safety guard: strictly forbid any unmocked live network calls to prevent test hangs
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      return Promise.reject(
        new Error(`[TEST_UNHANDLED_FETCH] Unmocked live network call prevented: ${String(url)}`)
      )
    })
  })

  describe('composeFirstPostWithGemini', () => {
    it('uses Gemini 3.5 Flash Lite endpoint to compose dual-channel first post copies', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '안녕하세요, 바이름 뷰티 살롱입니다. 정성 담긴 헤어 스파로 첫인사 드립니다 ✨',
                      hashtags: ['#바이름뷰티', '#헤어스파', '#첫인사'],
                    },
                    threads: {
                      content: '바이름 뷰티 살롱 스레드 첫 게시물입니다. 편안한 공간으로 모실게요 ☕',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      const copies = await composeFirstPostWithGemini({
        bizName: '바이름 뷰티 살롱',
        primaryService: '시그니처 헤어 스파',
        brandVoice: '따뜻하고 정갈한 말투',
        apiKey: 'test-gemini-key',
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const callUrl = fetchSpy.mock.calls[0][0] as string
      expect(callUrl).toContain('models/gemini-3.5-flash-lite:generateContent')
      expect(callUrl).toContain('key=test-gemini-key')

      const callOptions = fetchSpy.mock.calls[0][1] as RequestInit
      expect(callOptions.method).toBe('POST')
      const requestBody = JSON.parse(callOptions.body as string)
      expect(requestBody.contents[0].parts[0].text).toContain('바이름 뷰티 살롱')
      expect(requestBody.contents[0].parts[0].text).toContain('시그니처 헤어 스파')

      expect(copies.instagram.caption).toContain('바이름 뷰티 살롱입니다')
      expect(copies.instagram.hashtags).toEqual(['#바이름뷰티', '#헤어스파', '#첫인사'])
      expect(copies.threads.content).toContain('스레드 첫 게시물')
    })

    it('omits fabricated service defaults when primaryService is absent and instructs AI not to invent facts', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '새롭게 문을 연 온기 카페입니다. 편안하게 쉬어가세요 🌿',
                      hashtags: ['#온기카페', '#첫인사'],
                    },
                    threads: {
                      content: '온기 카페 첫 인사 올립니다 ☕',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await composeFirstPostWithGemini({
        bizName: '온기 카페',
        primaryService: undefined,
        apiKey: 'test-gemini-key',
      })

      const callOptions = fetchSpy.mock.calls[0][1] as RequestInit
      const promptText = JSON.parse(callOptions.body as string).contents[0].parts[0].text
      expect(promptText).toContain('(등록된 대표 메뉴 없음 - 특정 메뉴명을 임의로 지어내지 말 것)')
      expect(promptText).not.toContain('대표 시그니처 메뉴')
    })

    it('rejects Gemini response with ungrounded discount or promotion claims', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '안녕하세요, 온기 카페입니다. 첫 방문 시 전 메뉴 20% 할인 이벤트 진행합니다!',
                      hashtags: ['#온기카페', '#할인이벤트'],
                    },
                    threads: {
                      content: '온기 카페 오픈 기념 20% 할인 중입니다 ☕',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '온기 카페',
          apiKey: 'test-gemini-key',
        })
      ).rejects.toMatchObject({
        code: 'UNGROUNDED_FABRICATION_DETECTED',
      })
    })

    it('rejects Gemini response with ungrounded operating hours or urgency claims', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '온기 카페입니다. 영업시간 10:00~22:00, 오늘 예약 마감 임박이니 서두르세요!',
                      hashtags: ['#온기카페'],
                    },
                    threads: {
                      content: '온기 카페 오늘 예약 곧 마감됩니다!',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '온기 카페',
          apiKey: 'test-gemini-key',
        })
      ).rejects.toMatchObject({
        code: 'UNGROUNDED_FABRICATION_DETECTED',
      })
    })

    it('rejects Gemini response with fabricated customer reviews or rating claims', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '고객 만족도 1위, 방문자 별점 5점 만점에 빛나는 온기 카페입니다 ✨',
                      hashtags: ['#온기카페', '#리뷰맛집'],
                    },
                    threads: {
                      content: '단골 손님들의 극찬이 이어지는 온기 카페입니다!',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '온기 카페',
          apiKey: 'test-gemini-key',
        })
      ).rejects.toMatchObject({
        code: 'UNGROUNDED_FABRICATION_DETECTED',
      })
    })

    it('rejects Gemini response with unconfirmed medical, efficacy, or award claims', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '특허 받은 공법과 식약처 공식 인증을 획득한 온기 카페입니다.',
                      hashtags: ['#온기카페'],
                    },
                    threads: {
                      content: '올해의 브랜드 대상 수상 온기 카페 ☕',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '온기 카페',
          apiKey: 'test-gemini-key',
        })
      ).rejects.toMatchObject({
        code: 'UNGROUNDED_FABRICATION_DETECTED',
      })
    })

    it('fails closed when Gemini API key is missing', async () => {
      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: '',
        })
      ).rejects.toThrow(FirstPostComposerProviderError)

      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: '   ',
        })
      ).rejects.toMatchObject({
        code: 'MISSING_API_KEY',
      })
    })

    it('fails closed when provider returns an HTTP error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 503,
        text: vi.fn().mockResolvedValue('Service Unavailable'),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: 'test-key',
        })
      ).rejects.toMatchObject({
        code: 'PROVIDER_CALL_FAILED',
      })
    })

    it('fails closed on network connection failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: 'test-key',
        })
      ).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      })
    })

    it('fails closed when Gemini candidate response is malformed JSON', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is your post: Not a valid JSON string' }],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: 'test-key',
        })
      ).rejects.toMatchObject({
        code: 'MALFORMED_JSON',
      })
    })

    it('fails closed when Gemini structured response is missing required fields', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: { caption: '' },
                    threads: {},
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      } as any)

      await expect(
        composeFirstPostWithGemini({
          bizName: '테스트 매장',
          apiKey: 'test-key',
        })
      ).rejects.toMatchObject({
        code: 'MALFORMED_SHAPE',
      })
    })
  })

  describe('POST /api/missions/first-post/propose integration', () => {
    const mockUser = { id: 'usr_owner_458' }
    const mockWorkspaceId = 'ws_ani_1458'

    beforeEach(() => {
      vi.mocked(loadReadiness).mockResolvedValue({
        prepared: true, stage: 'PUBLISH_READY', verifiedChannels: ['instagram'],
        businessVerified: true, progressPercent: 100, connectionHint: null,
        trialAutoPublishEnabled: false,
        facts: { BUSINESS_KNOWLEDGE_CONFIRMED: { verified: true }, TEXT_HARNESS_CONFIRMED: { verified: true },
          IMAGE_HARNESS_CONFIRMED: { verified: true }, OPERATING_POLICY_CONFIRMED: { verified: true } } as any,
        blockers: [],
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

    it('resolves canonical media preview URLs and avoids fabricated business defaults', async () => {
      const insertSpy = vi.fn().mockResolvedValue({ error: null })

      const createChain = (terminalData: any) => {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          order: vi.fn(() => chain),
          maybeSingle: vi.fn(() => Promise.resolve(terminalData)),
          then: (resolve: any, reject: any) => Promise.resolve(terminalData).then(resolve, reject),
        }
        return chain
      }

      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }),
        },
        from: vi.fn((table: string) => {
          if (table === 'knowledge_facts') return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          }
          if (table === 'media_assets') return proposalUploadQuery(mockWorkspaceId)
          if (table === 'workspace_members') {
            return createChain({ data: [{ workspace_id: mockWorkspaceId }], error: null })
          }
          if (table === 'workspaces') {
            return createChain({
              data: { id: mockWorkspaceId, name: '성수 모던 살롱' },
              error: null,
            })
          }
          if (table === 'workspace_knowledge_harnesses') {
            return createChain({
              data: {
                harness_version_id: 'rule_know_1',
                version_no: 1,
                is_active: true,
                offerings: [],
                policies: [],
              },
              error: null,
            })
          }
          if (table === 'harness_rules') {
            let capturedRuleType: string | undefined
            const ruleChain: any = {
              select: vi.fn(() => ruleChain),
              eq: vi.fn((col: string, val: any) => {
                if (col === 'rule_type') capturedRuleType = val
                return ruleChain
              }),
              limit: vi.fn(() => ruleChain),
              order: vi.fn(() => ruleChain),
              maybeSingle: vi.fn(() => {
                if (capturedRuleType === 'text_generation') {
                  return Promise.resolve({
                    data: {
                      id: 'rule_txt_1',
                      version: 1,
                      status: 'active',
                      structured_rule: {
                        rules: { brandVoice: '따뜻하고 정갈한 어조' },
                      },
                    },
                    error: null,
                  })
                }
                if (capturedRuleType === 'image_generation') {
                  return Promise.resolve({
                    data: {
                      id: 'rule_img_1',
                      version: 1,
                      status: 'active',
                      structured_rule: {
                        goldenImageIds: ['asset_gold_101', 'asset_gold_102', 'asset_gold_103'],
                        rules: { rightsStatus: 'OWNED', consentStatus: 'CONFIRMED' },
                      },
                    },
                    error: null,
                  })
                }
                if (capturedRuleType === 'approval_policy') {
                  return Promise.resolve({
                    data: {
                      id: 'rule_pol_1',
                      version: 1,
                      status: 'active',
                      structured_rule: {
                        publishApprovalLevel: 'EXACT_APPROVAL',
                        dailySpendLimitKrw: 0,
                        maxDailyPublishCount: 1,
                      },
                    },
                    error: null,
                  })
                }
                return Promise.resolve({ data: null, error: null })
              }),
            }
            return ruleChain
          }
          if (table === 'channel_connections') {
            return createChain({
              data: [
                { channel: 'instagram', status: 'active', account_label: '@sungsu.salon' },
                { channel: 'threads', status: 'active', account_label: '@sungsu.salon' },
              ],
              error: null,
            })
          }
          if (table === 'marketing_missions') {
            return {
              insert: insertSpy,
            }
          }
          return createChain({ data: null, error: null })
        }),
      }

      vi.mocked(createServerSupabaseClient).mockResolvedValue(mockClient as any)
      vi.mocked(createAdminSupabaseClient).mockReturnValue(mockClient as any)

      // Supply a harmless test-only key; fetch remains mocked (no external request).
      vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
      // Mock Gemini 3.5 Flash Lite provider response
      const mockGeminiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    instagram: {
                      caption: '안녕하세요, 성수 모던 살롱입니다. 첫인사 드립니다 ✨',
                      hashtags: ['#성수모던살롱', '#첫인사'],
                    },
                    threads: {
                      content: '성수 모던 살롱 스레드 첫 게시물입니다 ☕',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockImplementation((url: any) => {
        if (typeof url === 'string' && url.includes('gemini-3.5-flash-lite')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockGeminiResponse),
          } as any)
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any)
      })

      const req = new Request('http://localhost/api/missions/first-post/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterance: '첫 게시물 만들어줘' }),
      })

      const res = await proposePOST(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.draft).toBeDefined()

      // 1. Canonical Media Previews: Must render authenticated workspace URLs, not placeholder text
      // Calibration golden images are not the owner's selected publication photo.
      expect(json.draft.mediaPreviews).toEqual([{
        id: PROPOSAL_UPLOAD_ID,
        url: `/api/workspaces/${mockWorkspaceId}/media/${PROPOSAL_UPLOAD_ID}`,
      }])
      expect(json.draft.selectedImageIds).toEqual([PROPOSAL_UPLOAD_ID])
      expect(insertSpy.mock.calls[0][0].metadata.payload.imageIds).toEqual([PROPOSAL_UPLOAD_ID])

      // 2. No fabricated business defaults:
      // When offerings and hours policies are absent from canonical knowledge, snapshots must be undefined
      expect(json.draft.knowledgeSnapshot.signatureServices).toBeUndefined()
      expect(json.draft.knowledgeSnapshot.operatingHours).toBeUndefined()

      // 3. Dual-channel copy generated via Gemini
      expect(json.draft.copies.instagram.caption).toContain('성수 모던 살롱입니다')
      expect(json.draft.copies.threads.content).toContain('스레드 첫 게시물')
    })
  })
})
