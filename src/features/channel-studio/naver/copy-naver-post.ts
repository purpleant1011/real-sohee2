import {
  buildNaverManuscriptTags as tags,
  buildNaverManuscriptText,
  type NaverManuscript,
  type NaverManuscriptPart,
} from '@/features/content/naver-manuscript'

export type NaverPostForCopy = NaverManuscript & Readonly<{
  imageUrls?: readonly string[]
  media?: readonly Readonly<{ id: string; src: string }>[]
}>

export type NaverCopyPart = NaverManuscriptPart

function htmlText(text: string): string {
  return escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>')
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value, 'https://example.com')
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function imageHtml(src: string | undefined, alt: string): string {
  const url = src && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/iu.test(src) ? src : src ? safeUrl(src) : null
  return url ? `<p><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" /></p>` : ''
}

export function buildNaverHtmlContent(post: NaverPostForCopy, part: NaverCopyPart = 'all'): string {
  if (part === 'title') return escapeHtml(post.title)
  if (part === 'tags') return escapeHtml(tags(post))
  const parts: string[] = []
  if (part === 'all') parts.push(`<h1>${escapeHtml(post.title)}</h1>`)

  // 편집 블록이 있으면 요약/구조화 초안이 아니라 최종 블록 순서를 따른다.
  if (post.editorBlocks?.length) {
    for (const block of post.editorBlocks) {
      switch (block.kind) {
        case 'heading': parts.push(`<h3>${htmlText(block.text)}</h3>`); break
        case 'paragraph': parts.push(`<p>${htmlText(block.text)}</p>`); break
        case 'quote':
        case 'cta': parts.push(`<blockquote><p>${htmlText(block.text)}</p></blockquote>`); break
        case 'image': parts.push(imageHtml(post.media?.find((media) => media.id === block.mediaId)?.src, block.altText)); break
        case 'link': {
          const url = safeUrl(block.url)
          parts.push(url ? `<p><a href="${escapeHtml(url)}">${htmlText(block.title)}</a></p>` : `<p>${htmlText(block.title)}</p>`)
          break
        }
        case 'map': parts.push(`<p>${htmlText(block.placeName)}</p>`); break
      }
    }
  } else {
    if (post.introduction) parts.push(`<p>${htmlText(post.introduction)}</p>`)
    parts.push(imageHtml(post.imageUrls?.[0], '대표 이미지'))
    for (const [index, section] of post.sections.entries()) {
      if (section.heading) parts.push(`<h3>${htmlText(section.heading)}</h3>`)
      if (section.body) parts.push(`<p>${htmlText(section.body)}</p>`)
      parts.push(imageHtml(post.imageUrls?.[index + 1], `본문 이미지 ${index + 2}`))
    }
    if (post.cta) parts.push(`<blockquote><p>${htmlText(post.cta)}</p></blockquote>`)
  }
  if (post.disclosure) parts.push(`<p>${htmlText(post.disclosure)}</p>`)
  if (part === 'all' && tags(post)) parts.push(`<p>${escapeHtml(tags(post))}</p>`)
  return parts.filter(Boolean).join('\n\n')
}

export function buildNaverPlainTextContent(post: NaverPostForCopy, part: NaverCopyPart = 'all'): string {
  return buildNaverManuscriptText(post, part)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export type NaverCopyResult =
  | 'html'
  | 'text'
  | 'permission_denied'
  | 'html_unsupported'
  | 'clipboard_unavailable'
  | 'failed'

function isPermissionDeniedError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const error = err as { name?: string; message?: string }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return true
    if (typeof error.message === 'string' && /permission denied|not allowed/i.test(error.message)) return true
  }
  return false
}

function isHtmlUnsupportedError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const error = err as { name?: string; message?: string }
    if (error.name === 'NotSupportedError') return true
    if (typeof error.message === 'string' && /not supported|unsupported type|text\/html/i.test(error.message)) return true
  }
  return false
}

export async function copyNaverPostWithResult(
  post: NaverPostForCopy,
  part: NaverCopyPart = 'all',
  format: 'text' | 'html' = 'text'
): Promise<NaverCopyResult> {
  const text = buildNaverPlainTextContent(post, part)
  if (!text.trim()) return 'failed'
  if (typeof navigator === 'undefined' || !navigator.clipboard) return 'clipboard_unavailable'

  let htmlError: unknown = null
  if (format === 'html' && part !== 'title' && part !== 'tags') {
    if (typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([buildNaverHtmlContent(post, part)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
        return 'html'
      } catch (err) {
        htmlError = err
      }
    } else {
      htmlError = { name: 'NotSupportedError', message: 'ClipboardItem or write unsupported' }
    }
  }

  try {
    if (typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      if (format === 'html' && isHtmlUnsupportedError(htmlError)) {
        return 'html_unsupported'
      }
      return 'text'
    }
  } catch (err) {
    if (isPermissionDeniedError(err)) return 'permission_denied'
    return 'failed'
  }

  if (isPermissionDeniedError(htmlError)) return 'permission_denied'
  if (isHtmlUnsupportedError(htmlError)) return 'html_unsupported'
  return 'failed'
}

export async function copyNaverPostToClipboard(post: NaverPostForCopy): Promise<boolean> {
  const result = await copyNaverPostWithResult(post)
  return result === 'html' || result === 'text' || result === 'html_unsupported'
}
