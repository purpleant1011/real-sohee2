import { describe, expect, it, vi } from 'vitest'
import { inlineClipboardImages } from './inline-clipboard-images'
import { buildNaverHtmlContent } from './copy-naver-post'
const mediaId = '20000000-0000-4000-8000-000000000001'
const src = `/api/workspaces/10000000-0000-4000-8000-000000000001/media/${mediaId}`
const post = { title: '제목', introduction: '도입', sections: [], editorBlocks: [{ kind: 'image' as const, mediaId, altText: '가게 사진' }], media: [{ id: mediaId, src }] }
describe('private images for manual Naver paste', () => {
  it('embeds authenticated images without publishing signed or private source URLs into copied HTML', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob(['image-bytes'], { type: 'image/png' }), { headers: { 'content-type': 'image/png' } }))
    const inline = await inlineClipboardImages(post, fetcher as typeof fetch)
    const html = buildNaverHtmlContent(inline, 'body')
    expect(html).toContain('data:image/png;base64,')
    expect(html).not.toContain('/api/workspaces/')
    expect(fetcher).toHaveBeenCalledWith(src, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
  })
  it('rejects arbitrary remote URLs, SVG and missing media instead of silently dropping photos', async () => {
    const fetcher = vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
    await expect(inlineClipboardImages({ ...post, media: [{ id: mediaId, src: 'https://other.example/private' }] }, fetcher as typeof fetch)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(inlineClipboardImages(post, fetcher as typeof fetch)).rejects.toThrow()
    await expect(inlineClipboardImages({ ...post, media: [] }, fetcher as typeof fetch)).rejects.toThrow()
  })
})
