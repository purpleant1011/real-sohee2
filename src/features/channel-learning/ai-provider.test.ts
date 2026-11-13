import { describe, it, expect, vi } from 'vitest'
import { createLearningAiProvider, type ReceiptInput } from './ai-provider'
import type { SourceRef } from './contracts'

const mockSourceRef: SourceRef = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  sourceId: '22222222-2222-4222-8222-222222222222',
  revision: 1,
}

// 1x1 투명 PNG
const samplePngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
])

describe('createLearningAiProvider', () => {
  it('throws when apiKey is missing or empty', () => {
    expect(() =>
      createLearningAiProvider({
        apiKey: '',
        model: 'gemini-3.8-flash',
        recordReceipt: vi.fn(),
      }),
    ).toThrowError(/AI_KEY_REQUIRED/)
  })

  it('throws when recordReceipt callback is missing', () => {
    expect(() =>
      createLearningAiProvider({
        apiKey: 'test-secret-key-123',
        model: 'gemini-3.8-flash',
        recordReceipt: undefined as any,
      }),
    ).toThrowError(/RECEIPT_RECORDER_REQUIRED/)
  })

  describe('extractFacts', () => {
    it('sends POST request to Google REST generateContent with header-only apiKey and no URL leakage', async () => {
      let interceptedUrl = ''
      let interceptedHeaders: Headers | Record<string, string> = {}
      let interceptedBody: any = null

      const mockFetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        interceptedUrl = url.toString()
        interceptedHeaders = init?.headers as any
        interceptedBody = JSON.parse(init?.body as string)

        const responsePayload = {
          responseId: 'resp_extract_001',
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        category: 'business',
                        content: '소희네 카페는 매일 신선한 원두로 커피를 내립니다.',
                        excerpt: '매일 신선한 원두로 커피를 내립니다',
                        evidenceState: 'observed',
                      },
                    ]),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 50,
            candidatesTokenCount: 20,
            totalTokenCount: 70,
          },
        }

        return new Response(JSON.stringify(responsePayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      const recordReceipt = vi.fn<(input: ReceiptInput) => Promise<{ id: string }>>(
        async () => ({
          id: 'receipt_db_001',
        }),
      )

      const provider = createLearningAiProvider({
        apiKey: 'SECRET_API_KEY_xyz789',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt,
      })

      const text = '소희네 카페는 매일 신선한 원두로 커피를 내립니다.'
      const result = await provider.extractFacts({
        text,
        source: mockSourceRef,
      })

      // 1. URL 검증: 고정 Google host 확인, URL query param에 API 키 노출 절대 금지
      expect(interceptedUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
      )
      expect(interceptedUrl).not.toContain('key=')
      expect(interceptedUrl).not.toContain('SECRET_API_KEY')

      // 2. Header 검증: x-goog-api-key 로만 전달
      const headersMap = new Headers(interceptedHeaders)
      expect(headersMap.get('x-goog-api-key')).toBe('SECRET_API_KEY_xyz789')
      expect(headersMap.get('content-type')).toBe('application/json')

      // 3. Prompt 격리 검증: 외부 텍스트를 untrusted data로 격리하고 권한 제한
      const promptText = interceptedBody.contents[0].parts[0].text
      expect(promptText).toContain('<<<UNTRUSTED_EXTERNAL_DATA>>>')
      expect(promptText).toContain(text)
      expect(promptText).toContain('<<<END_EXTERNAL_DATA>>>')
      expect(interceptedBody.generationConfig?.responseMimeType).toBe('application/json')

      // 4. recordReceipt 호출 검증: RPC record_learning_provider_receipt 매핑 필드 확인 (원문 및 키 노출 없이 해시와 메타데이터만 저장)
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      const receiptCall = recordReceipt.mock.calls[0]?.[0]
      expect(receiptCall).toBeDefined()
      if (!receiptCall) return

      expect(receiptCall.workspaceId).toBe(mockSourceRef.workspaceId)
      expect(receiptCall.sourceId).toBe(mockSourceRef.sourceId)
      expect(receiptCall.sourceRevision).toBe(mockSourceRef.revision)
      expect(receiptCall.providerResponseId).toBe('resp_extract_001')
      expect(receiptCall.model).toBe('gemini-3.8-flash')
      expect(receiptCall.kind).toBe('text')
      expect(receiptCall.inputHash).toBeDefined()
      expect(receiptCall.mediaRefs).toEqual([])
      expect(receiptCall.usage.totalTokenCount).toBe(70)
      // 키나 텍스트 원문은 영수증에 미포함
      expect((receiptCall as any).apiKey).toBeUndefined()
      expect((receiptCall as any).text).toBeUndefined()

      // 5. 반환 결과 검증
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        category: 'business',
        content: '소희네 카페는 매일 신선한 원두로 커피를 내립니다.',
        excerpt: '매일 신선한 원두로 커피를 내립니다',
        evidenceState: 'observed',
      })
    })

    it('rejects text exceeding 60k limit', async () => {
      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        recordReceipt: vi.fn(),
      })

      const hugeText = 'A'.repeat(60001)
      await expect(
        provider.extractFacts({
          text: hugeText,
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/TEXT_TOO_LARGE/)
    })

    it('rejects observed facts when excerpt is not in original text (exact quote verification)', async () => {
      const mockFetcher = vi.fn(async () => {
        const payload = {
          responseId: 'resp_002',
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        category: 'business',
                        content: '소희네는 매주 화요일 쉽니다.',
                        excerpt: '이 문장은 원문에 전혀 없는 가짜 인용구입니다.',
                        evidenceState: 'observed',
                      },
                    ]),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn().mockResolvedValue({ id: 'rec_01' }),
      })

      const res = await provider.extractFacts({
        text: '진짜 원문은 카페 영업시간 안내뿐입니다.',
        source: mockSourceRef,
      })

      // 가짜 인용구인 observed 항목은 필터링되어 탈락
      expect(res).toHaveLength(0)
    })

    it('rejects when finishReason is not STOP (e.g. SAFETY, MAX_TOKENS)', async () => {
      const mockFetcher = vi.fn(async () => {
        const payload = {
          responseId: 'resp_safety',
          candidates: [
            {
              finishReason: 'SAFETY',
              content: { parts: [{ text: '' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 0,
            totalTokenCount: 5,
          },
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.extractFacts({
          text: '어떤 텍스트',
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/AI_GENERATION_BLOCKED/)
    })

    it('rejects response body exceeding 2MB stream cap', async () => {
      // 2MB + 10바이트 크기의 가짜 응답
      const hugeData = 'x'.repeat(2 * 1024 * 1024 + 10)
      const mockFetcher = vi.fn(async () => {
        return new Response(hugeData, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.extractFacts({
          text: '보통 텍스트',
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/PAYLOAD_TOO_LARGE/)
    })

    it('rejects responses with missing responseId or malformed JSON', async () => {
      const mockFetcher = vi.fn(async () => {
        const payload = {
          // missing responseId
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'invalid json {' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.extractFacts({
          text: '테스트',
          source: mockSourceRef,
        }),
      ).rejects.toThrow()
    })

    it('rejects responses with missing usageMetadata token counts', async () => {
      const mockFetcher = vi.fn(async () => {
        const payload = {
          responseId: 'resp_missing_usage',
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: '[]' }] },
            },
          ],
          // missing usageMetadata
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.extractFacts({
          text: '테스트',
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/AI_RESPONSE_INVALID/)
    })

    it('rejects partial output with empty text', async () => {
      const mockFetcher = vi.fn(async () => {
        const payload = {
          responseId: 'resp_empty_part',
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: '   ' }] },
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 0,
            totalTokenCount: 5,
          },
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const provider = createLearningAiProvider({
        apiKey: 'key',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.extractFacts({
          text: '테스트',
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/AI_RESPONSE_INVALID/)
    })
  })

  describe('analyzeVision', () => {
    it('encodes images to inline_data base64 and replaces model receipt ID with verified DB receipt ID', async () => {
      let interceptedBody: any = null

      const mockFetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        interceptedBody = JSON.parse(init?.body as string)

        const payload = {
          responseId: 'resp_vision_999',
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        // 모델이 임의로 위조한 receipt ID를 반환하더라도
                        visionReceiptId: 'MODEL_UNTRUSTED_RECEIPT_ID',
                        styleDescription: '따뜻한 우드 톤의 인테리어와 노란 조명 구도',
                        evidenceState: 'observed',
                      },
                    ]),
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 30,
            totalTokenCount: 180,
          },
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      })

      const mockLoadImage = vi.fn(async () => {
        return {
          data: samplePngBytes,
          contentType: 'image/png',
        }
      })

      const recordReceipt = vi.fn<(input: ReceiptInput) => Promise<{ id: string }>>(
        async () => {
          // 실제 DB에 저장된 고유 영수증 ID 발급
          return { id: 'receipt_db_verified_777' }
        },
      )

      const provider = createLearningAiProvider({
        apiKey: 'KEY_VISION_123',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        loadImage: mockLoadImage,
        recordReceipt,
      })

      const results = await provider.analyzeVision({
        images: [
          {
            mediaId: 'img_001',
            url: 'https://cdninstagram.com/p/sample.png',
          },
        ],
        source: mockSourceRef,
      })

      // 1. inline_data 전송 검증 (URL을 Gemini에 전달하지 않고 base64 바이너리로만 전달)
      expect(mockLoadImage).toHaveBeenCalledWith('https://cdninstagram.com/p/sample.png')
      const parts = interceptedBody.contents[0].parts
      const imagePart = parts.find((p: any) => p.inline_data)
      expect(imagePart).toBeDefined()
      expect(imagePart.inline_data.mime_type).toBe('image/png')
      expect(imagePart.inline_data.data).toBe(Buffer.from(samplePngBytes).toString('base64'))

      // 2. 비식별 프롬프트 검증 (얼굴/건강 식별 금지, 구도/톤/색상/배경 분석 지침)
      const promptPart = parts.find((p: any) => p.text)
      expect(promptPart.text).toContain('얼굴')
      expect(promptPart.text).toContain('색상')

      // 3. recordReceipt 전달 정보 검증: RPC record_learning_provider_receipt 매핑 필드 확인 (이미지 bytes 제외, hash 및 mediaRefs만)
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      const receiptArg = recordReceipt.mock.calls[0]?.[0]
      expect(receiptArg).toBeDefined()
      if (!receiptArg) return

      expect(receiptArg.workspaceId).toBe(mockSourceRef.workspaceId)
      expect(receiptArg.sourceId).toBe(mockSourceRef.sourceId)
      expect(receiptArg.sourceRevision).toBe(mockSourceRef.revision)
      expect(receiptArg.providerResponseId).toBe('resp_vision_999')
      expect(receiptArg.model).toBe('gemini-3.8-flash')
      expect(receiptArg.kind).toBe('vision')
      expect(receiptArg.inputHash).toBeDefined()
      expect(receiptArg.mediaRefs).toEqual([
        {
          mediaId: 'img_001',
          hash: expect.any(String),
        },
      ])
      expect(receiptArg.usage.totalTokenCount).toBe(180)
      expect((receiptArg as any).data).toBeUndefined()
      expect((receiptArg as any).apiKey).toBeUndefined()

      // 4. 모델이 반환한 위조 receipt ID는 무시되고, 실제 DB 영수증 ID로 덮어쓰여 반환
      expect(results).toHaveLength(1)
      expect(results[0].visionReceiptId).toBe('receipt_db_verified_777')
      expect(results[0].styleDescription).toBe('따뜻한 우드 톤의 인테리어와 노란 조명 구도')
      expect(results[0].evidenceState).toBe('observed')
    })

    it('returns empty array when images array is empty (visual observed forbidden without image)', async () => {
      const mockFetcher = vi.fn()
      const provider = createLearningAiProvider({
        apiKey: 'KEY',
        model: 'gemini-3.8-flash',
        fetcher: mockFetcher as any,
        recordReceipt: vi.fn(),
      })

      const res = await provider.analyzeVision({
        images: [],
        source: mockSourceRef,
      })

      expect(res).toEqual([])
      expect(mockFetcher).not.toHaveBeenCalled()
    })

    it('rejects batch when images exceed 10 items', async () => {
      const provider = createLearningAiProvider({
        apiKey: 'KEY',
        model: 'gemini-3.8-flash',
        recordReceipt: vi.fn(),
      })

      const elevenImages = Array.from({ length: 11 }, (_, i) => ({
        mediaId: `img_${i}`,
        url: `https://cdninstagram.com/p/${i}.png`,
      }))

      await expect(
        provider.analyzeVision({
          images: elevenImages,
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/TOO_MANY_IMAGES/)
    })

    it('rejects when total payload image size exceeds 20MB', async () => {
      const mockLoadImage = vi.fn(async () => {
        // 11MB짜리 이미지 2개 -> 22MB > 20MB
        return {
          data: new Uint8Array(11 * 1024 * 1024),
          contentType: 'image/png',
        }
      })

      const provider = createLearningAiProvider({
        apiKey: 'KEY',
        model: 'gemini-3.8-flash',
        loadImage: mockLoadImage,
        recordReceipt: vi.fn(),
      })

      await expect(
        provider.analyzeVision({
          images: [
            { mediaId: 'img1', url: 'https://cdninstagram.com/1.png' },
            { mediaId: 'img2', url: 'https://cdninstagram.com/2.png' },
          ],
          source: mockSourceRef,
        }),
      ).rejects.toThrowError(/PAYLOAD_TOO_LARGE/)
    })
  })
})
