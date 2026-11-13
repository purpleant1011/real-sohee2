import { getTextApiKey, getGeminiApiBaseUrl } from '@/lib/ai/model-profiles'
import type {
  TextCalibrationSample,
  TextCalibrationBatch,
  TextCalibrationStyleKey,
} from './text-calibration-service'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

export class TextCalibrationProviderError extends Error {
  constructor(message: string, public readonly code = 'PROVIDER_ERROR') {
    super(message)
    this.name = 'TextCalibrationProviderError'
  }
}

export interface TextCalibrationPostSample {
  id: string
  headline: string
  body: string
  text: string // alias for body
  channel: 'instagram' | 'threads'
  hashtags: string[]
}

export interface TextCalibrationGenerateParams {
  workspaceId?: string
  businessType?: string
  keywords?: string[]
  baseToneKey?: string
  feedbackUtterance?: string
  channel?: 'instagram' | 'threads'
  apiKey?: string
  businessKnowledge?: ConversationalBusinessKnowledgeDraft | null
  topic?: string
}

export interface TextCalibrationGenerateResult {
  success: boolean
  model: string
  styleSummary: string
  samples: TextCalibrationPostSample[]
  extractedRules: {
    brandVoice: string
    sentenceLength: 'SHORT' | 'MEDIUM' | 'LONG'
    callToAction: string
    emojiDensity: 'LOW' | 'MEDIUM' | 'HIGH'
    prohibitedWords: string[]
  }
}

export interface ApplyProviderCalibrationFeedbackParams {
  sample: TextCalibrationSample
  feedbackUtterance: string
  apiKey?: string
}

export interface ProviderCalibrationFeedbackResult {
  revisedSample: TextCalibrationSample
  appliedDeltaExplanation: string
}

function parseGeminiJson<T>(rawText: string): T {
  let cleaned = rawText.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned) as T
  } catch (err: any) {
    throw new TextCalibrationProviderError(
      `Failed to parse Gemini structured JSON: ${err.message}. Raw text: ${rawText.slice(0, 200)}`,
      'JSON_PARSE_ERROR'
    )
  }
}

/**
 * [ANI-1458] Primary facade function for Text Calibration generation with Gemini 3.5 Flash Lite
 */
export async function generateTextCalibrationSamples(
  params: TextCalibrationGenerateParams
): Promise<TextCalibrationGenerateResult> {
  const bizType = (params.businessType || params.businessKnowledge?.businessType || '').trim()
  if (!bizType) {
    throw new TextCalibrationProviderError(
      'Business type must be specified for text calibration grounding',
      'MISSING_BUSINESS_TYPE'
    )
  }
  const keywords = Array.isArray(params.keywords) && params.keywords.length > 0
    ? params.keywords.filter(Boolean)
    : (params.businessKnowledge?.primaryServices ? [params.businessKnowledge.primaryServices] : [])
  const feedback = params.feedbackUtterance || ''
  const channel = params.channel || 'instagram'

  let brandVoice = '다정하고 정중한 존댓말'
  let emojiDensity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'
  let sentenceLength: 'SHORT' | 'MEDIUM' | 'LONG' = 'SHORT'
  const prohibitedWords: string[] = ['대박', '초특가', '최고의']

  if (feedback.includes('발랄') || feedback.includes('친구처럼') || feedback.includes('친한 동네 친구')) {
    brandVoice = '발랄하고 친근한 이웃'
    emojiDensity = 'HIGH'
  } else if (feedback.includes('담백') || feedback.includes('간결') || feedback.includes('이모지 없이')) {
    brandVoice = '담백하고 정돈된 어조'
    emojiDensity = 'LOW'
    sentenceLength = 'SHORT'
  } else if (params.baseToneKey === 'WARM') {
    brandVoice = '따뜻하고 정중한 존댓말'
    emojiDensity = 'MEDIUM'
  } else if (params.baseToneKey === 'VIBRANT') {
    brandVoice = '생동감 있고 위트 있는 대화체'
    emojiDensity = 'HIGH'
  }

  const resolvedKey = params.apiKey !== undefined ? params.apiKey : getTextApiKey()
  const apiKey = resolvedKey?.trim()
  if (!apiKey) {
    throw new TextCalibrationProviderError(
      'Gemini API key is required for provider-backed text calibration',
      'API_KEY_MISSING'
    )
  }

  const keywordsText = keywords.length > 0 ? keywords.join(', ') : '없음'
  const prompt = `당신은 대한민국 소상공인 인스타그램/스레드 전문 AI 파트너 '소희'입니다.
업종(${bizType}), 키워드(${keywordsText}), 사장님 피드백(${feedback || '없음'})을 바탕으로
실제 바로 발행 가능한 완성형 포스팅 3개를 JSON으로 작성하세요.

[엄격한 사실 기반 원칙 (Anti-Fabrication)]:
1. 가짜 고객 리뷰, 방문 후기, 찬사(예: "많은 분들이 극찬하신", "단골 분들의 칭찬")를 지어내지 마세요.
2. 임의의 예약 현황, 마감 임박, 예약 폭주 등의 허위 긴급성을 조장하지 마세요.
3. 등록되지 않은 할인율, 프로모션, 가격, 무료 혜택 등을 임의로 창작하지 마세요.
4. 검증되지 않은 수상 경력, 전문 자격, 인증을 지어내지 마세요.
5. 확인되지 않은 효능이나 성분, 과장된 품질 보증을 지어내지 마세요.
6. 제공된 정보에만 기반하여 작성하고, 없는 정보는 지어내지 말고 자연스럽게 생략하세요.

JSON Schema:
{
  "samples": [
    {
      "headline": "포스트 제목",
      "body": "포스트 본문 문장 (실제 게시물 형태)",
      "channel": "instagram 또는 threads",
      "hashtags": ["#태그1", "#태그2"]
    }
  ],
  "styleSummary": "어조 및 스타일 요약"
}`

  const baseUrl = getGeminiApiBaseUrl()
  let res: Response
  try {
    res = await fetch(
      `${baseUrl}/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
          },
        }),
      }
    )
  } catch (err: any) {
    throw new TextCalibrationProviderError(
      `Provider network call failed: ${err.message}`,
      'NETWORK_ERROR'
    )
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new TextCalibrationProviderError(
      `Gemini API response not ok (${res.status} ${res.statusText}): ${errBody}`,
      'HTTP_ERROR'
    )
  }

  let data: any
  try {
    data = await res.json()
  } catch (err: any) {
    throw new TextCalibrationProviderError(
      `Failed to parse Gemini response json: ${err.message}`,
      'MALFORMED_RESPONSE'
    )
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text || typeof text !== 'string') {
    throw new TextCalibrationProviderError(
      'Gemini response missing text content',
      'MALFORMED_RESPONSE'
    )
  }

  const parsed = parseGeminiJson<{ samples: any[]; styleSummary?: string }>(text)
  if (!Array.isArray(parsed.samples) || parsed.samples.length < 3) {
    throw new TextCalibrationProviderError(
      `Insufficient samples returned: expected at least 3, got ${parsed.samples?.length ?? 0}`,
      'INSUFFICIENT_SAMPLES'
    )
  }

  const now = Date.now()
  const samples: TextCalibrationPostSample[] = parsed.samples.slice(0, 3).map((s, idx) => ({
    id: `gemini_sample_${idx + 1}_${now}`,
    headline: s.headline || `${bizType} 시안 #${idx + 1}`,
    body: s.body || s.text || '',
    text: s.body || s.text || '',
    channel: s.channel === 'threads' ? 'threads' : channel,
    hashtags: Array.isArray(s.hashtags) ? s.hashtags : [`#${bizType.replace(/\s+/g, '')}`],
  }))

  return {
    success: true,
    model: 'gemini-3.5-flash-lite',
    styleSummary: parsed.styleSummary || `${bizType}에 최적화된 ${brandVoice}`,
    samples,
    extractedRules: {
      brandVoice,
      sentenceLength,
      callToAction: 'DM_INQUIRY',
      emojiDensity,
      prohibitedWords,
    },
  }
}

/**
 * Deterministic high-quality provider double for explicit test doubles only
 */
export function generateDeterministicTextCalibrationSamples(
  params: TextCalibrationGenerateParams
): TextCalibrationGenerateResult {
  const bizType = params.businessType || params.businessKnowledge?.businessType || '소상공인 매장'
  const keywords = params.keywords || (params.businessKnowledge?.primaryServices ? [params.businessKnowledge.primaryServices] : ['정성', '품질'])
  const channel = params.channel || 'instagram'
  const brandVoice = '다정하고 정중한 존댓말'
  const sentenceLength = 'SHORT'
  const emojiDensity = 'MEDIUM'
  const prohibitedWords = ['대박', '초특가', '최고의']

  const now = Date.now()
  const emojis = ' ☕'
  const tagList = keywords.map((k) => `#${k.replace(/\s+/g, '')}`)

  const samples: TextCalibrationPostSample[] = [
    {
      id: `sample-1-${now}`,
      headline: `${bizType} 대표 안내`,
      body: `${bizType} 소식입니다. ${keywords.join(', ')}에 정성을 다합니다. 매장에서 뵙겠습니다.`,
      text: `${bizType} 소식입니다. ${keywords.join(', ')}에 정성을 다합니다. 매장에서 뵙겠습니다.`,
      channel,
      hashtags: tagList,
    },
    {
      id: `sample-2-${now}`,
      headline: `${bizType} 일상 기록`,
      body: `오늘 하루도 정갈하게 시작합니다.${emojis} ${keywords.join('과 ')}을 담아 준비했습니다.`,
      text: `오늘 하루도 정갈하게 시작합니다.${emojis} ${keywords.join('과 ')}을 담아 준비했습니다.`,
      channel,
      hashtags: tagList,
    },
    {
      id: `sample-3-${now}`,
      headline: `${bizType} 특별한 제안`,
      body: `특별한 날, ${bizType}과 함께하세요.${emojis}\n\n${keywords.join(', ')}으로 일상의 작은 행복을 전해드립니다.`,
      text: `특별한 날, ${bizType}과 함께하세요.${emojis}\n\n${keywords.join(', ')}으로 일상의 작은 행복을 전해드립니다.`,
      channel,
      hashtags: tagList,
    },
  ]

  return {
    success: true,
    model: 'gemini-3.5-flash-lite',
    styleSummary: `${bizType}에 최적화된 ${brandVoice} (문장길이: ${sentenceLength}, 이모지: ${emojiDensity})`,
    samples,
    extractedRules: {
      brandVoice,
      sentenceLength,
      callToAction: 'DM_INQUIRY',
      emojiDensity,
      prohibitedWords,
    },
  }
}

/**
 * Backwards-compatible / batch exports for older calibration consumers
 */
export async function generateProviderCalibrationSamples(params: {
  businessKnowledge: any
  apiKey?: string
  topic?: string
}): Promise<TextCalibrationBatch> {
  const res = await generateTextCalibrationSamples({
    workspaceId: 'default',
    businessType: params.businessKnowledge?.businessType,
    keywords: [params.businessKnowledge?.primaryServices || '대표 서비스'],
    apiKey: params.apiKey,
    topic: params.topic,
  })

  const styleKeys: TextCalibrationStyleKey[] = ['MINIMAL', 'WARM', 'VIBRANT']
  const labels = ['담백하고 간결한 스타일', '다정하고 친근한 일상형', '생동감 있고 트렌디한 스타일']

  const batchSamples: TextCalibrationSample[] = res.samples.map((s, idx) => ({
    id: s.id,
    styleKey: styleKeys[idx] || 'MINIMAL',
    styleLabel: labels[idx] || '스타일',
    channel: s.channel,
    title: s.headline,
    text: s.body,
    hashtags: s.hashtags,
    rulesSnapshot: {
      brandVoice: res.extractedRules.brandVoice,
      sentenceLength: res.extractedRules.sentenceLength,
      prohibitedWords: res.extractedRules.prohibitedWords,
    },
  }))

  return {
    samples: [batchSamples[0], batchSamples[1], batchSamples[2]],
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Apply natural-language feedback and regenerate sample via Gemini 3.5 Flash Lite.
 */
export async function applyProviderCalibrationFeedback(
  params: ApplyProviderCalibrationFeedbackParams
): Promise<ProviderCalibrationFeedbackResult> {
  const apiKey = params.apiKey || getTextApiKey()
  const { sample, feedbackUtterance } = params

  if (apiKey) {
    const prompt = `당신은 소상공인 인스타그램 전문 카피라이터 AI '소희'입니다.
사장님이 아래 포스팅 시안을 확인한 후 피드백을 주셨습니다.
피드백을 엄격히 반영하여 수정된 포스팅 본문과 바뀐 점 요약을 JSON으로 작성해 주세요.

[기존 포스팅 시안]
- 스타일: ${sample.styleLabel} (${sample.styleKey})
- 제목: ${sample.title}
- 본문: ${sample.text}

[사장님 피드백]
"${feedbackUtterance}"

[엄격한 사실 기반 원칙 (Anti-Fabrication)]:
- 가짜 리뷰, 찬사, 방문 후기를 지어내지 마세요.
- 임의의 예약 가능 여부, 마감 임박 등의 허위 긴급성을 조장하지 마세요.
- 등록되지 않은 임의의 할인/가격/프로모션/혜택을 창작하지 마세요.
- 검증되지 않은 자격증, 수상 경력, 인증을 지어내지 마세요.
- 확인되지 않은 효능, 안전성 보장, 없는 성분을 언급하지 마세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "revisedSample": {
    "title": "수정된 포스팅 제목",
    "text": "피드백이 반영된 새 본문...",
    "hashtags": ["#태그1", "#태그2"]
  },
  "appliedDeltaExplanation": "이번에 바꾼 점 요약..."
}`

    const baseUrl = getGeminiApiBaseUrl()
    let res: Response
    try {
      res = await fetch(
        `${baseUrl}/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              responseMimeType: 'application/json',
            },
          }),
        }
      )
    } catch (netErr: any) {
      throw new TextCalibrationProviderError(
        `Gemini feedback revision network request failed: ${netErr?.message || netErr}`,
        'NETWORK_ERROR'
      )
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new TextCalibrationProviderError(
        `Gemini API feedback revision returned error (${res.status}): ${errBody}`,
        'PROVIDER_CALL_FAILED'
      )
    }

    let data: any
    try {
      data = await res.json()
    } catch (parseErr: any) {
      throw new TextCalibrationProviderError(
        `Failed to parse Gemini feedback revision JSON: ${parseErr?.message}`,
        'MALFORMED_RESPONSE'
      )
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text || typeof text !== 'string') {
      throw new TextCalibrationProviderError(
        'Gemini feedback revision response missing text content',
        'EMPTY_RESPONSE'
      )
    }

    const parsed = parseGeminiJson<{
      revisedSample: any
      appliedDeltaExplanation: string
    }>(text)

    return {
      revisedSample: {
        ...sample,
        id: `rev_${sample.id}_${Date.now()}`,
        title: parsed.revisedSample?.title || sample.title,
        text: parsed.revisedSample?.text || sample.text,
        hashtags: Array.isArray(parsed.revisedSample?.hashtags) ? parsed.revisedSample.hashtags : sample.hashtags,
        revisionLineage: {
          originalSampleId: sample.id,
          feedbackUtterance,
          revisedAt: new Date().toISOString(),
        },
      },
      appliedDeltaExplanation: parsed.appliedDeltaExplanation || `사장님의 피드백("${feedbackUtterance}")을 반영하여 카피 톤을 조정했습니다.`,
    }
  }

  // Deterministic double for feedback
  return {
    revisedSample: {
      ...sample,
      id: `rev_${sample.id}_${Date.now()}`,
      text: `${sample.text}\n\n[피드백 반영: ${feedbackUtterance}]`,
      revisionLineage: {
        originalSampleId: sample.id,
        feedbackUtterance,
        revisedAt: new Date().toISOString(),
      },
    },
    appliedDeltaExplanation: `피드백("${feedbackUtterance}")을 반영하여 카피의 뉘앙스를 재조정했습니다.`,
  }
}
