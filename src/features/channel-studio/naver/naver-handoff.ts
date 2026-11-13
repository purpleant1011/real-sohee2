import { buildNaverPlainTextContent, type NaverPostForCopy } from './copy-naver-post'
import { blobToArrayBuffer, compressImageToJpeg } from './one-shot-handoff'

const encoder = new TextEncoder()
const MAX_PHOTO_BYTES = 15 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 60 * 1024 * 1024
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}

type ArchiveFile = Readonly<{ name: string; bytes: Uint8Array }>
type SourceVersion = Readonly<{ workspaceId: string; contentId: string; versionId: string; fingerprint: string }>
type NaverHandoffPost = NaverPostForCopy & { sourceVersion?: SourceVersion }

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ZIP STORE: no compression dependency; local headers, central directory and EOCD.
function zip(files: readonly ArchiveFile[]): Uint8Array<ArrayBuffer> {
  const names = files.map((file) => encoder.encode(file.name))
  const localSize = files.reduce((size, file, i) => size + 30 + names[i].length + file.bytes.length, 0)
  const directorySize = names.reduce((size, name) => size + 46 + name.length, 0)
  const bytes = new Uint8Array(localSize + directorySize + 22)
  const view = new DataView(bytes.buffer)
  let offset = 0
  let directory = localSize
  files.forEach((file, i) => {
    const name = names[i]
    const crc = crc32(file.bytes)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true)
    view.setUint16(offset + 12, 0x0021, true) // 1980-01-01
    view.setUint32(offset + 14, crc, true)
    view.setUint32(offset + 18, file.bytes.length, true)
    view.setUint32(offset + 22, file.bytes.length, true)
    view.setUint16(offset + 26, name.length, true)
    bytes.set(name, offset + 30)
    bytes.set(file.bytes, offset + 30 + name.length)

    view.setUint32(directory, 0x02014b50, true)
    view.setUint16(directory + 4, 20, true)
    view.setUint16(directory + 6, 20, true)
    view.setUint16(directory + 8, 0x0800, true)
    view.setUint16(directory + 14, 0x0021, true)
    view.setUint32(directory + 16, crc, true)
    view.setUint32(directory + 20, file.bytes.length, true)
    view.setUint32(directory + 24, file.bytes.length, true)
    view.setUint16(directory + 28, name.length, true)
    view.setUint32(directory + 42, offset, true)
    bytes.set(name, directory + 46)
    directory += 46 + name.length
    offset += 30 + name.length + file.bytes.length
  })
  view.setUint32(directory, 0x06054b50, true)
  view.setUint16(directory + 8, files.length, true)
  view.setUint16(directory + 10, files.length, true)
  view.setUint32(directory + 12, directorySize, true)
  view.setUint32(directory + 16, localSize, true)
  return bytes
}

async function readPhoto(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_PHOTO_BYTES) {
    throw new Error('사진을 내려받지 못했어요. 다시 시도해 주세요.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_PHOTO_BYTES) throw new Error('사진 파일이 너무 커요. 크기를 줄인 뒤 다시 시도해 주세요.')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  if (!size) throw new Error('사진 파일이 비어 있어요. 다시 불러와 주세요.')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

function precedingBlock(block: NonNullable<NaverPostForCopy['editorBlocks']>[number], index: number): string {
  const label = 'text' in block ? block.text : block.kind === 'link' ? block.title : block.kind === 'map' ? block.placeName : ''
  const characters = Array.from(label.replace(/\s+/gu, ' ').trim())
  const excerpt = characters.slice(0, 100).join('') + (characters.length > 100 ? '…' : '')
  return excerpt ? `${index + 1}번 원고 구간 “${excerpt}”` : `${index + 1}번 사진 블록`
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

export async function buildNaverHandoffArchive(
  workspaceId: string,
  post: NaverHandoffPost,
  fetcher: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const identity = post.sourceVersion
  if (!identity || identity.workspaceId !== workspaceId || !workspaceId.trim() ||
    !identity.contentId?.trim() || !identity.versionId?.trim() || !/^[a-f0-9]{64}$/i.test(identity.fingerprint)) {
    throw new Error('원고 버전을 확인하지 못했어요. 다시 불러온 뒤 내려받아 주세요.')
  }
  const sourceVersion: SourceVersion = {
    workspaceId, contentId: identity.contentId, versionId: identity.versionId, fingerprint: identity.fingerprint,
  }
  const availableMedia = (post.media ?? []).map(photo => ({ ...photo }))
  const imageBlocks = post.editorBlocks?.filter((block) => block.kind === 'image') ?? []
  const imagePositions = post.editorBlocks?.flatMap((block, index) => block.kind === 'image' ? [index] : []) ?? []
  const media = imageBlocks.length ? imageBlocks.map((block) => {
    const photo = availableMedia.find((item) => item.id === block.mediaId)
    if (!photo) throw new Error('원고에 사용된 사진을 찾지 못했어요. 다시 불러와 주세요.')
    return photo
  }) : availableMedia
  if (media.length > 20) throw new Error('사진은 한 번에 20장까지 내려받을 수 있어요.')
  const files: ArchiveFile[] = [
    ...(['title', 'body', 'tags'] as const).map((part) => ({ name: `${part}.txt`, bytes: encoder.encode(buildNaverPlainTextContent(post, part)) })),
    { name: 'README.txt', bytes: encoder.encode('이 파일 다운로드는 게시 완료가 아니에요.\n제목·본문·태그를 붙여넣고 images 폴더의 사진을 직접 업로드해 주세요.\n사진 파일명은 미리보기 순서예요. placement_guide.txt에서 저장된 사진 위치를 확인해 주세요. 위치 미확인 사진·서식·공개 범위는 네이버에서 직접 확인해 주세요.\n') },
  ]
  const guide = ['네이버 원고 사진 배치 가이드', `원고: ${post.title}`,
    '같은 패키지의 원고·사진 순서예요. 정확한 원본 버전과 파일 무결성은 manifest.json에서 확인할 수 있어요.',
    '다운로드만으로 게시하거나 사진을 업로드한 것은 아니에요.', '']
  if (media.length === 0) guide.push('포함된 사진 파일이 없어요.')

  const limit = createLimiter(4)
  const photoTasks = media.map((photo, index) => limit(async () => {
    // Preview URLs may be external; only the tenant-scoped authenticated media API is used.
    const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/media/${encodeURIComponent(photo.id)}`, {
      credentials: 'same-origin', redirect: 'follow', signal: AbortSignal.timeout(30_000),
    })
    const mimeType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    const extension = IMAGE_EXTENSIONS[mimeType]
    if (!extension) {
      await response.body?.cancel()
      throw new Error('사진 형식을 확인하지 못했어요. 다시 불러와 주세요.')
    }
    const bytes = await readPhoto(response)

    let finalBytes = bytes
    let filename = `images/${String(index + 1).padStart(2, '0')}.${extension}`

    try {
      const rawBlob = new Blob([bytes], { type: mimeType })
      const compressedBlob = await compressImageToJpeg(rawBlob, 1600, 0.82)
      if (compressedBlob !== rawBlob && compressedBlob.type === 'image/jpeg') {
        const arrayBuffer = await blobToArrayBuffer(compressedBlob)
        finalBytes = new Uint8Array(arrayBuffer)
        filename = `images/${String(index + 1).padStart(2, '0')}.jpg`
      }
    } catch {
      // 압축 미지원 환경 또는 실패 시 원본 그대로 유지
    }

    if (finalBytes.length > MAX_PHOTO_BYTES) {
      throw new Error('사진 파일이 너무 커요. 크기를 줄인 뒤 다시 시도해 주세요.')
    }

    return { index, filename, bytes: finalBytes }
  }))

  const processedMedia = await Promise.all(photoTasks)

  let total = files.reduce((size, file) => size + file.bytes.length, 0)
  for (const item of processedMedia) {
    total += item.bytes.length
    if (total > MAX_ARCHIVE_BYTES) throw new Error('사진 전체 용량이 너무 커요. 크기를 줄인 뒤 다시 시도해 주세요.')
    files.push({ name: item.filename, bytes: item.bytes })
    guide.push(`${item.index + 1}. ${item.filename}`)
    const position = imagePositions[item.index]
    const block = position === undefined ? undefined : post.editorBlocks?.[position]
    if (position !== undefined && block?.kind === 'image') {
      guide.push(`대체 텍스트: ${block.altText}`)
      const previous = position > 0 ? post.editorBlocks?.[position - 1] : undefined
      guide.push(`삽입 위치: ${previous ? `${precedingBlock(previous, position - 1)} 뒤` : '본문 시작'}`)
    } else {
      guide.push('삽입 위치 미확인: 저장된 사진 배치 정보가 없어 네이버 편집기에서 직접 확인해야 해요.')
    }
    guide.push('')
  }
  const guideBytes = encoder.encode(guide.join('\n'))
  total += guideBytes.length
  files.push({ name: 'placement_guide.txt', bytes: guideBytes })
  if (total > MAX_ARCHIVE_BYTES) throw new Error('원고 파일이 너무 커요.')
  const manifestFiles = await Promise.all(files.map(async file => ({
    path: file.name, bytes: file.bytes.length, sha256: await sha256(file.bytes),
  })))
  // 원본 버전 식별자와 다운로드 바이트의 무결성 기록이며 게시·외부 검증 증거가 아니다.
  const bundleFingerprint = await sha256(encoder.encode(JSON.stringify({ sourceVersion, files: manifestFiles })))
  files.push({ name: 'manifest.json', bytes: encoder.encode(JSON.stringify({
    schemaVersion: 1, sourceVersion, files: manifestFiles, bundleFingerprint,
  }, null, 2)) })
  return zip(files)
}

export async function downloadNaverHandoff(workspaceId: string, post: NaverHandoffPost): Promise<void> {
  const bytes = await buildNaverHandoffArchive(workspaceId, post)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'naver-manuscript.zip'
  document.body.append(link)
  try { link.click() } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
