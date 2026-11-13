import type { ChannelContent } from './channel-content-schema'

export const naverReferenceQualityTarget = Object.freeze({
  minimumTextCharacters: 2_000,
  minimumImageCount: 7,
  minimumHighlightCount: 3,
  minimumLinkCount: 2,
})

type Metric = 'textCharacters' | 'imageCount' | 'highlightCount' | 'linkCount'
type QualityGap = Metric | 'editorBlocks'

export function assessNaverReferenceQuality(input: Readonly<{
  textCharacters: number
  imageCount: number
  highlightCount: number
  linkCount: number
}>): Readonly<{ ready: boolean; gaps: readonly Metric[] }> {
  const gaps: Metric[] = []
  if (input.textCharacters < naverReferenceQualityTarget.minimumTextCharacters) gaps.push('textCharacters')
  if (input.imageCount < naverReferenceQualityTarget.minimumImageCount) gaps.push('imageCount')
  if (input.highlightCount < naverReferenceQualityTarget.minimumHighlightCount) gaps.push('highlightCount')
  if (input.linkCount < naverReferenceQualityTarget.minimumLinkCount) gaps.push('linkCount')
  return Object.freeze({ ready: gaps.length === 0, gaps: Object.freeze(gaps) })
}

function uniqueWebLinks(values: readonly string[]): number {
  const links = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(/https?:\/\/[^\s<>]+/giu)) {
      const normalized = match[0].replace(/[),.!?]+$/u, '')
      try {
        const url = new URL(normalized)
        if (url.protocol === 'https:' || url.protocol === 'http:') links.add(url.toString())
      } catch {
        // Invalid URLs do not contribute to the publishing quality score.
      }
    }
  }
  return links.size
}

export function assessNaverContentQuality(
  content: Extract<ChannelContent, { channel: 'naver_blog' }>,
): Readonly<{
  ready: boolean
  gaps: readonly QualityGap[]
  metrics: Readonly<{ textCharacters: number; imageCount: number; highlightCount: number; linkCount: number }>
}> {
  const editorBlocks = content.editorBlocks
  const textParts = editorBlocks
    ? [content.title, ...editorBlocks.flatMap((block) => block.kind === 'link'
      ? [block.title]
      : 'text' in block ? [block.text] : [])]
    : [
      content.title,
      content.introduction,
      ...content.sections.flatMap((section) => [section.heading, section.body]),
      content.cta,
    ]
  const metrics = Object.freeze({
    textCharacters: textParts.join('\n\n').trim().length,
    imageCount: editorBlocks?.filter((block) => block.kind === 'image').length ?? content.imagePlacements.length,
    highlightCount: editorBlocks?.filter((block) => block.kind === 'quote').length
      ?? content.sections.filter((section) => section.heading.trim().length > 0).length,
    linkCount: editorBlocks
      ? new Set(editorBlocks.filter((block) => block.kind === 'link').map((block) => block.url)).size
      : uniqueWebLinks(textParts),
  })
  const assessed = assessNaverReferenceQuality(metrics)
  const gaps: QualityGap[] = [...assessed.gaps]
  if (!editorBlocks) gaps.push('editorBlocks')
  return Object.freeze({ ready: gaps.length === 0, gaps: Object.freeze(gaps), metrics })
}
