import { parseConversationImageRequest, type ConversationImageCount } from './conversation-image-intent'
import type { ContentInterviewState } from './content-interview'

export type ConversationPostCandidate = Readonly<{
  channel: 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'
  count: ConversationImageCount
  direction: 'result' | 'trust' | 'question'
  instruction: string
}>

export type ConversationPostPurpose = 'promotion' | 'daily' | 'branding' | 'event'

export type ConversationPostRequest = Readonly<{
  prompt: string
  candidates: readonly ConversationPostCandidate[]
  purpose?: ConversationPostPurpose
}>

const postPattern = /(포스팅|게시물|콘텐츠|피드|캐러셀|스레드|threads?|인스타|instagram|네이버\s*블로그|블로그|naver\s*blog|당근(?:마켓|\s*비즈(?:니스|프로필)?|(?:에|으로|에서)(?=\s|$)|(?=(?:은|는|이|가|을|를)?\s*(?:말고|빼고|제외|없이|아니고|빼)))|daangn)/iu
const creationPattern = /(기획|제안|작성|만들|준비|써\s*줘|(?:포스팅|게시(?:물)?|콘텐츠)(?:을|를)?\s*(?:하고\s*싶|하고싶|진행|해\s*줘|하려|할래)|올리(?:고\s*싶|고싶|려|기|자|어|고)|올려|올릴|말고|빼고|제외|없이|아니고|빼(?=[어여줘라]|고|서|\b|[.\s,!~]|$))/u
const negationPattern = /(포스팅|게시물|콘텐츠).{0,12}(만들지|작성하지|제안하지|필요 없|제외)/u
const analysisOnlyPattern = /(성과|반응|지표|리포트).{0,12}(분석|정리|설명|평가)/u
const imageOnlyPattern = /(이미지|사진).{0,20}(만들|생성)/u
const explicitPostFormatPattern = /(포스팅|게시물|콘텐츠|피드|캐러셀)/u

type ChannelId = 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'

const CHANNEL_NEGATION_SUFFIX = /^(?:은|는|이|가|을|를|도|엔|에는|에선|에서는)?\s*(?:말고|빼고(?:는)?|제외하고(?:는)?|제외(?:해\s*줘)?|제외(?:는)?|없이|아니고|빼(?:줘|서|라|고(?:는)?)?)(?=[,\.\s!~]|$|\b|는|도)/u

const CHANNEL_DEFINITIONS: ReadonlyArray<{
  channel: ChannelId
  regex: RegExp
}> = [
  { channel: 'instagram', regex: /(?:인스타(?:그램)?|instagram|캐러셀|피드)/giu },
  { channel: 'threads', regex: /(?:스레드|threads?)/giu },
  { channel: 'naver_blog', regex: /(?:네이버\s*블로그|블로그|naver\s*blog)/giu },
  { channel: 'daangn_business', regex: /(?:당근(?:마켓|\s*비즈(?:니스|프로필)?|(?:에|으로|에서)(?=\s|$)|(?=(?:은|는|이|가|을|를)?\s*(?:말고|빼고|제외|없이|아니고|빼)))|daangn)/giu },
]

function parseRequestedChannels(prompt: string): ChannelId[] {
  const positives: ChannelId[] = []

  for (const { channel, regex } of CHANNEL_DEFINITIONS) {
    const matches = [...prompt.matchAll(regex)]
    if (matches.length === 0) continue

    let hasNegated = false
    let hasPositive = false

    for (const match of matches) {
      const suffix = prompt.slice(match.index + match[0].length)
      if (CHANNEL_NEGATION_SUFFIX.test(suffix)) {
        hasNegated = true
      } else {
        hasPositive = true
      }
    }

    if (hasPositive && !hasNegated) {
      positives.push(channel)
    }
  }

  // 긍정 채널이 남아있으면 부정 채널은 배제하고 긍정 채널만 반환; 남지 않으면 기본 동작(빈 배열) 유지
  return positives
}

const candidates = {
  result: Object.freeze({
    direction: 'result' as const,
    instruction: '결과가 먼저 보이는 전후 기록형 완성 게시물로 제안하세요.',
  }),
  trust: Object.freeze({
    direction: 'trust' as const,
    instruction: '사업자의 상담 기준과 전문성을 설명하는 신뢰형 완성 게시물로 제안하세요.',
  }),
  question: Object.freeze({
    direction: 'question' as const,
    instruction: '고객이 자주 묻는 질문에서 시작해 상담 행동으로 이어지는 완성 게시물로 제안하세요.',
  }),
} as const

function parsePurpose(prompt: string): ConversationPostPurpose | undefined {
  if (/이벤트/u.test(prompt)) return 'event'
  if (/프로모션/u.test(prompt)) return 'promotion'
  if (/일상/u.test(prompt)) return 'daily'
  if (/홍보/u.test(prompt)) return 'branding'
  return undefined
}

export function parseConversationPostRequest(message: string): ConversationPostRequest | null {
  const prompt = message.trim()
  if (prompt.length === 0 || prompt.length > 1_500) return null

  // 구조화된 인터뷰 답변/컨트롤 JSON 및 brace-framed 입력은 자연어 신규 포스팅 요청으로 오판/승격하지 않는다
  if (prompt.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(prompt)
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        if (
          ('image' in obj && 'callToAction' in obj) ||
          ('value' in obj && 'source' in obj) ||
          obj.kind === 'content_interview_control'
        ) {
          return null
        }
      }
    } catch {
      // 불완전하거나 깨진 JSON을 자연어 신규 요청으로 자동 승격하지 않는다
      return null
    }
  }

  if (!postPattern.test(prompt) || !creationPattern.test(prompt)) return null
  if (negationPattern.test(prompt) || analysisOnlyPattern.test(prompt)) return null
  if (imageOnlyPattern.test(prompt) && !explicitPostFormatPattern.test(prompt)) return null

  const purpose = parsePurpose(prompt)
  const detectedChannels = parseRequestedChannels(prompt)

  const imageRequest = parseConversationImageRequest(prompt)

  if (detectedChannels.length === 0) {
    return Object.freeze({
      prompt,
      ...(purpose ? { purpose } : {}),
      candidates: Object.freeze([
        Object.freeze({ channel: 'instagram' as const, count: 3 as const, ...candidates.result }),
        Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.trust }),
        Object.freeze({ channel: 'instagram' as const, count: 2 as const, ...candidates.question }),
      ]),
    })
  }

  if (detectedChannels.length === 1) {
    const single = detectedChannels[0]
    if (single === 'naver_blog') {
      return Object.freeze({
        prompt,
        ...(purpose ? { purpose } : {}),
        candidates: Object.freeze([
          Object.freeze({
            channel: 'naver_blog' as const,
            count: imageRequest?.channel === 'naver_blog' ? imageRequest.count : 7 as const,
            ...candidates.trust,
          }),
        ]),
      })
    }

    if (single === 'threads') {
      return Object.freeze({
        prompt,
        ...(purpose ? { purpose } : {}),
        candidates: Object.freeze([
          Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.trust }),
          Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.question }),
        ]),
      })
    }

    if (single === 'instagram') {
      return Object.freeze({
        prompt,
        ...(purpose ? { purpose } : {}),
        candidates: Object.freeze([
          Object.freeze({ channel: 'instagram' as const, count: 3 as const, ...candidates.result }),
          Object.freeze({ channel: 'instagram' as const, count: 2 as const, ...candidates.question }),
        ]),
      })
    }

    return Object.freeze({
      prompt,
      ...(purpose ? { purpose } : {}),
      candidates: Object.freeze([
        Object.freeze({ channel: 'daangn_business' as const, count: 1 as const, ...candidates.trust }),
      ]),
    })
  }

  const requestsTwoEach = /(각각\s*(?:2|두)\s*개씩|(?:2|두)\s*개씩)/u.test(prompt)
  if (requestsTwoEach) {
    const resultCandidates: ConversationPostCandidate[] = []
    for (const channel of detectedChannels) {
      if (channel === 'instagram') {
        resultCandidates.push(
          Object.freeze({ channel: 'instagram' as const, count: 3 as const, ...candidates.result }),
          Object.freeze({ channel: 'instagram' as const, count: 2 as const, ...candidates.question }),
        )
      } else if (channel === 'threads') {
        resultCandidates.push(
          Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.trust }),
          Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.question }),
        )
      } else if (channel === 'naver_blog') {
        const naverBlogCount = (imageRequest?.channel === 'naver_blog' ? imageRequest.count : 7) as ConversationImageCount
        resultCandidates.push(
          Object.freeze({ channel: 'naver_blog' as const, count: naverBlogCount, ...candidates.trust }),
          Object.freeze({ channel: 'naver_blog' as const, count: naverBlogCount, ...candidates.question }),
        )
      } else if (channel === 'daangn_business') {
        resultCandidates.push(
          Object.freeze({ channel: 'daangn_business' as const, count: 1 as const, ...candidates.trust }),
          Object.freeze({ channel: 'daangn_business' as const, count: 1 as const, ...candidates.question }),
        )
      }
    }
    return Object.freeze({
      prompt,
      ...(purpose ? { purpose } : {}),
      candidates: Object.freeze(resultCandidates),
    })
  }

  const resultCandidates: ConversationPostCandidate[] = []
  for (const channel of detectedChannels) {
    if (channel === 'instagram') {
      const instagramCount = Math.min(imageRequest?.count ?? 3, 3) as ConversationImageCount
      resultCandidates.push(
        Object.freeze({ channel: 'instagram' as const, count: instagramCount, ...candidates.result }),
      )
    } else if (channel === 'threads') {
      resultCandidates.push(
        Object.freeze({ channel: 'threads' as const, count: 1 as const, ...candidates.trust }),
      )
    } else if (channel === 'naver_blog') {
      const naverBlogCount = (imageRequest?.channel === 'naver_blog' ? imageRequest.count : 7) as ConversationImageCount
      resultCandidates.push(
        Object.freeze({ channel: 'naver_blog' as const, count: naverBlogCount, ...candidates.trust }),
      )
    } else if (channel === 'daangn_business') {
      resultCandidates.push(
        Object.freeze({ channel: 'daangn_business' as const, count: 1 as const, ...candidates.trust }),
      )
    }
  }

  return Object.freeze({
    prompt,
    ...(purpose ? { purpose } : {}),
    candidates: Object.freeze(resultCandidates),
  })
}

export function withoutManualOnlyChannels(request: ConversationPostRequest | null) {
  if (!request) return null
  const candidates = request.candidates.filter((c): c is typeof c & { channel: 'instagram' | 'threads' | 'naver_blog' } => c.channel !== 'daangn_business')
  return candidates.length > 0 ? { ...request, candidates } : null
}

export function postRequestFromInterviewState(state: ContentInterviewState) {
  const extraDirection = state.brief?.imageDirection.extraDirection?.trim()
    || state.answers.visualCta?.imagePreferences?.extraDirection?.trim()
  const explicitSingleImage = Boolean(extraDirection && /(?:이미지|사진)?\s*(?:는\s*)?(?:1|한)\s*장\s*(?:만)?/u.test(extraDirection))

  return {
    prompt: state.originalPrompt,
    candidates: state.channels
      .filter((channel): channel is 'instagram' | 'threads' | 'naver_blog' => channel !== 'daangn_business')
      .map((channel) => {
        const rawCount = state.requestedImageCounts[channel] as ConversationImageCount
        const count = (explicitSingleImage && channel === 'instagram') ? (1 as const) : rawCount
        return {
          channel,
          count,
          direction: 'result' as const,
          instruction: '',
        }
      }),
  }
}
