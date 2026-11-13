import { createHash } from 'node:crypto'
import type { NaverCategory, NaverEditorBlock, NaverPackageBlock, NaverPublishPackage, NaverVisibility } from './types'
import { NAVER_VISIBILITIES } from './types'

export interface NaverPublishSource {
  blogId: string
  title: string
  blocks: readonly NaverEditorBlock[]
  tags: readonly string[]
  category: NaverCategory
  visibility: NaverVisibility
}

export class NaverPackageError extends Error {
  constructor(readonly code: 'invalid_blog_id' | 'invalid_title' | 'empty_blocks' | 'missing_media' | 'invalid_url' | 'invalid_category' | 'invalid_visibility' | 'too_many_tags', message: string) {
    super(message)
    this.name = 'NaverPackageError'
  }
}

const BLOG_ID_PATTERN = /^[A-Za-z0-9_-]{2,30}$/
const MAX_TAGS = 30

function normalizeTags(tags: readonly string[]): string[] {
  const unique: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#+/, '').trim()
    if (tag && !unique.includes(tag)) unique.push(tag)
  }
  if (unique.length > MAX_TAGS) throw new NaverPackageError('too_many_tags', `태그는 최대 ${MAX_TAGS}개까지 쓸 수 있어요.`)
  return unique
}

function requireHttps(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new NaverPackageError('invalid_url', '올바른 주소가 아니에요.')
  }
  if (url.protocol !== 'https:') throw new NaverPackageError('invalid_url', 'https 주소만 쓸 수 있어요.')
  return url.toString()
}

export function buildNaverPublishPackage(source: NaverPublishSource, mediaUrls: Readonly<Record<string, string>>): NaverPublishPackage {
  if (!BLOG_ID_PATTERN.test(source.blogId)) throw new NaverPackageError('invalid_blog_id', '블로그 아이디를 확인해 주세요.')
  const title = source.title.trim()
  if (!title || title.length > 200) throw new NaverPackageError('invalid_title', '제목은 1~200자로 써 주세요.')
  if (source.blocks.length === 0) throw new NaverPackageError('empty_blocks', '본문이 비어 있어요.')
  if (!source.category.id.trim() || !source.category.name.trim()) throw new NaverPackageError('invalid_category', '카테고리를 선택해 주세요.')
  if (!NAVER_VISIBILITIES.includes(source.visibility)) throw new NaverPackageError('invalid_visibility', '공개 범위를 선택해 주세요.')

  const blocks: NaverPackageBlock[] = source.blocks.map((block): NaverPackageBlock => {
    if (block.kind === 'image') {
      const url = mediaUrls[block.mediaId]
      if (!url) throw new NaverPackageError('missing_media', '이미지 파일을 찾을 수 없어요.')
      return { kind: 'image', mediaId: block.mediaId, url: requireHttps(url), altText: block.altText }
    }
    if (block.kind === 'link') return { kind: 'link', url: requireHttps(block.url), title: block.title }
    return { kind: block.kind, text: block.text }
  })

  const body: PackageBody = {
    version: 1,
    blogId: source.blogId,
    title,
    blocks,
    tags: normalizeTags(source.tags),
    category: { id: source.category.id, name: source.category.name, parentId: source.category.parentId },
    visibility: source.visibility,
  }
  return { ...body, digest: digestOf(body) }
}

type PackageBody = Omit<NaverPublishPackage, 'digest'>

/** Fixed key order, so the same approved values always hash to the same digest. */
function digestOf(body: PackageBody): string {
  const canonical = {
    version: body.version,
    blogId: body.blogId,
    title: body.title,
    blocks: body.blocks,
    tags: body.tags,
    category: { id: body.category.id, name: body.category.name, parentId: body.category.parentId },
    visibility: body.visibility,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export function recomputeDigest(pkg: NaverPublishPackage): string {
  return digestOf(pkg)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Paste-ready HTML for SmartEditor ONE. Every text and URL is escaped; the package already guarantees https URLs. */
export function renderBlocksToHtml(blocks: readonly NaverPackageBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
          return `<h2>${escapeHtml(block.text)}</h2>`
        case 'paragraph':
          return `<p>${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`
        case 'quote':
          return `<blockquote>${escapeHtml(block.text)}</blockquote>`
        case 'cta':
          return `<p><b>${escapeHtml(block.text)}</b></p>`
        case 'image':
          return `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.altText)}">`
        case 'link':
          return `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.title)}</a></p>`
      }
    })
    .join('')
}
