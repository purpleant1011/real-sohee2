import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateStudioTurnAi,
  type StudioAiTurnInput,
  type StudioAiResult,
} from '../ai'

describe('Studio Gemini AI Conversation Adapter (ai.ts)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      GEMINI_API_KEY: 'test-gemini-key-12345',
      GEMINI_API_BASE_URL: 'https://test-generativelanguage.googleapis.com',
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  function createMockFetch(options: {
    status?: number
    statusText?: string
    responseText?: string
    jsonResponse?: unknown
    delayMs?: number
  }) {
    const {
      status = 200,
      statusText = 'OK',
      responseText,
      jsonResponse,
      delayMs = 0,
    } = options

    return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (delayMs > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }

      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        throw err
      }

      return {
        ok: status >= 200 && status <= 299,
        status,
        statusText,
        text: async () =>
          responseText ??
          (jsonResponse !== undefined ? JSON.stringify(jsonResponse) : ''),
        json: async () =>
          jsonResponse !== undefined
            ? jsonResponse
            : JSON.parse(responseText || '{}'),
      } as unknown as Response
    })
  }

  it('1. 호출 페이로드 검증: approved facts가 untrusted 블록으로 격리되고 usage 메타데이터가 반환됨', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '매장의 주차 2시간 무료 혜택을 등록해 둘게요.',
                  intent: 'teach',
                  proposals: [
                    {
                      category: 'PARKING',
                      content: '건물 지하 주차장 2시간 무료 지원',
                    },
                  ],
                }),
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 45,
        totalTokenCount: 165,
      },
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const input: StudioAiTurnInput = {
      workspaceId: 'ws-test-1',
      userMessage: '우리 매장은 지하 주차장 2시간 무료 지원돼요',
      history: [
        { role: 'user', content: '안녕하세요' },
        { role: 'assistant', content: '안녕하세요 사장님! 무엇을 도와드릴까요?' },
      ],
      approvedFacts: [
        { id: 'fact-1', category: 'HOURS', content: '매일 11시부터 22시까지 영업' },
      ],
    }

    const result = await generateStudioTurnAi(input, {
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [callUrl, callInit] = mockFetch.mock.calls[0]

    // URL 및 API Key 파라미터 확인
    expect(callUrl).toContain('https://test-generativelanguage.googleapis.com/v1beta/models/')
    expect(callUrl).toContain(':generateContent?key=test-gemini-key-12345')

    // Payload 검증
    const body = JSON.parse(callInit?.body as string)
    expect(body.generationConfig?.responseMimeType).toBe('application/json')
    expect(body.tools).toBeUndefined()

    // untrusted_approved_facts 블록 격리 검증 (prompt injection 방지)
    const systemInstructionText = body.systemInstruction?.parts?.map((p: any) => p.text).join(' ') || ''
    expect(systemInstructionText).toContain('<untrusted_approved_facts>')
    expect(systemInstructionText).toContain('매일 11시부터 22시까지 영업')
    expect(systemInstructionText).toContain('HOURS')

    // 반환 결과 및 usage metadata 검증
    expect(result.reply).toBe('매장의 주차 2시간 무료 혜택을 등록해 둘게요.')
    expect(result.intent).toBe('teach')
    expect(result.proposals).toEqual([
      {
        category: 'PARKING',
        content: '건물 지하 주차장 2시간 무료 지원',
      },
    ])
    expect(result.modelId).toBeDefined()
    expect(result.usage).toEqual({
      promptTokens: 120,
      completionTokens: 45,
      totalTokens: 165,
    })
  })

  it('2. 명시적 교정 흐름: relatedFactId가 주어진 경우 replacesFactId가 연결됨', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '주차 무료 시간을 1시간으로 바로잡아 둘게요.',
                  intent: 'teach',
                  proposals: [
                    {
                      category: 'PARKING',
                      content: '건물 지하 주차장 1시간 무료 지원',
                      replacesFactId: 'fact-old-99',
                    },
                  ],
                }),
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const input: StudioAiTurnInput = {
      userMessage: '주차가 2시간이 아니라 1시간 무료로 바뀌었어요',
      focus: 'teach',
      relatedFactId: 'fact-old-99',
      approvedFacts: [
        { id: 'fact-old-99', category: 'PARKING', content: '건물 지하 주차장 2시간 무료 지원' },
      ],
    }

    const result = await generateStudioTurnAi(input, {
      fetchFn: mockFetch as unknown as typeof fetch,
    })

    expect(result.intent).toBe('teach')
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals?.[0].replacesFactId).toBe('fact-old-99')
  })

  it('2-b. 모델이 replacesFactId를 빠뜨렸어도 명시적 relatedFactId가 있으면 자동 보정', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '주차 안내를 1시간으로 수정할게요.',
                  intent: 'teach',
                  proposals: [
                    {
                      category: 'PARKING',
                      content: '건물 지하 주차장 1시간 무료 지원',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const result = await generateStudioTurnAi(
      {
        userMessage: '주차 1시간으로 정정해줘',
        focus: 'teach',
        relatedFactId: 'fact-target-id',
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    expect(result.proposals?.[0].replacesFactId).toBe('fact-target-id')
  })

  it('2-c. focus가 inspect(UI 탐색 모드)라도 사장님이 지식을 수정하면 intent: teach로 교정 처리됨', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '영업시간을 23시까지로 연장 수정할게요.',
                  intent: 'teach',
                  proposals: [
                    {
                      category: 'HOURS',
                      content: '매일 11시부터 23시까지 영업',
                      replacesFactId: 'fact-hours-1',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const result = await generateStudioTurnAi(
      {
        userMessage: '이거 영업시간 22시가 아니라 23시로 수정해줘',
        focus: 'inspect', // UI는 지식 탐색/열람 포커스
        relatedFactId: 'fact-hours-1',
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    expect(result.intent).toBe('teach')
    expect(result.proposals?.[0].replacesFactId).toBe('fact-hours-1')
    expect(result.proposals?.[0].content).toContain('23시')
  })

  it('3. 사용자 질문은 fact 제안 금지 (intent가 inspect일 때 proposals 제거)', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '우리 매장의 대표 메뉴는 한우 1++ 안심과 숙성 등심입니다.',
                  intent: 'inspect',
                  proposals: [
                    {
                      category: 'MENU',
                      content: '한우 1++ 안심과 숙성 등심',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const result = await generateStudioTurnAi(
      {
        userMessage: '우리 매장 대표 메뉴가 뭐였지?',
        focus: 'inspect',
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    expect(result.intent).toBe('inspect')
    expect(result.proposals).toBeUndefined()
  })

  it('4. 목표(goal) 제안 처리 검증', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '네이버 예약 20% 증대를 이번 달 핵심 목표로 등록할까요?',
                  intent: 'goal',
                  goal: {
                    title: '네이버 플레이스 예약 20% 증대',
                    desiredOutcome: '신규 고객 유입 및 주말 예약 전환 극대화',
                  },
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const result = await generateStudioTurnAi(
      {
        userMessage: '이번 달은 네이버 예약 20% 늘리는 걸 목표로 하고 싶어',
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    expect(result.intent).toBe('goal')
    expect(result.goal).toEqual({
      title: '네이버 플레이스 예약 20% 증대',
      desiredOutcome: '신규 고객 유입 및 주말 예약 전환 극대화',
    })
    expect(result.proposals).toBeUndefined()
  })

  it('5. 일반 대화(none) 처리 검증', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '반가워요 사장님! 오늘 매장 영업은 잘 되고 있으신가요?',
                  intent: 'none',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const result = await generateStudioTurnAi(
      {
        userMessage: '소희야 안녕! 오늘 날씨가 참 좋다',
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    expect(result.intent).toBe('none')
    expect(result.reply).toBe('반가워요 사장님! 오늘 매장 영업은 잘 되고 있으신가요?')
    expect(result.proposals).toBeUndefined()
    expect(result.goal).toBeUndefined()
  })

  it('6. 오류 경로: API 키 미설정 시 즉시 에러 throw (가짜 성공 금지)', async () => {
    process.env.GEMINI_API_KEY = ''
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = ''
    process.env.GOOGLE_API_KEY = ''

    await expect(
      generateStudioTurnAi({ userMessage: '안녕' })
    ).rejects.toThrow('GEMINI_API_KEY is not configured')
  })

  it('7. 오류 경로: 모델 서버 500 오류 시 에러를 던짐 (고정 답변/가짜 성공 금지)', async () => {
    const mockFetch = createMockFetch({
      status: 500,
      statusText: 'Internal Server Error',
      responseText: 'Internal Server Error occurred at upstream model',
    })

    await expect(
      generateStudioTurnAi(
        { userMessage: '우리 메뉴는 파스타야' },
        { fetchFn: mockFetch as unknown as typeof fetch }
      )
    ).rejects.toThrow(/Gemini Studio API Error: 500/)
  })

  it('8. 오류 경로: JSON 파싱 오류 시 원문 노출 없이 에러를 던짐', async () => {
    const rawBrokenResponse = '민감정보_노출금지_원문텍스트 { broken json'
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: rawBrokenResponse,
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    try {
      await generateStudioTurnAi(
        { userMessage: '우리 메뉴는 파스타야' },
        { fetchFn: mockFetch as unknown as typeof fetch }
      )
      expect.fail('Should have thrown')
    } catch (err: any) {
      expect(err.message).toContain('Failed to parse Studio AI response as JSON')
      // 원문 텍스트가 에러 메시지에 노출되지 않아야 함
      expect(err.message).not.toContain('민감정보_노출금지_원문텍스트')
    }
  })

  it('9. 오류 경로: Zod 검증 오류 (스키마 불일치/bounds 초과) 시 에러를 던짐', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  // reply 누락
                  intent: 'invalid_intent_value',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    await expect(
      generateStudioTurnAi(
        { userMessage: '우리 메뉴는 파스타야' },
        { fetchFn: mockFetch as unknown as typeof fetch }
      )
    ).rejects.toThrow(/Invalid Studio AI output schema/)
  })

  it('10. 오류 경로: 빈 candidates 또는 SAFETY 등으로 블록된 경우 에러를 던짐', async () => {
    const mockGeminiResponse = {
      candidates: [],
      promptFeedback: {
        blockReason: 'SAFETY',
      },
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    await expect(
      generateStudioTurnAi(
        { userMessage: '안녕' },
        { fetchFn: mockFetch as unknown as typeof fetch }
      )
    ).rejects.toThrow(/blocked or empty candidates/)
  })

  it('11. 오류 경로: request timeout 발생 시 타임아웃 에러를 던짐 (body hang 차단)', async () => {
    const mockFetch = createMockFetch({
      delayMs: 100,
      jsonResponse: { candidates: [] },
    })

    await expect(
      generateStudioTurnAi(
        { userMessage: '안녕' },
        {
          fetchFn: mockFetch as unknown as typeof fetch,
          timeoutMs: 20,
        }
      )
    ).rejects.toThrow(/timed out|timeout/i)
  })

  it('12. 보안 및 개인정보: 에러 메시지에 API Key가 노출되지 않도록 마스킹 처리', async () => {
    const secretKey = 'secret-private-key-9999'
    process.env.GEMINI_API_KEY = secretKey

    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url)
      throw new Error(`Failed to fetch from ${urlStr}`)
    })

    try {
      await generateStudioTurnAi(
        { userMessage: '안녕' },
        { fetchFn: mockFetch as unknown as typeof fetch }
      )
      expect.fail('Should have thrown an error')
    } catch (err: any) {
      expect(err.message).not.toContain(secretKey)
      expect(err.message).toContain('***')
    }
  })

  it('13. 내용 제한: userMessage 및 history 크기 제한 안전 처리', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '말씀 감사합니다.',
                  intent: 'none',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    const hugeMessage = 'A'.repeat(10000)
    const manyHistory = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `이전 메시지 ${i}: ${'B'.repeat(500)}`,
    }))

    await generateStudioTurnAi(
      {
        userMessage: hugeMessage,
        history: manyHistory,
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    const callInit = mockFetch.mock.calls[0][1]
    const body = JSON.parse(callInit?.body as string)

    expect(body.contents.length).toBeLessThanOrEqual(21)
    const lastUserContent = body.contents[body.contents.length - 1].parts[0].text
    expect(lastUserContent.length).toBeLessThanOrEqual(4000)
  })

  it('14. activeGoals가 제공되면 systemInstruction에 business_goals 블록과 안전 수칙이 주입된다', async () => {
    const mockGeminiResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  reply: '사장님의 목표는 신규 예약 20% 증대입니다.',
                  intent: 'inspect',
                }),
              },
            ],
          },
        },
      ],
    }

    const mockFetch = createMockFetch({ jsonResponse: mockGeminiResponse })

    await generateStudioTurnAi(
      {
        userMessage: '내 목표가 뭐였지?',
        activeGoals: [
          {
            id: 'g-1',
            title: '신규 예약 증대',
            desiredOutcome: '이번 달 신규 예약 20% 늘리기',
            priority: 'high',
          },
        ],
      },
      { fetchFn: mockFetch as unknown as typeof fetch }
    )

    const callInit = mockFetch.mock.calls[0][1]
    const body = JSON.parse(callInit?.body as string)
    const systemText = body.systemInstruction.parts.map((p: any) => p.text).join('\n')

    expect(systemText).toContain('<business_goals>')
    expect(systemText).toContain('신규 예약 증대')
    expect(systemText).toContain('이번 달 신규 예약 20% 늘리기')
    expect(systemText).toContain('목표(Business Goal)는 사장님이 지향하는 사업 및 마케팅 방향 지침일 뿐')
  })
})
