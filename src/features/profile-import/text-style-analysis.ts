import { getGeminiApiBaseUrl, getGeminiApiKey } from '@/lib/ai/model-profiles'
import type { CaptionStats, TextStyleDraft } from './types'

type Deps = Readonly<{
  apiKey?: string
  fetcher?: typeof fetch
  baseUrl?: string
  model?: string
}>

export type AnalyzeTextStyleInput = Readonly<{
  handle: string
  biography: string | null
  captions: readonly string[]
  stats: CaptionStats
}>

export type WriteSamplePostInput = Readonly<{
  styleGuide: string
  voiceSummary: string
  businessName: string | null
  topic: string
}>

function normalizeStringArray(value: unknown, maxCount: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed)
        result.push(trimmed)
        if (result.length >= maxCount) break
      }
    }
  }
  return result
}

function buildTextStylePrompt(input: AnalyzeTextStyleInput, slicedCaptions: readonly string[]): string {
  const { handle, biography, stats } = input

  const captionsFormatted = slicedCaptions
    .map((caption, idx) => `[게시물 ${idx + 1}]\n${caption}`)
    .join('\n\n')

  return [
    '다음은 한 SNS 계정의 최근 게시물 캡션들과 통계 데이터입니다.',
    '이 계정의 글을 그대로 이어 쓸 수 있도록 문체와 글 구조를 분석하여 JSON 객체 하나만 반환하세요.',
    '',
    `[계정 정보]`,
    `- 핸들: @${handle}`,
    biography ? `- 소개글: ${biography}` : '',
    '',
    `[통계 지표]`,
    `- 분석 게시물 수: ${stats.postCount}개`,
    `- 평균 글자 수: 약 ${stats.averageLength}자 (중간값: ${stats.medianLength}자)`,
    `- 본문 줄 수 평균: 약 ${stats.averageBodyLines}줄`,
    `- 자주 쓰는 해시태그: ${stats.topHashtags.join(', ') || '없음'} (게시물당 평균 ${stats.averageHashtagCount}개)`,
    `- 반복되는 첫 줄(시그니처 헤더): ${stats.repeatedHeaderLine ?? '없음'}`,
    `- 반복되는 둘째 줄/구분선: ${stats.repeatedSecondLine ?? '없음'}`,
    `- 자주 쓰는 이모지: ${stats.topEmojis.join(' ') || '없음'} (게시물당 평균 ${stats.emojiPerPost}개)`,
    `- 해시태그 블록으로 끝나는 비율: ${Math.round(stats.endsWithHashtagBlockRatio * 100)}%`,
    '',
    `[최근 게시물 캡션 (최대 30개)]`,
    captionsFormatted,
    '',
    `[요구 출력 형식 (JSON 필드)]`,
    '1. voiceSummary: 200자 이내 한 줄 요약. 이 계정의 고유한 톤앤매너와 분위기.',
    '2. styleGuide: 1200자 이내의 구체적인 작성 지시문.',
    '   - 글의 구조 (첫 줄 시그니처 헤더 여부, 소제목/구분선, 단락 수 및 줄 수, 맺음말/행동 유도 문구(CTA) 패턴)',
    '   - 말투 (존댓말/반말, 종결어미, 1인칭 호칭 등)',
    '   - 이모지 사용 규칙 (통계 topEmojis 반영, 배치 위치)',
    '   - 해시태그 규칙 (개수, 위치, 자주 쓰는 태그 — 통계 topHashtags 반영)',
    '   - 글 길이 기준 (통계 averageLength 반영)',
    '   - 사실·가격·후기 언급 시 주의사항',
    '3. keywords: 계정이 자주 쓰는 대표 키워드 (최대 15개 문자열 배열)',
    '4. prohibitedTerms: 계정이 쓰지 않는 과장/의료 표현 등 보수적으로 피해야 할 표현 (최대 15개 문자열 배열)',
    '5. sampleOpenings: 실제 첫 문장 패턴 (원문을 그대로 복사하지 말고 재현 가능한 패턴 문장으로, 최대 5개 문자열 배열)',
    '6. hashtags: 본문 끝에 주로 붙이는 해시태그 목록 (최대 15개 문자열 배열)',
    '',
    '[엄격한 주의사항]',
    '- 사진 속 인물이나 고객 실명, 전화번호, 상세 주소(계정 주소) 등 특정 개인/위치 정보는 결과에 절대 포함하지 마세요.',
    '- 마크다운 코드블록이나 부가 설명 없이 오직 유효한 JSON 문자열만 출력하세요.',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function analyzeTextStyle(
  input: AnalyzeTextStyleInput,
  deps: Deps = {},
): Promise<TextStyleDraft> {
  if (!input.captions || input.captions.length === 0) {
    throw new Error('TEXT_STYLE_NO_POSTS')
  }

  const key = (deps.apiKey ?? getGeminiApiKey()).trim()
  if (!key) throw new Error('TEXT_STYLE_UNAVAILABLE')

  const model = deps.model ?? (process.env.GEMINI_ACTION_MODEL?.trim() || 'gemini-3.8-flash')
  const base = deps.baseUrl ?? getGeminiApiBaseUrl()
  const fetcher = deps.fetcher ?? fetch

  const slicedCaptions = input.captions.slice(0, 30).map((c) => c.slice(0, 800))
  const prompt = buildTextStylePrompt(input, slicedCaptions)

  const response = await fetcher(`${base}/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    }),
  }).catch(() => null)

  if (!response || !response.ok) {
    throw new Error('TEXT_STYLE_UNAVAILABLE')
  }

  const data = (await response.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  } | null

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof text !== 'string') {
    throw new Error('TEXT_STYLE_UNUSABLE')
  }

  const unfenced = text
    .replace(/^\s*```(?:json)?\s*/iu, '')
    .replace(/\s*```\s*$/u, '')
    .trim()

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(unfenced)
  } catch {
    throw new Error('TEXT_STYLE_UNUSABLE')
  }

  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    throw new Error('TEXT_STYLE_UNUSABLE')
  }

  const record = parsedJson as Record<string, unknown>
  const voiceSummary = typeof record.voiceSummary === 'string' ? record.voiceSummary.trim().slice(0, 200) : ''
  const styleGuide = typeof record.styleGuide === 'string' ? record.styleGuide.trim().slice(0, 1200) : ''

  if (!voiceSummary || !styleGuide) {
    throw new Error('TEXT_STYLE_UNUSABLE')
  }

  return {
    voiceSummary,
    styleGuide,
    keywords: normalizeStringArray(record.keywords, 15),
    prohibitedTerms: normalizeStringArray(record.prohibitedTerms, 15),
    sampleOpenings: normalizeStringArray(record.sampleOpenings, 5),
    hashtags: normalizeStringArray(record.hashtags, 15),
  }
}

function buildWriteSamplePostPrompt(input: WriteSamplePostInput): string {
  const { styleGuide, voiceSummary, businessName, topic } = input

  return [
    '당신은 계정의 문체와 규칙을 완벽하게 재현하는 인스타그램 카피라이터입니다.',
    '주어진 텍스트 하네스(문체 가이드)를 엄격히 준수하여 인스타그램 게시글 한 편(본문 + 해시태그)을 작성하세요.',
    '',
    `[비즈니스/계정 정보]`,
    `- 상호/브랜드명: ${businessName || '(미지정)'}`,
    `- 톤앤매너 요약: ${voiceSummary}`,
    '',
    `[문체 및 작성 규칙 (Style Guide)]`,
    styleGuide,
    '',
    `[작성할 주제]`,
    topic,
    '',
    `[작성 시 절대 지침]`,
    '1. 사실(가격, 구체적인 이벤트 날짜, 진행 기간, 고객 후기 세부내용 등)은 절대 임의로 지어내지 마세요.',
    '   구체적인 사실 정보가 들어가야 할 자리는 [대괄호 빈칸] (예: [가격], [이벤트 기간], [매장 위치])으로 남겨두세요.',
    '2. 스타일 가이드의 첫 줄 시그니처, 줄바꿈, 어미, 이모지, 맺음말(CTA), 해시태그 규칙을 정확히 따르세요.',
    '3. 다른 설명 없이 오직 인스타그램에 바로 게시할 수 있는 완성된 글 본문만 출력하세요.',
  ].join('\n')
}

export async function writeSamplePost(
  input: WriteSamplePostInput,
  deps: Deps = {},
): Promise<string> {
  const key = (deps.apiKey ?? getGeminiApiKey()).trim()
  if (!key) throw new Error('TEXT_STYLE_UNAVAILABLE')

  const model = deps.model ?? (process.env.GEMINI_ACTION_MODEL?.trim() || 'gemini-3.8-flash')
  const base = deps.baseUrl ?? getGeminiApiBaseUrl()
  const fetcher = deps.fetcher ?? fetch

  const prompt = buildWriteSamplePostPrompt(input)

  const response = await fetcher(`${base}/v1beta/models/${model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'text/plain',
        temperature: 0.7,
      },
    }),
  }).catch(() => null)

  if (!response || !response.ok) {
    throw new Error('TEXT_STYLE_UNAVAILABLE')
  }

  const data = (await response.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
  } | null

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) {
    throw new Error('TEXT_STYLE_UNUSABLE')
  }

  return trimmed.slice(0, 2200)
}
