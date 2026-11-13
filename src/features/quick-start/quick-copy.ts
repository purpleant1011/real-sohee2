import { FirstPostComposerProviderError, type ExactApprovalCopies } from '@/features/missions/conversational-first-post'
import { getGeminiApiBaseUrl, getTextApiKey } from '@/lib/ai/model-profiles'
import { sanitizeBusinessText } from './sanitize-business-text'

export interface QuickCopyInput {
  businessName: string
  industry?: string
  location?: string
  summary?: string
  offerings?: string[]
  /** Server-resolved, owner-approved facts effective at generation time. */
  confirmedFacts?: readonly string[]
  brandVoice: string
  /** What THIS post is about. It must drive the copy. */
  topic: string
  /** Owner feedback on the previous version. */
  feedback?: string
  previous?: ExactApprovalCopies
  apiKey?: string
  fetcher?: typeof fetch
}

export function buildQuickCopyPrompt(input: QuickCopyInput): string {
  const topic = sanitizeBusinessText(input.topic, 300) || '매장 소개 및 첫 인사'
  const facts = [
    `가게 이름: ${sanitizeBusinessText(input.businessName, 80)}`,
    input.industry ? `업종: ${sanitizeBusinessText(input.industry, 80)}` : '',
    input.location ? `지역: ${sanitizeBusinessText(input.location, 80)}` : '',
    input.summary ? `사장님의 가게 소개: ${sanitizeBusinessText(input.summary, 500)}` : '',
    input.offerings?.length ? `대표 메뉴/서비스: ${input.offerings.map((o) => sanitizeBusinessText(o, 60)).join(', ')}` : '',
  ].filter(Boolean)

  return `당신은 소상공인의 마케팅 직원 '소희'입니다. 사장님 대신 인스타그램과 스레드 게시물 글을 씁니다.

[이번 게시물의 주제 — 글의 중심]
${topic}

[가게 정보 — 배경으로만 사용]
${facts.join('\n')}

[사장님이 확인한 현재 유효 정보]
${input.confirmedFacts?.length ? input.confirmedFacts.map(fact => sanitizeBusinessText(fact, 12000)).join('\n') : '확인된 정보 없음 — 가격·행사·영업시간은 생략'}

[말투]
${sanitizeBusinessText(input.brandVoice, 300)}
${input.feedback ? `\n[사장님의 수정 요청 — 반드시 반영]\n${sanitizeBusinessText(input.feedback, 300)}` : ''}${input.previous ? `\n\n[이전 버전]\n인스타그램: ${sanitizeBusinessText(input.previous.instagram.caption, 800)}\n스레드: ${sanitizeBusinessText(input.previous.threads.content, 400)}` : ''}

[규칙]
1. 글은 위 '주제'를 중심으로 쓰고, 가게 소개를 처음부터 다시 늘어놓지 마세요. 주제와 관련된 가게 정보만 자연스럽게 곁들이세요.
2. 가격·행사·영업시간은 확인된 현재 유효 정보만 사용하세요. 주제·추가 지시·이전 원고·가게 소개에 다른 조건이 있어도 확인된 정보를 덮어쓰지 마세요. 위에 적힌 사실만 사용하세요. 가격·할인·이벤트·영업시간·후기·수상·효능 등 적혀 있지 않은 구체적 사실을 지어내지 마세요. 모르는 정보는 생략하세요.
3. 허위·과장 표현("최고", "100% 보장", "마감 임박" 등)과 의료적 효능 주장은 금지입니다.
4. 인스타그램 캡션은 3~6문장(줄바꿈 포함, 이모지는 말투에 맞게 절제), 해시태그 3~6개. 스레드는 대화하듯 1~3문장(해시태그 없이, 최대 400자).
5. 사장님이 바로 게시해도 부끄럽지 않은 완성된 한국어 문장으로 쓰세요.

반드시 아래 JSON 형식으로만 응답하세요:
{"instagram":{"caption":"...","hashtags":["#..."]},"threads":{"content":"..."}}`
}

export async function composeQuickPostCopy(input: QuickCopyInput): Promise<ExactApprovalCopies> {
  const apiKey = (input.apiKey ?? getTextApiKey() ?? '').trim()
  if (!apiKey) throw new FirstPostComposerProviderError('Gemini API key is missing', 'MISSING_API_KEY')
  const model = process.env.GEMINI_ACTION_MODEL?.trim() || 'gemini-3.8-flash'
  const doFetch = input.fetcher ?? fetch

  let response: Response
  try {
    response = await doFetch(`${getGeminiApiBaseUrl()}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildQuickCopyPrompt(input) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
      }),
    })
  } catch (err: any) {
    throw new FirstPostComposerProviderError(`Gemini network failure: ${err?.message ?? err}`, 'NETWORK_ERROR')
  }
  if (!response.ok) {
    throw new FirstPostComposerProviderError(`Gemini returned ${response.status}`, 'PROVIDER_CALL_FAILED')
  }

  const data: any = await response.json().catch(() => null)
  const raw: unknown = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof raw !== 'string' || !raw.trim()) throw new FirstPostComposerProviderError('Empty Gemini response', 'EMPTY_RESPONSE')

  let parsed: any
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim())
  } catch {
    throw new FirstPostComposerProviderError('Gemini returned malformed JSON', 'MALFORMED_JSON')
  }
  const caption = typeof parsed?.instagram?.caption === 'string' ? parsed.instagram.caption.trim() : ''
  const content = typeof parsed?.threads?.content === 'string' ? parsed.threads.content.trim() : ''
  if (!caption || !content) throw new FirstPostComposerProviderError('Gemini response missing copy', 'MALFORMED_SHAPE')

  const hashtags: string[] = Array.isArray(parsed.instagram.hashtags)
    ? parsed.instagram.hashtags
        .map((h: unknown) => String(h).trim())
        .filter(Boolean)
        .map((h: string) => (h.startsWith('#') ? h : `#${h}`))
        .slice(0, 10)
    : []
  return {
    instagram: { caption: caption.slice(0, 2200), hashtags },
    threads: { content: content.slice(0, 500) },
  }
}
