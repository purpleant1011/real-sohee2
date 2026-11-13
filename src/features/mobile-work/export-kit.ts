/**
 * 수동 채널 내보내기 키트 (네이버 블로그, 당근 비즈프로필 등)
 * 클라이언트 순수 함수 모음 (서버 임포트 없음)
 */

export type BuildExportTextInput = Readonly<{
  title?: string
  caption: string
  hashtags?: readonly string[] | string[]
  channel: string
}>

export type BuildMailtoHrefInput = Readonly<{
  subject: string
  body: string
}>

export type ShareContentInput = Readonly<{
  title?: string
  text?: string
  files?: readonly File[] | File[]
}>

export type ShareContentResult = 'shared' | 'cancelled' | 'unsupported' | 'error'

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

function formatHashtags(hashtags?: readonly string[] | string[]): string {
  if (!hashtags || hashtags.length === 0) return ''
  const formatted = hashtags
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
  return formatted.join(' ')
}

/**
 * 채널별 규격에 맞게 텍스트를 조합한다.
 * - naver_blog: title + 빈 줄 + body + 빈 줄 + tags
 * - daangn_business: body + tags
 */
export function buildExportText(input: BuildExportTextInput): string {
  const { title = '', caption, hashtags, channel } = input
  const tagsLine = formatHashtags(hashtags)
  const trimmedCaption = caption.trim()
  const trimmedTitle = title.trim()

  if (channel === 'daangn_business') {
    const parts: string[] = []
    if (trimmedCaption) parts.push(trimmedCaption)
    if (tagsLine) parts.push(tagsLine)
    return parts.join('\n\n')
  }

  // naver_blog 및 기본 포맷
  const parts: string[] = []
  if (trimmedTitle) parts.push(trimmedTitle)
  if (trimmedCaption) parts.push(trimmedCaption)
  if (tagsLine) parts.push(tagsLine)
  return parts.join('\n\n')
}

/**
 * 이메일 클라이언트 본문 길이 한계(~1800자)를 고려해 mailto URI를 생성한다.
 */
export function buildMailtoHref(input: BuildMailtoHrefInput): string {
  const { subject, body } = input
  const MAX_BODY_LENGTH = 1800
  const TRAILING_NOTE = '\n\n...(본문이 길어 일부만 담겼어요. 앱에서 복사 기능을 이용해 주세요)'

  let finalBody = body
  if (finalBody.length > MAX_BODY_LENGTH) {
    finalBody = finalBody.slice(0, MAX_BODY_LENGTH) + TRAILING_NOTE
  }

  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(finalBody)}`
}

/**
 * 0부터 시작하는 인덱스와 MIME 타입으로 파일명을 생성한다. (예: 01.jpg)
 */
export function imageFileName(index: number, mime?: string): string {
  const normalizedMime = mime?.split(';')[0]?.trim().toLowerCase() ?? ''
  const extension = MIME_TO_EXTENSION[normalizedMime] ?? 'jpg'
  const fileNumber = String(index + 1).padStart(2, '0')
  return `${fileNumber}.${extension}`
}

/**
 * Web Share API를 안전하게 호출한다.
 */
export async function shareContent(input: ShareContentInput): Promise<ShareContentResult> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unsupported'
  }

  const shareData: ShareData = {}
  if (input.title) shareData.title = input.title
  if (input.text) shareData.text = input.text

  if (input.files && input.files.length > 0) {
    const filesArray = Array.from(input.files)
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: filesArray })) {
      shareData.files = filesArray
    }
  }

  if (typeof navigator.canShare === 'function' && !navigator.canShare(shareData)) {
    // files 때문에 실패한 경우 text만 남겨서 시도 가능한지 확인
    if (shareData.files) {
      const fallbackData: ShareData = { ...shareData }
      delete fallbackData.files
      if (navigator.canShare(fallbackData)) {
        return executeShare(fallbackData)
      }
    }
    return 'unsupported'
  }

  return executeShare(shareData)
}

async function executeShare(data: ShareData): Promise<ShareContentResult> {
  try {
    await navigator.share(data)
    return 'shared'
  } catch (err) {
    if (err && typeof err === 'object' && (err as Error).name === 'AbortError') {
      return 'cancelled'
    }
    return 'error'
  }
}

/**
 * Blob과 a 태그를 이용해 브라우저에서 텍스트 파일을 직접 내려받는다.
 */
export function downloadTextFile(filename: string, text: string): boolean {
  if (typeof document === 'undefined') return false
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  try {
    link.click()
    return true
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
