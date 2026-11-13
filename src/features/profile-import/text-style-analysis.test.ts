import { describe, expect, it, vi } from 'vitest'
import type { CaptionStats } from './types'
import { analyzeTextStyle, writeSamplePost } from './text-style-analysis'

const mockStats: CaptionStats = {
  postCount: 15,
  averageLength: 350,
  medianLength: 320,
  topHashtags: ['#카페투어', '#성수카페', '#라떼맛집'],
  averageHashtagCount: 5,
  repeatedHeaderLine: '[오늘의 성수]',
  repeatedSecondLine: '☕ 커피 한 잔의 여유',
  emojiPerPost: 4,
  topEmojis: ['☕', '✨', '🌿'],
  endsWithHashtagBlockRatio: 0.9,
  averageBodyLines: 8,
}

function mockGeminiFetcher(response: { text?: string; ok?: boolean; status?: number; reject?: boolean }) {
  if (response.reject) {
    return vi.fn(async () => {
      throw new Error('Network error')
    }) as unknown as typeof fetch
  }
  const ok = response.ok ?? true
  const status = response.status ?? (ok ? 200 : 500)
  const text = response.text ?? ''
  return vi.fn(async () => ({
    ok,
    status,
    text: async () => text,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text }],
          },
        },
      ],
    }),
  })) as unknown as typeof fetch
}

describe('analyzeTextStyle', () => {
  it('throws TEXT_STYLE_NO_POSTS when captions array is empty without calling fetcher', async () => {
    const fetcher = mockGeminiFetcher({ text: '{}' })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: [], stats: mockStats },
        { apiKey: 'test-key', fetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_NO_POSTS')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('throws TEXT_STYLE_UNAVAILABLE when apiKey is missing', async () => {
    const fetcher = mockGeminiFetcher({ text: '{}' })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: '', fetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNAVAILABLE')
  })

  it('throws TEXT_STYLE_UNAVAILABLE when fetcher fails (HTTP error or network reject)', async () => {
    const errorFetcher = mockGeminiFetcher({ ok: false, status: 500 })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: 'test-key', fetcher: errorFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNAVAILABLE')

    const networkErrorFetcher = mockGeminiFetcher({ reject: true })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: 'test-key', fetcher: networkErrorFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNAVAILABLE')
  })

  it('throws TEXT_STYLE_UNUSABLE when JSON is invalid or essential fields are empty', async () => {
    const invalidJsonFetcher = mockGeminiFetcher({ text: 'Not JSON at all' })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: 'test-key', fetcher: invalidJsonFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNUSABLE')

    const emptyVoiceFetcher = mockGeminiFetcher({
      text: JSON.stringify({
        voiceSummary: '   ',
        styleGuide: '가이드 내용',
      }),
    })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: 'test-key', fetcher: emptyVoiceFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNUSABLE')

    const emptyGuideFetcher = mockGeminiFetcher({
      text: JSON.stringify({
        voiceSummary: '보이스 요약',
        styleGuide: '',
      }),
    })
    await expect(
      analyzeTextStyle(
        { handle: 'test_cafe', biography: '소개', captions: ['캡션 1'], stats: mockStats },
        { apiKey: 'test-key', fetcher: emptyGuideFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNUSABLE')
  })

  it('clips captions to 30 items and 800 chars each, and includes stats in prompt', async () => {
    const validResponse = {
      voiceSummary: '차분하고 감성적인 성수동 카페 톤앤매너',
      styleGuide: '줄바꿈을 자주 하고 첫 줄에 시그니처 헤더를 넣습니다.',
      keywords: ['성수', '스페셜티'],
      prohibitedTerms: ['초특가'],
      sampleOpenings: ['[오늘의 성수]'],
      hashtags: ['#카페투어'],
    }
    const fetcher = mockGeminiFetcher({ text: JSON.stringify(validResponse) })

    const longCaptions = Array.from({ length: 40 }, (_, i) => `캡션 ${i}: ${'가'.repeat(1000)}`)

    await analyzeTextStyle(
      { handle: 'test_cafe', biography: '소개글입니다', captions: longCaptions, stats: mockStats },
      { apiKey: 'test-key', fetcher, baseUrl: 'https://gemini.mock', model: 'custom-gemini' },
    )

    expect(fetcher).toHaveBeenCalledTimes(1)
    const callArgs = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; body: string },
    ]
    expect(callArgs[0]).toContain('https://gemini.mock/v1beta/models/custom-gemini:generateContent?key=test-key')

    const body = JSON.parse(callArgs[1].body)
    const prompt = body.contents[0].parts[0].text as string

    // 캡션 개수(30개) 및 길이(800자) 제한 확인
    expect(prompt).toContain('캡션 29')
    expect(prompt).not.toContain('캡션 30') // 31번째 캡션은 제외되어야 함
    expect(prompt).not.toContain('가'.repeat(801)) // 800자 초과는 잘려야 함

    // 통계 값과 프롬프트 주요 요구사항 포함 확인
    expect(prompt).toContain('#카페투어')
    expect(prompt).toContain('350')
    expect(prompt).toContain('voiceSummary')
    expect(prompt).toContain('styleGuide')
    expect(prompt).toContain('전화번호')
  })

  it('normalizes response: strips codeblocks, trims lengths, deduplicates arrays, and enforces limits', async () => {
    const rawOutput = `\`\`\`json
{
  "voiceSummary": "  ${'A'.repeat(300)}  ",
  "styleGuide": "  ${'B'.repeat(1500)}  ",
  "keywords": [" 키워드1 ", "키워드1", "키워드2", 123, null, "", "키워드3", "키워드4", "키워드5", "키워드6", "키워드7", "키워드8", "키워드9", "키워드10", "키워드11", "키워드12", "키워드13", "키워드14", "키워드15", "키워드16"],
  "prohibitedTerms": ["금지어1", "금지어1", "금지어2"],
  "sampleOpenings": ["첫문장1", "첫문장1", "첫문장2", "첫문장3", "첫문장4", "첫문장5", "첫문장6"],
  "hashtags": ["#태그1", "#태그1", "#태그2"]
}
\`\`\``

    const fetcher = mockGeminiFetcher({ text: rawOutput })
    const result = await analyzeTextStyle(
      { handle: 'test_cafe', biography: null, captions: ['첫 번째 캡션'], stats: mockStats },
      { apiKey: 'test-key', fetcher },
    )

    expect(result.voiceSummary.length).toBe(200)
    expect(result.styleGuide.length).toBe(1200)
    expect(result.keywords).toHaveLength(15) // 최대 15개, 중복 및 non-string 제거
    expect(result.keywords).toContain('키워드1')
    expect(result.keywords.filter((k) => k === '키워드1')).toHaveLength(1)
    expect(result.prohibitedTerms).toEqual(['금지어1', '금지어2'])
    expect(result.sampleOpenings).toHaveLength(5) // 최대 5개
    expect(result.hashtags).toEqual(['#태그1', '#태그2'])
  })
})

describe('writeSamplePost', () => {
  it('throws TEXT_STYLE_UNAVAILABLE if apiKey is missing or fetcher fails', async () => {
    const fetcher = mockGeminiFetcher({ text: '게시글 본문' })
    await expect(
      writeSamplePost(
        { styleGuide: '가이드', voiceSummary: '보이스', businessName: '카페', topic: '신메뉴' },
        { apiKey: '', fetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNAVAILABLE')

    const errFetcher = mockGeminiFetcher({ ok: false })
    await expect(
      writeSamplePost(
        { styleGuide: '가이드', voiceSummary: '보이스', businessName: '카페', topic: '신메뉴' },
        { apiKey: 'test-key', fetcher: errFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNAVAILABLE')
  })

  it('throws TEXT_STYLE_UNUSABLE if generated text is empty', async () => {
    const emptyFetcher = mockGeminiFetcher({ text: '   ' })
    await expect(
      writeSamplePost(
        { styleGuide: '가이드', voiceSummary: '보이스', businessName: '카페', topic: '신메뉴' },
        { apiKey: 'test-key', fetcher: emptyFetcher },
      ),
    ).rejects.toThrow('TEXT_STYLE_UNUSABLE')
  })

  it('generates sample post adhering to prompt instructions and clips to 2200 chars', async () => {
    const longText = `  신메뉴 라떼 출시! ${'C'.repeat(3000)}  `
    const fetcher = mockGeminiFetcher({ text: longText })

    const result = await writeSamplePost(
      {
        styleGuide: '첫 줄에 시그니처 헤더',
        voiceSummary: '친근한 바리스타 톤',
        businessName: '성수 카페',
        topic: '가을 시즈널 음료',
      },
      { apiKey: 'test-key', fetcher, baseUrl: 'https://gemini.mock', model: 'sample-gemini' },
    )

    expect(result.length).toBe(2200)
    expect(result.startsWith('신메뉴 라떼 출시!')).toBe(true)

    const callArgs = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { method: string; body: string },
    ]
    const body = JSON.parse(callArgs[1].body)
    const prompt = body.contents[0].parts[0].text as string

    expect(prompt).toContain('첫 줄에 시그니처 헤더')
    expect(prompt).toContain('친근한 바리스타 톤')
    expect(prompt).toContain('성수 카페')
    expect(prompt).toContain('가을 시즈널 음료')
    expect(prompt).toContain('[대괄호 빈칸]')
    expect(body.generationConfig.responseMimeType).toBe('text/plain')
  })
})
