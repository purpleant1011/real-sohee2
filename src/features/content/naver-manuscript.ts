import type { ApprovalPreviewSnapshot } from './types'

export type NaverManuscript = Readonly<{
  title: string
  introduction: string
  sections: readonly Readonly<{ heading: string; body: string }>[]
  keywords?: readonly string[]
  cta?: string
  editorBlocks?: ApprovalPreviewSnapshot['naverBlocks']
  disclosure?: string
}>

export type NaverManuscriptPart = 'all' | 'title' | 'body' | 'tags'

export function extractNaverTags(keywords?: readonly string[]): string[] {
  if (!keywords || keywords.length === 0) return []
  const tags: string[] = []
  const seen = new Set<string>()

  for (const raw of keywords) {
    if (!raw) continue
    const candidates = raw.split(/[^가-힣a-zA-Z0-9]+/u)
    for (const candidate of candidates) {
      if (candidate.length < 2 || candidate.length > 20) continue
      const lower = candidate.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)
      tags.push(candidate)
      if (tags.length === 10) return tags
    }
  }

  return tags
}

export function buildNaverManuscriptTags(post: NaverManuscript | { keywords?: readonly string[] }): string {
  const tags = extractNaverTags(post.keywords)
  return tags.length > 0 ? tags.map((keyword) => `#${keyword}`).join(' ') : ''
}

export function buildNaverManuscriptText(post: NaverManuscript, part: NaverManuscriptPart = 'all'): string {
  if (part === 'title') return post.title
  if (part === 'tags') return buildNaverManuscriptTags(post)
  const parts: string[] = []
  if (part === 'all') parts.push(post.title)
  if (post.editorBlocks?.length) {
    for (const block of post.editorBlocks) {
      if ('text' in block) parts.push(block.text)
      else if (block.kind === 'link') parts.push(`${block.title} (${block.url})`)
      else if (block.kind === 'map') parts.push(block.placeName)
    }
  } else {
    if (post.introduction) parts.push(post.introduction)
    for (const section of post.sections) {
      if (section.heading) parts.push(`[${section.heading}]`)
      if (section.body) parts.push(section.body)
    }
    if (post.cta) parts.push(post.cta)
  }
  if (post.disclosure) parts.push(post.disclosure)
  if (part === 'all' && buildNaverManuscriptTags(post)) parts.push(buildNaverManuscriptTags(post))
  return parts.join('\n\n')
}
