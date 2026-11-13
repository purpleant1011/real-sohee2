export const INSTAGRAM_MAX_TEXT_LENGTH = 2_200
export const INSTAGRAM_MIN_MEDIA = 1
export const INSTAGRAM_MAX_MEDIA = 10
export const THREADS_MAX_TEXT_LENGTH = 500
export const THREADS_MAX_MEDIA = 1
export const DEFAULT_AI_DISCLOSURE = 'AI를 활용해 제작한 이미지와 문안입니다.'

export type MetaChannelIssue = Readonly<{
  code: 'instagram_media' | 'instagram_text' | 'threads_media' | 'threads_text'
  message: string
}>

export type MetaChannelCandidate = Readonly<{
  channel: 'instagram' | 'threads'
  text: string
  mediaCount: number
}>

const internalProductionCopyFragments = [
  'AI를활용해제작',
  'AI로제작',
  'AI가생성',
  'AI보조로제작',
  'AI초안',
  '게시전검토',
  '검토용초안',
  '자동게시',
  '활성하네스',
] as const

const internalProductionPhrases = /\s*(?:AI를\s*활용해\s*제작한\s*이미지와\s*문안입니다\.?|검토용\s*초안입니다\.?|소희\s*자동\s*게시\s*시스템입니다\.?|활성\s*하네스를\s*적용한\s*결과입니다\.?)\s*/giu

export function sanitizePublicMetaCopy(value: string): string {
  return value
    .replace(internalProductionPhrases, ' ')
    .split('\n')
    .map((line) => line
      .split(/(?<=[.!?])\s+/u)
      .filter((sentence) => {
        const normalized = sentence.replace(/\s+/gu, '')
        return !internalProductionCopyFragments.some((fragment) => normalized.includes(fragment))
      })
      .join(' ')
      .trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1]?.length !== 0))
    .join('\n')
    .replace(/\s+([.!?])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}

export function normalizeHashtag(value: string) {
  const withoutHash = value.startsWith('#') ? value.slice(1) : value
  if (!/^[\p{L}\p{N}_]{1,99}$/u.test(withoutHash)) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  return `#${withoutHash}`
}

export function composeMetaPostText(input: Readonly<{
  caption: string
  hashtags: readonly string[]
  disclosure: string
}>): string {
  return [
    sanitizePublicMetaCopy(input.caption),
    input.hashtags.length > 0 ? input.hashtags.map(normalizeHashtag).join(' ') : '',
  ].filter((part) => part.length > 0).join('\n\n')
}

export function evaluateMetaChannelLimits(input: MetaChannelCandidate): readonly MetaChannelIssue[] {
  const issues: MetaChannelIssue[] = []
  if (input.channel === 'instagram') {
    if (input.mediaCount < INSTAGRAM_MIN_MEDIA || input.mediaCount > INSTAGRAM_MAX_MEDIA) {
      issues.push({ code: 'instagram_media', message: 'Instagram은 이미지 1장부터 10장까지 게시할 수 있어요.' })
    }
    if (input.text.length < 1 || input.text.length > INSTAGRAM_MAX_TEXT_LENGTH) {
      issues.push({ code: 'instagram_text', message: 'Instagram 문구는 2,200자 이내로 줄여 주세요.' })
    }
  } else {
    if (input.mediaCount > THREADS_MAX_MEDIA) {
      issues.push({ code: 'threads_media', message: 'Threads는 현재 이미지 1장까지 게시할 수 있어요.' })
    }
    if (input.text.length < 1 || input.text.length > THREADS_MAX_TEXT_LENGTH) {
      issues.push({ code: 'threads_text', message: 'Threads 문구는 500자 이내로 줄여 주세요.' })
    }
  }
  return Object.freeze(issues.map((issue) => Object.freeze(issue)))
}

/** 첫 포스팅 승인 원고(채널별). CTA 는 근거가 있을 때만 있다(ANI-1775). */
export type FirstPostChannelCopies = Readonly<{
  instagram: { caption: string; hashtags?: readonly string[]; cta?: string }
  threads: { content: string; cta?: string }
}>

function ctaSuffix(cta?: string): string {
  return typeof cta === 'string' && cta.trim() ? `\n\n${cta.trim()}` : ''
}

/**
 * 승인 원고 → 실제 게시 본문 (ANI-1775).
 *
 * 승인 화면·승인 지문과 게시 직렬화가 같은 문자열을 쓰도록 한 곳에 둔다.
 * 순서: 인스타그램 `캡션 → CTA → 해시태그`, 스레드 `본문 → CTA`.
 * CTA 가 없으면 이 함수 도입 전과 완전히 같은 문자열이다.
 */
export function composeFirstPostChannelText(
  channel: 'instagram' | 'threads',
  copies: FirstPostChannelCopies,
): string {
  if (channel === 'instagram') {
    const copy = copies.instagram
    const hashtags = copy.hashtags?.length
      ? '\n\n' + copy.hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ')
      : ''
    return copy.caption + ctaSuffix(copy.cta) + hashtags
  }
  return copies.threads.content + ctaSuffix(copies.threads.cta)
}

export function metaChannelTextLimit(channel: 'instagram' | 'threads'): number {
  return channel === 'instagram' ? INSTAGRAM_MAX_TEXT_LENGTH : THREADS_MAX_TEXT_LENGTH
}

/** provider 가 받아 주는 길이인가. 넘으면 게시가 거부되므로 생성 단계에서 CTA 를 접어야 한다. */
export function fitsChannelTextLimit(channel: 'instagram' | 'threads', text: string): boolean {
  return text.length >= 1 && text.length <= metaChannelTextLimit(channel)
}

export function buildChannelCopy(input: Readonly<{
  channel: 'instagram' | 'threads'
  caption: string
  hashtags: readonly string[]
  disclosure: string
}>): string {
  const text = composeMetaPostText(input)
  if (evaluateMetaChannelLimits({ channel: input.channel, text, mediaCount: input.channel === 'instagram' ? 1 : 0 })
    .some((issue) => issue.code.endsWith('text'))) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  if (text.length < 1 || text.length > (input.channel === 'instagram' ? INSTAGRAM_MAX_TEXT_LENGTH : THREADS_MAX_TEXT_LENGTH)) {
    throw new Error('승인된 게시 버전을 다시 확인해 주세요.')
  }
  return text
}
