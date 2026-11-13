import {
  buildNaverManuscriptTags,
} from '@/features/content/naver-manuscript'
import type { NaverPostForCopy } from './copy-naver-post'

export type OneShotPhoto = Readonly<{
  id: string
  src: string
  name: string
}>

export type OneShotAssets = Readonly<{
  photoCount: number
  files: readonly File[]
  skippedPhotos: number
}>

export type OneShotCopyOutcome = Readonly<{
  status: 'ok' | 'denied' | 'unavailable' | 'failed'
  photos: number
}>

export type SharePhotosOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed'

const mediaPathRegex = /^\/api\/workspaces\/[0-9a-f-]{36}\/media\/([0-9a-f-]{36})$/iu
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxIndividualPhotoBytes = 20 * 1024 * 1024 // 20MB
const maxTotalCompressedBytes = 50 * 1024 * 1024 // 50MB

function buildPhotoFileName(index: number): string {
  const nn = String(index).padStart(2, '0')
  return `photo-${nn}.jpg`
}

export function listPostPhotos(post: NaverPostForCopy): readonly OneShotPhoto[] {
  const seenMediaIds = new Set<string>()
  const photos: OneShotPhoto[] = []
  const availableMedia = post.media ?? []

  if (post.editorBlocks?.length) {
    for (const block of post.editorBlocks) {
      if (block.kind !== 'image') continue
      if (seenMediaIds.has(block.mediaId)) continue
      const mediaItem = availableMedia.find((item) => item.id === block.mediaId)
      if (!mediaItem || !mediaItem.src) continue

      seenMediaIds.add(block.mediaId)
      const name = buildPhotoFileName(photos.length + 1)
      photos.push({ id: block.mediaId, src: mediaItem.src, name })
    }
  } else if (availableMedia.length) {
    for (const mediaItem of availableMedia) {
      if (seenMediaIds.has(mediaItem.id)) continue
      seenMediaIds.add(mediaItem.id)
      const name = buildPhotoFileName(photos.length + 1)
      photos.push({ id: mediaItem.id, src: mediaItem.src, name })
    }
  }

  return photos
}

function formatBlockText(
  block: NonNullable<NaverPostForCopy['editorBlocks']>[number]
): string {
  if ('text' in block) {
    return block.text.trim()
  }
  if (block.kind === 'link') {
    return block.title?.trim()
      ? `${block.title.trim()} (${block.url.trim()})`
      : block.url.trim()
  }
  if (block.kind === 'map') {
    return block.placeName.trim()
  }
  return ''
}

function isShortParagraphFormat(paragraphs: readonly string[]): boolean {
  if (paragraphs.length === 0) return false
  const allShort = paragraphs.every((p) => p.length <= 250)
  const avgLength =
    paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length
  return allShort || avgLength <= 180
}

export function buildGalleryPlainText(post: NaverPostForCopy): string {
  const title = post.title.trim()
  const tags = buildNaverManuscriptTags(post).trim()
  const photos = listPostPhotos(post)
  const photoCount = photos.length
  const hasPhotos = photoCount > 0

  let introParts: string[] = []
  const explanationParts: string[] = []
  const outroParts: string[] = []

  if (post.editorBlocks?.length) {
    const firstImageIndex = post.editorBlocks.findIndex((b) => b.kind === 'image')

    if (firstImageIndex === -1) {
      // 이미지 없는 글: 모든 블록을 순서대로 본문으로 처리
      introParts = post.editorBlocks
        .map(formatBlockText)
        .filter((text): text is string => text.length > 0)
    } else {
      // 첫 이미지 앞까지의 텍스트가 도입
      introParts = post.editorBlocks
        .slice(0, firstImageIndex)
        .map(formatBlockText)
        .filter((text): text is string => text.length > 0)

      // 첫 이미지 이후의 블록: 이미지는 제외
      const rawAfterBlocks = post.editorBlocks
        .slice(firstImageIndex + 1)
        .filter((b) => b.kind !== 'image')

      // 후미 CTA 블록 분리
      const explanationBlocks: typeof rawAfterBlocks = []
      const trailingCtaBlocks: typeof rawAfterBlocks = []

      let inTrailingCta = false
      for (let i = rawAfterBlocks.length - 1; i >= 0; i--) {
        const block = rawAfterBlocks[i]
        if (block.kind === 'cta' && (i === rawAfterBlocks.length - 1 || inTrailingCta)) {
          inTrailingCta = true
          trailingCtaBlocks.unshift(block)
        } else {
          inTrailingCta = false
          explanationBlocks.unshift(block)
        }
      }

      // 사진 설명 목록 포맷팅
      const explanationParagraphs = explanationBlocks.filter(
        (b) => b.kind === 'paragraph' || b.kind === 'quote'
      )
      const shouldNumber =
        hasPhotos &&
        explanationParagraphs.length > 0 &&
        (photoCount >= 8 ||
          isShortParagraphFormat(
            explanationParagraphs.map((b) => ('text' in b ? b.text : ''))
          ))

      let paragraphCounter = 0
      for (const block of explanationBlocks) {
        if (block.kind === 'heading') {
          // 소제목(heading)은 한 줄로 유지
          explanationParts.push(block.text.trim())
        } else if (block.kind === 'paragraph' || block.kind === 'quote') {
          paragraphCounter++
          const text = block.text.trim()
          if (shouldNumber) {
            const cleanText = text.replace(/^\d+[\.\)]\s*/u, '')
            explanationParts.push(`${paragraphCounter}. ${cleanText}`)
          } else {
            explanationParts.push(text)
          }
        } else {
          const formatted = formatBlockText(block)
          if (formatted) explanationParts.push(formatted)
        }
      }

      for (const block of trailingCtaBlocks) {
        const formatted = formatBlockText(block)
        if (formatted) outroParts.push(formatted)
      }
    }
  } else {
    // Traditional format
    if (post.introduction?.trim()) {
      introParts.push(post.introduction.trim())
    }

    if (post.sections?.length) {
      for (const section of post.sections) {
        if (section.heading?.trim()) {
          explanationParts.push(section.heading.trim())
        }
        if (section.body?.trim()) {
          explanationParts.push(section.body.trim())
        }
      }
    }

    if (post.cta?.trim()) {
      outroParts.push(post.cta.trim())
    }
  }

  if (post.cta?.trim() && !outroParts.includes(post.cta.trim())) {
    outroParts.push(post.cta.trim())
  }

  if (post.disclosure?.trim()) {
    outroParts.push(post.disclosure.trim())
  }

  const sections: string[] = []
  if (title) sections.push(title)
  if (introParts.length > 0) sections.push(introParts.join('\n\n'))
  if (explanationParts.length > 0) sections.push(explanationParts.join('\n\n'))
  if (outroParts.length > 0) sections.push(outroParts.join('\n\n'))
  if (tags) sections.push(tags)

  return sections.join('\n\n')
}

export async function compressImageToJpeg(
  blob: Blob,
  maxDimension: number = 1600,
  quality: number = 0.82
): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') {
    return blob
  }

  try {
    const bitmap = await createImageBitmap(blob)
    try {
      const { width, height } = bitmap
      let targetWidth = width
      let targetHeight = height

      const maxSide = Math.max(width, height)
      if (maxSide > maxDimension) {
        const ratio = maxDimension / maxSide
        targetWidth = Math.round(width * ratio)
        targetHeight = Math.round(height * ratio)
      }

      if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(targetWidth, targetHeight)
        const ctx = canvas.getContext('2d')
        if (ctx && typeof canvas.convertToBlob === 'function') {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
          return await canvas.convertToBlob({ type: 'image/jpeg', quality })
        }
      }

      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (ctx && typeof canvas.toBlob === 'function') {
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
          const result = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', quality)
          })
          if (result) return result
        }
      }

      return blob
    } finally {
      bitmap.close?.()
    }
  } catch {
    return blob
  }
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer()
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function createLimiter(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []

  const next = () => {
    active--
    if (queue.length > 0 && active < concurrency) {
      active++
      const resolve = queue.shift()!
      resolve()
    }
  }

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    } else {
      active++
    }
    try {
      return await fn()
    } finally {
      next()
    }
  }
}

type PreparedPhotoResult =
  | { readonly ok: true; readonly file: File; readonly size: number }
  | { readonly ok: false }

export async function prepareOneShotAssets(
  post: NaverPostForCopy,
  options?: { signal?: AbortSignal; fetcher?: typeof fetch }
): Promise<OneShotAssets> {
  options?.signal?.throwIfAborted?.()
  const photos = listPostPhotos(post)
  const fetcher = options?.fetcher ?? fetch
  const fetchLimit = createLimiter(5)

  const tasks = photos.map(async (photo): Promise<PreparedPhotoResult> => {
    options?.signal?.throwIfAborted?.()

    const match = photo.src.match(mediaPathRegex)
    if (!match || match[1] !== photo.id) {
      return { ok: false }
    }

    let rawBlob: Blob | null = null

    try {
      rawBlob = await fetchLimit(async () => {
        options?.signal?.throwIfAborted?.()
        const response = await fetcher(photo.src, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: options?.signal ?? AbortSignal.timeout(15000),
          redirect: 'follow',
        })

        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
        const contentLength = Number(response.headers.get('content-length') ?? 0)

        if (
          !response.ok ||
          !contentType ||
          !allowedMimeTypes.has(contentType) ||
          contentLength > maxIndividualPhotoBytes
        ) {
          return null
        }

        const blob = await response.blob()
        if (!blob.size || blob.size > maxIndividualPhotoBytes) {
          return null
        }
        return blob
      })
    } catch (err) {
      if (options?.signal?.aborted) {
        throw err
      }
      return { ok: false }
    }

    if (!rawBlob) {
      return { ok: false }
    }

    // fetch 완료 후 fetchLimit 슬롯은 반환되어 다음 사진 fetch가 즉시 진행됨.
    // 아래 압축은 파이프라인으로 병렬 실행됨.
    try {
      options?.signal?.throwIfAborted?.()
      let compressedBlob = await compressImageToJpeg(rawBlob, 1600, 0.82)
      if (compressedBlob.size > maxIndividualPhotoBytes) {
        // 한 장 20MB 상한 점검: 초과 시 품질 낮춰 재압축 시도
        compressedBlob = await compressImageToJpeg(rawBlob, 1280, 0.6)
      }

      if (compressedBlob.size > maxIndividualPhotoBytes) {
        return { ok: false }
      }

      const arrayBuffer = await blobToArrayBuffer(compressedBlob)
      const file = new File([arrayBuffer], photo.name, { type: 'image/jpeg' })
      return { ok: true, file, size: compressedBlob.size }
    } catch (err) {
      if (options?.signal?.aborted) {
        throw err
      }
      return { ok: false }
    }
  })

  const results = await Promise.all(tasks)

  const files: File[] = []
  let skippedPhotos = 0
  let totalBytes = 0

  for (const result of results) {
    if (!result.ok) {
      skippedPhotos++
      continue
    }

    if (totalBytes + result.size > maxTotalCompressedBytes) {
      skippedPhotos++
      continue
    }

    totalBytes += result.size
    files.push(result.file)
  }

  return {
    photoCount: files.length,
    files,
    skippedPhotos,
  }
}

const preparedAssetsCache = new Map<string, Promise<OneShotAssets>>()

export function clearPreparedAssetsCache(): void {
  preparedAssetsCache.clear()
}

export function evictPreparedAsset(key: string): void {
  preparedAssetsCache.delete(key)
}

export function getOrStartPreparedAssets(
  key: string,
  post: NaverPostForCopy,
  options?: { signal?: AbortSignal; fetcher?: typeof fetch }
): Promise<OneShotAssets> {
  const existing = preparedAssetsCache.get(key)
  if (existing) {
    return existing
  }

  const promise = prepareOneShotAssets(post, options).catch((err) => {
    preparedAssetsCache.delete(key)
    throw err
  })

  preparedAssetsCache.set(key, promise)
  return promise
}

function isPermissionDeniedError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const error = err as { name?: string; message?: string }
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return true
    if (typeof error.message === 'string' && /permission denied|not allowed/i.test(error.message)) {
      return true
    }
  }
  return false
}

export async function copyPreparedPost(
  assets: OneShotAssets,
  post: NaverPostForCopy
): Promise<OneShotCopyOutcome> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== 'function'
  ) {
    return { status: 'unavailable', photos: 0 }
  }

  const plain = buildGalleryPlainText(post)

  try {
    await navigator.clipboard.writeText(plain)
    return { status: 'ok', photos: assets.files.length }
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      return { status: 'denied', photos: 0 }
    }
    return { status: 'failed', photos: 0 }
  }
}

export async function sharePreparedPhotos(assets: OneShotAssets): Promise<SharePhotosOutcome> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unsupported'
  }

  if (!assets.files.length) {
    return 'unsupported'
  }

  if (typeof navigator.canShare === 'function') {
    try {
      if (!navigator.canShare({ files: assets.files as File[] })) {
        return 'unsupported'
      }
    } catch {
      return 'unsupported'
    }
  }

  try {
    await navigator.share({ files: assets.files as File[] })
    return 'shared'
  } catch (error) {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; message?: string }
      if (err.name === 'AbortError' || (typeof err.message === 'string' && /abort/i.test(err.message))) {
        return 'cancelled'
      }
    }
    return 'failed'
  }
}

export function downloadPreparedPhotosFallbackNames(assets: OneShotAssets): readonly string[] {
  return assets.files.map((file) => file.name)
}
