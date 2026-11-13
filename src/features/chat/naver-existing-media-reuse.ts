import type { GeneratedImageBatch, ImageSlideRole } from './conversation-image-batch'
import type { ConversationImageCount } from './conversation-image-intent'

export type ReusableNaverMediaCandidate = Readonly<{
  mediaAssetId: string
  title: string
  caption: string
  createdAt: string
}>

export function requestsExistingNaverMedia(prompt: string): boolean {
  const normalized = prompt.replace(/\s+/gu, ' ').trim()
  return /(?:기존|사용권 확인)[^.!?]{0,80}(?:이미지|사진)/u.test(normalized)
    && /(?:재사용|활용|사용)/u.test(normalized)
    && /(?:새|추가)[^.!?]{0,40}(?:생성)[^.!?]{0,30}(?:하지|말)/u.test(normalized)
}

/** 원본 사용 지시만 구분한다. 스타일 참고·변형 요청을 원본 재사용으로 바꾸지 않는다. */
export function requestsAttachedMediaReuse(prompt: string): boolean {
  const text = prompt.replace(/\s+/gu, ' ').trim()
  if (/(?:사진|이미지|원본)[^.!?]{0,20}(?:사용|활용|재사용|복사)\s*하지|(?:사진|이미지|원본)[^.!?]{0,20}쓰지\s*마|(?:사진|이미지|원본)(?:은|는|을|를)?\s*말고/u.test(text)) return false
  if (/새(?:로운|로)?\s*(?:이미지|사진)[^.!?]{0,20}(?:생성해|생성하(?:고|여)|만들어|만들고|그려)|(?:이미지|사진)[^.!?]{0,10}새로\s*(?:생성해|만들어|그려)/u.test(text)) return false
  if (/(?:스타일|색감|구도|분위기)[^.!?]{0,20}(?:참고|참조)|(?:참고|참조)[^.!?]{0,20}(?:새로|다시)/u.test(text)) return false
  return /(?:첨부|올린|업로드|원본|이\s*(?:사진|이미지))/u.test(text)
    && /원본[^.!?]{0,20}그대로|(?:사진|이미지)(?:으로|로)|(?:사진|이미지)[^.!?]{0,30}(?:그대로|사용|활용)/u.test(text)
}

function roleFor(position: number, count: number): ImageSlideRole {
  if (position === 1) return 'cover'
  if (position === count) return 'action'
  return 'detail'
}

function relevance(candidate: ReusableNaverMediaCandidate): number {
  const haystack = `${candidate.title}\n${candidate.caption}`
  if (/네이버 블로그/u.test(haystack)) return 3
  return 0
}

export function createExistingNaverMediaBatch(input: Readonly<{
  candidates: readonly ReusableNaverMediaCandidate[]
  count: ConversationImageCount
  idempotencyKey: string
  orderedMediaAssetIds?: readonly string[]
  isByreum?: boolean
  createSlideId(position: number): string
}>): GeneratedImageBatch {
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.mediaAssetId, candidate]))
  const selected = input.orderedMediaAssetIds
    ? input.orderedMediaAssetIds.flatMap((mediaAssetId) => {
        const candidate = candidateById.get(mediaAssetId)
        return candidate ? [candidate] : []
      })
    : [...input.candidates]
        .filter((candidate) => relevance(candidate) > 0)
        .sort((left, right) => relevance(right) - relevance(left)
          || right.createdAt.localeCompare(left.createdAt))
        .filter((candidate, index, all) => all.findIndex((item) => item.mediaAssetId === candidate.mediaAssetId) === index)
        .slice(0, input.count)

  if (selected.length !== input.count || new Set(selected.map((candidate) => candidate.mediaAssetId)).size !== input.count) {
    throw new Error('NAVER_REUSABLE_MEDIA_INSUFFICIENT')
  }

  const slides = selected.map((candidate, index) => {
    const position = index + 1
    const fallbackAltText = input.isByreum
      ? `바이름 네이버 블로그 ${position}번 이미지`
      : `블로그 이미지 ${position}번`
    return Object.freeze({
      id: input.createSlideId(position),
      position,
      role: roleFor(position, input.count),
      status: 'succeeded' as const,
      mediaAssetId: candidate.mediaAssetId,
      altText: candidate.title.trim() || fallbackAltText,
      retryable: false,
      safeErrorCode: null,
    })
  })

  return Object.freeze({
    idempotencyKey: input.idempotencyKey,
    status: 'ready_for_review' as const,
    requestedCount: input.count,
    startedCount: input.count,
    succeededCount: input.count,
    failedCount: 0,
    slides: Object.freeze(slides),
  })
}
