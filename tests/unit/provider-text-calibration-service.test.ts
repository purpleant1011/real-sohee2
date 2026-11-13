// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  generateTextCalibrationSamples,
  TextCalibrationProviderError,
} from '@/features/text-harness/provider-text-calibration-service'
import { POST } from '@/app/api/onboarding/text-harness/generate/route'

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-text-1' } }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws-text-100' }] }),
        }),
      }),
    }),
  }),
}))

describe('Provider-Backed Text Calibration Service & Route (ANI-1458)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()

    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  samples: [
                    { headline: '시안 1', body: '첫 번째 포스팅 본문입니다. 정성을 다해 준비합니다.', channel: 'instagram', hashtags: ['#베이커리'] },
                    { headline: '시안 2', body: '두 번째 포스팅 본문입니다. 매장에서 뵙겠습니다.', channel: 'instagram', hashtags: ['#카페'] },
                    { headline: '시안 3', body: '세 번째 포스팅 본문입니다. 따뜻한 빵이 나왔어요.', channel: 'threads', hashtags: ['#소금빵'] },
                  ],
                  styleSummary: '담백하고 정돈된 어조',
                }),
              },
            ],
          },
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockGeminiResponse),
    } as any)
  })

  describe('generateTextCalibrationSamples', () => {
    it('generates 3 distinct real post samples using Gemini 3.5 Flash Lite', async () => {
      const result = await generateTextCalibrationSamples({
        workspaceId: 'ws-text-100',
        businessType: '베이커리 카페',
        keywords: ['천연 발효종', '소금빵', '따뜻한 감성'],
        baseToneKey: 'POLITE',
        channel: 'instagram',
        apiKey: 'test-api-key',
      })

      expect(result.success).toBe(true)
      expect(result.model).toBe('gemini-3.5-flash-lite')
      expect(result.samples).toHaveLength(3)
      expect(result.samples[0].body.length).toBeGreaterThan(10)
      expect(result.styleSummary).toBeDefined()
      expect(result.extractedRules.brandVoice).toBeDefined()
    })

    it('adapts tone and emoji density when natural language feedback is provided', async () => {
      const result = await generateTextCalibrationSamples({
        workspaceId: 'ws-text-100',
        businessType: '헤어살롱',
        keywords: ['레이어드컷', '1:1 맞춤'],
        baseToneKey: 'POLITE',
        feedbackUtterance: '격식 차리지 말고 친한 동네 친구처럼 발랄하게 이모지 많이 써줘',
        channel: 'instagram',
        apiKey: 'test-api-key',
      })

      expect(result.success).toBe(true)
      expect(result.extractedRules.brandVoice).toContain('발랄')
      expect(result.extractedRules.emojiDensity).toBe('HIGH')
      expect(result.samples).toHaveLength(3)
    })

    it('uses GEMINI_API_BASE_URL when configured for proxy routing', async () => {
      const originalBaseUrl = process.env.GEMINI_API_BASE_URL
      process.env.GEMINI_API_BASE_URL = 'https://proxy.sohee.ai/functions/v1/gemini-proxy'
      try {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        await generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '카페',
          keywords: ['아메리카노'],
          baseToneKey: 'POLITE',
          apiKey: 'test-api-key',
        })
        expect(fetchSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^https:\/\/proxy\.sohee\.ai\/functions\/v1\/gemini-proxy\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent/),
          expect.anything()
        )
      } finally {
        if (originalBaseUrl !== undefined) {
          process.env.GEMINI_API_BASE_URL = originalBaseUrl
        } else {
          delete process.env.GEMINI_API_BASE_URL
        }
      }
    })
  })

  describe('POST /api/onboarding/text-harness/generate', () => {
    it('authenticates user and returns 3 real post candidates for text calibration', async () => {
      vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key') // fetch is mocked in beforeEach
      const req = new Request('http://localhost:3000/api/onboarding/text-harness/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: '베이커리',
          keywords: ['소금빵', '크루아상'],
          baseToneKey: 'POLITE',
          feedbackUtterance: '담백하게 문장 짧게 써줘',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.samples).toHaveLength(3)
      expect(json.model).toBe('gemini-3.5-flash-lite')
      expect(json.extractedRules).toBeDefined()
    })
  })

  // ==== RED failure tests (A1 Provider fail-closed) ==== //
  describe('fail-closed error handling (A1)', () => {
    it('rejects when API key is missing without falling back to static templates', async () => {
      const originalKey = process.env.GEMINI_API_KEY
      delete process.env.GEMINI_API_KEY
      try {
        await expect(
          generateTextCalibrationSamples({
            workspaceId: 'ws-text-100',
            businessType: '베이커리',
            keywords: [],
            baseToneKey: 'POLITE',
            apiKey: '',
          })
        ).rejects.toThrow(TextCalibrationProviderError)
      } finally {
        if (originalKey) process.env.GEMINI_API_KEY = originalKey
      }
    })

    it('rejects on non-OK HTTP response without falling back to static templates', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue('Upstream Gemini failure'),
      } as any)

      await expect(
        generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '베이커리',
          keywords: [],
          baseToneKey: 'POLITE',
          apiKey: 'test-key',
        })
      ).rejects.toThrow(TextCalibrationProviderError)
    })

    it('rejects on network throw without falling back to static templates', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network connection timeout'))

      await expect(
        generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '베이커리',
          keywords: [],
          baseToneKey: 'POLITE',
          apiKey: 'test-key',
        })
      ).rejects.toThrow(TextCalibrationProviderError)
    })

    it('rejects on malformed provider JSON without falling back to static templates', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'NOT_VALID_JSON' }] } }],
        }),
      } as any)

      await expect(
        generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '베이커리',
          keywords: [],
          baseToneKey: 'POLITE',
          apiKey: 'test-key',
        })
      ).rejects.toThrow(TextCalibrationProviderError)
    })

    it('rejects when fewer than 3 samples returned without falling back to static templates', async () => {
      const insufficientResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    samples: [{ headline: '단일 시안', body: '포스트 하나뿐입니다.' }],
                    styleSummary: '요약',
                  }),
                },
              ],
            },
          },
        ],
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(insufficientResponse),
      } as any)

      await expect(
        generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '베이커리',
          keywords: [],
          baseToneKey: 'POLITE',
          apiKey: 'test-key',
        })
      ).rejects.toThrow(TextCalibrationProviderError)
    })
    it('fails closed when businessType is missing rather than fabricating 소상공인 매장', async () => {
      await expect(
        generateTextCalibrationSamples({
          workspaceId: 'ws-text-100',
          businessType: '',
          keywords: [],
          baseToneKey: 'POLITE',
          apiKey: 'test-key',
        })
      ).rejects.toMatchObject({
        code: 'MISSING_BUSINESS_TYPE',
      })
    })

    it('does not inject fabricated keywords [정성, 품질] into provider prompt when keywords are unspecified', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      samples: [
                        { headline: '시안 1', body: '포스트 1', channel: 'instagram' },
                        { headline: '시안 2', body: '포스트 2', channel: 'instagram' },
                        { headline: '시안 3', body: '포스트 3', channel: 'threads' },
                      ],
                      styleSummary: '요약',
                    }),
                  },
                ],
              },
            },
          ],
        }),
      } as any)

      await generateTextCalibrationSamples({
        workspaceId: 'ws-text-100',
        businessType: '동네 꽃집',
        keywords: undefined,
        baseToneKey: 'POLITE',
        apiKey: 'test-key',
      })

      const requestCall = fetchSpy.mock.calls[0]
      expect(requestCall).toBeDefined()
      const requestBody = JSON.parse(requestCall![1]?.body as string)
      const promptText = requestBody.contents[0].parts[0].text
      expect(promptText).toContain('키워드(없음)')
      expect(promptText).not.toMatch(/키워드\(.*(정성|품질).*\)/)
    })
  })
})
