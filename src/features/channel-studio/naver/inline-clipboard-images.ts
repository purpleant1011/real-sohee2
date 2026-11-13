import { buildNaverHtmlContent, buildNaverPlainTextContent, copyNaverPostWithResult, type NaverCopyPart, type NaverCopyResult, type NaverPostForCopy } from './copy-naver-post'

const mediaPath = /^\/api\/workspaces\/[0-9a-f-]{36}\/media\/([0-9a-f-]{36})$/iu
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const maxImageBytes = 6 * 1024 * 1024
const maxTotalBytes = 24 * 1024 * 1024

/** Private media stays in memory; no credential-bearing URL is exported to another site. */
export async function inlineClipboardImages(post: NaverPostForCopy, fetcher: typeof fetch = fetch): Promise<NaverPostForCopy> {
  const ids = [...new Set(post.editorBlocks?.flatMap(block => block.kind === 'image' ? [block.mediaId] : []) ?? [])]
  if (ids.length > 20) throw new Error('CLIPBOARD_IMAGE_LIMIT')
  let bytes = 0
  const media: { id: string; src: string }[] = []
  for (const id of ids) {
    const item = post.media?.find(value => value.id === id)
    const match = item?.src.match(mediaPath)
    if (!item || match?.[1] !== id) throw new Error('CLIPBOARD_IMAGE_SOURCE_INVALID')
    // The authorized media endpoint redirects to private storage. Cross-origin cookies
    // stay excluded; only the resulting image bytes, never the signed URL, are copied.
    const response = await fetcher(item.src, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'follow' })
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!response.ok || !type || !allowedTypes.has(type) || Number(response.headers.get('content-length') ?? 0) > maxImageBytes) throw new Error('CLIPBOARD_IMAGE_UNAVAILABLE')
    const blob = await response.blob()
    bytes += blob.size
    if (!blob.size || blob.size > maxImageBytes || bytes > maxTotalBytes) throw new Error('CLIPBOARD_IMAGE_LIMIT')
    const array = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let offset = 0; offset < array.length; offset += 8192) binary += String.fromCharCode(...array.subarray(offset, offset + 8192))
    media.push({ id, src: `data:${type};base64,${btoa(binary)}` })
  }
  return { ...post, media }
}

export async function copyNaverPostWithImages(post: NaverPostForCopy, part: NaverCopyPart = 'body'): Promise<NaverCopyResult> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return 'clipboard_unavailable'
  if (typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') return copyNaverPostWithResult(post, part, 'text')
  try {
    // Supply the promise to ClipboardItem immediately so Safari retains the user's click activation.
    const html = inlineClipboardImages(post).then(value => new Blob([buildNaverHtmlContent(value, part)], { type: 'text/html' }))
    void html.catch(() => undefined)
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': html,
      'text/plain': new Blob([buildNaverPlainTextContent(post, part)], { type: 'text/plain' }),
    })])
    return 'html'
  } catch (error) {
    return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'permission_denied' : 'failed'
  }
}
