import { describe, expect, it } from 'vitest'
import { createNaverEditorPlan, decideNaverCategory } from './naver-editor-plan'

const content = {
  channel: 'naver_blog' as const, title: '여름 관리 안내', introduction: '확인된 관리 기준을 소개합니다.',
  sections: [{ heading: '먼저 확인할 점', body: '피부 상태와 일정을 확인해 주세요.' }], keywords: ['여름관리'],
  imagePlacements: [{ mediaId: '10000000-0000-4000-8000-000000000001', placement: 'cover' as const, altText: '관리 안내 표지' }], cta: '상담이 필요하면 문의해 주세요.',
}
describe('Naver editor neutral plan', () => {
  it('creates title heading paragraph image slot and CTA blocks while preserving image placement', () => {
    const plan = createNaverEditorPlan(content)
    expect(plan.blocks.map((block) => block.kind)).toEqual(['title', 'paragraph', 'heading', 'paragraph', 'image_slot', 'cta'])
    expect(plan.blocks.find((block) => block.kind === 'image_slot')).toMatchObject({ mediaId: content.imagePlacements[0].mediaId, placement: 'cover' })
  })
  it.each([[[], 'unavailable'], [[{ id: '1', name: '안내' }], 'selected'], [[{ id: '1', name: '안내' }, { id: '2', name: '후기' }], 'selection_required']] as const)('does not guess category for %o', (categories, status) => {
    expect(decideNaverCategory(categories).status).toBe(status)
  })

  it('uses the approved rich block order instead of appending images after every section', () => {
    const rich = {
      ...content,
      editorBlocks: [
        { kind: 'paragraph' as const, text: '도입' },
        { kind: 'image' as const, mediaId: content.imagePlacements[0].mediaId, altText: '표지' },
        { kind: 'quote' as const, text: '중요한 기준' },
        { kind: 'link' as const, url: 'https://example.com/guide', title: '안내 보기' },
        { kind: 'cta' as const, text: '문의' },
      ],
    }
    const plan = createNaverEditorPlan(rich)
    expect(plan.blocks.map((block) => block.kind)).toEqual(['title', 'paragraph', 'image_slot', 'quote', 'link', 'cta'])
    expect(plan.blocks[4]).toMatchObject({ url: 'https://example.com/guide', text: '안내 보기' })
  })
})
