import type { ChannelContent } from './channel-content-schema'

export type NaverBlogContent = Extract<ChannelContent, { channel: 'naver_blog' }>
export type NaverEditorBlock = Readonly<{
  kind: 'title' | 'heading' | 'paragraph' | 'quote' | 'image_slot' | 'link' | 'cta' | 'map'
  text?: string
  mediaId?: string
  placement?: string
  altText?: string
  url?: string
}>

export function createNaverEditorPlan(content: NaverBlogContent): Readonly<{ blocks: readonly NaverEditorBlock[] }> {
  if (content.editorBlocks) {
    const placements = new Map(content.imagePlacements.map((image) => [image.mediaId, image]))
    const blocks: NaverEditorBlock[] = [
      { kind: 'title', text: content.title },
      ...content.editorBlocks.map((block): NaverEditorBlock => {
        if (block.kind === 'image') {
          const placement = placements.get(block.mediaId)
          return {
            kind: 'image_slot', mediaId: block.mediaId, altText: block.altText,
            ...(placement ? { placement: placement.placement } : {}),
          }
        }
        if (block.kind === 'link') return { kind: 'link', text: block.title, url: block.url }
        if (block.kind === 'map') return { kind: 'map', text: block.placeName }
        return { kind: block.kind, text: block.text }
      }),
    ]
    return Object.freeze({ blocks: Object.freeze(blocks.map((block) => Object.freeze(block))) })
  }
  const blocks: NaverEditorBlock[] = [
    { kind: 'title', text: content.title }, { kind: 'paragraph', text: content.introduction },
    ...content.sections.flatMap((section) => [{ kind: 'heading' as const, text: section.heading }, { kind: 'paragraph' as const, text: section.body }]),
    ...content.imagePlacements.map((image) => ({ kind: 'image_slot' as const, mediaId: image.mediaId, placement: image.placement, altText: image.altText })),
    { kind: 'cta', text: content.cta },
  ]
  return Object.freeze({ blocks: Object.freeze(blocks.map((block) => Object.freeze(block))) })
}

export function decideNaverCategory(categories: readonly Readonly<{ id: string; name: string }>[]) {
  if (categories.length === 0) return Object.freeze({ status: 'unavailable' as const, selected: null })
  if (categories.length === 1) return Object.freeze({ status: 'selected' as const, selected: categories[0] })
  return Object.freeze({ status: 'selection_required' as const, selected: null })
}
