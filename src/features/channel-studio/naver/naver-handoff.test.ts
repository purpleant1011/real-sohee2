import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildNaverHandoffArchive } from './naver-handoff'
import * as oneShotModule from './one-shot-handoff'

const sourceVersion = { workspaceId: 'workspace', contentId: 'content-1', versionId: 'version-3', fingerprint: 'a'.repeat(64) }
const post = { sourceVersion, title: '방문 안내', introduction: '도입', sections: [{ heading: '안내', body: '정확한 본문' }], keywords: ['방문'], cta: '문의' }

function entries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const result = new Map<string, Uint8Array>()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const start = offset + 30 + nameLength
    const name = new TextDecoder().decode(bytes.slice(offset + 30, start))
    result.set(name, bytes.slice(start, start + size))
    offset = start + size
  }
  expect(view.getUint32(offset, true)).toBe(0x02014b50)
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
  return result
}

describe('buildNaverHandoffArchive', () => {
  it('binds the source version and exact file bytes in one deterministic manifest', async () => {
    const files = entries(await buildNaverHandoffArchive('workspace', post))
    expect(files.has('manifest.json')).toBe(true)
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    expect(manifest.sourceVersion).toEqual(sourceVersion)
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(['title.txt', 'body.txt', 'tags.txt', 'README.txt', 'placement_guide.txt'])
    for (const file of manifest.files) {
      const bytes = files.get(file.path)!
      expect(file.bytes).toBe(bytes.length)
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
    expect(manifest.bundleFingerprint).toBe(createHash('sha256').update(JSON.stringify({ sourceVersion, files: manifest.files })).digest('hex'))
    const again = await buildNaverHandoffArchive('workspace', post)
    expect(again).toEqual(await buildNaverHandoffArchive('workspace', post))
    const changed = entries(await buildNaverHandoffArchive('workspace', { ...post, title: '수정한 원고' }))
    expect(JSON.parse(new TextDecoder().decode(changed.get('manifest.json'))).bundleFingerprint).not.toBe(manifest.bundleFingerprint)
  })

  it.each([
    undefined,
    { ...sourceVersion, workspaceId: 'other-workspace' },
    { ...sourceVersion, versionId: '' },
    { ...sourceVersion, fingerprint: 'invalid' },
  ])('refuses missing or mismatched version identity before downloading photos: %j', async sourceVersion => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }))
    await expect(buildNaverHandoffArchive('workspace', { ...post, sourceVersion, media: [{ id: 'photo', src: '/photo' }] }, fetcher)).rejects.toThrow('버전')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('packages actual image bytes and exact manuscript fields, not URL placeholders', async () => {
    const photo = new Uint8Array([255, 216, 255, 217])
    const fetcher = vi.fn(async () => new Response(photo, { headers: { 'Content-Type': 'image/jpeg' } }))
    const bytes = await buildNaverHandoffArchive('workspace', { ...post, media: [{ id: 'photo', src: 'https://untrusted.example/photo' }] }, fetcher)
    const files = entries(bytes)
    expect(new TextDecoder().decode(files.get('title.txt'))).toBe('방문 안내')
    expect(new TextDecoder().decode(files.get('body.txt'))).toContain('정확한 본문')
    expect(new TextDecoder().decode(files.get('tags.txt'))).toBe('#방문')
    expect(files.get('images/01.jpg')).toEqual(photo)
    expect(fetcher).toHaveBeenCalledWith('/api/workspaces/workspace/media/photo', expect.objectContaining({ credentials: 'same-origin', redirect: 'follow' }))
    expect(new TextDecoder().decode(files.get('README.txt'))).toContain('게시 완료가 아니에요')
  })

  it('fails closed when final editor blocks reference a missing photo', async () => {
    await expect(buildNaverHandoffArchive('workspace', {
      ...post, media: [], editorBlocks: [{ kind: 'image', mediaId: 'missing', altText: '매장 사진' }],
    }, vi.fn())).rejects.toThrow('사진')
  })

  it('numbers photos in final editor order rather than repository order', async () => {
    const fetcher = vi.fn(async (url) => new Response(new TextEncoder().encode(String(url)), { headers: { 'Content-Type': 'image/png' } }))
    const bytes = await buildNaverHandoffArchive('workspace', {
      ...post, media: [{ id: 'first', src: '/first' }, { id: 'second', src: '/second' }],
      editorBlocks: [{ kind: 'image', mediaId: 'second', altText: '앞 사진' }, { kind: 'image', mediaId: 'first', altText: '뒤 사진' }],
    }, fetcher)
    const files = entries(bytes)
    expect(new TextDecoder().decode(files.get('images/01.png'))).toContain('/second')
    expect(new TextDecoder().decode(files.get('images/02.png'))).toContain('/first')
  })

  it('binds actual filenames and canonical insertion locations in the placement guide', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/png' } }))
    const files = entries(await buildNaverHandoffArchive('workspace', {
      ...post, media: [{ id: 'first', src: '/first' }, { id: 'second', src: '/second' }],
      editorBlocks: [
        { kind: 'image', mediaId: 'second', altText: '표지 설명' },
        { kind: 'paragraph', text: '실제로 저장된 안내 문단' },
        { kind: 'image', mediaId: 'first', altText: '본문 설명' },
      ],
    }, fetcher))
    const guide = new TextDecoder().decode(files.get('placement_guide.txt'))
    expect(guide).toContain('images/01.png')
    expect(guide).toContain('images/02.png')
    expect(guide).toContain('본문 시작')
    expect(guide).toContain('실제로 저장된 안내 문단')
    expect(guide).toContain('표지 설명')
    expect(guide).toContain('본문 설명')
    expect(guide.indexOf('images/01.png')).toBeLessThan(guide.indexOf('images/02.png'))
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
    const item = manifest.files.find((file: { path: string }) => file.path === 'placement_guide.txt')
    expect(item.sha256).toBe(createHash('sha256').update(files.get('placement_guide.txt')!).digest('hex'))
  })

  it('marks legacy photo locations unconfirmed instead of inventing paragraph placement', async () => {
    const files = entries(await buildNaverHandoffArchive('workspace', {
      ...post, media: [{ id: 'photo', src: 'https://untrusted.example/photo' }],
    }, async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/jpeg' } })))
    const guide = new TextDecoder().decode(files.get('placement_guide.txt'))
    expect(guide).toContain('images/01.jpg')
    expect(guide).toContain('삽입 위치 미확인')
    expect(guide).not.toContain('untrusted.example')
  })

  it('fails the entire handoff when any photo cannot be downloaded', async () => {
    await expect(buildNaverHandoffArchive('workspace', { ...post, media: [{ id: 'photo', src: '/photo' }] }, async () => new Response('denied', { status: 403 })))
      .rejects.toThrow('사진')
  })

  it('rejects HTML responses rather than packaging an error page as an image', async () => {
    await expect(buildNaverHandoffArchive('workspace', { ...post, media: [{ id: 'photo', src: '/photo' }] }, async () => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } })))
      .rejects.toThrow('사진')
  })

  it('rejects oversized responses before reading their body', async () => {
    await expect(buildNaverHandoffArchive('workspace', { ...post, media: [{ id: 'photo', src: '/photo' }] }, async () => new Response(null, { headers: { 'Content-Type': 'image/png', 'Content-Length': '999999999' } })))
      .rejects.toThrow('사진')
  })

  it('압축 지원 환경에서 각 사진을 긴 변 1600px quality 0.82 JPEG로 압축해 images/NN.jpg로 담고 manifest와 guide를 일치시킨다', async () => {
    const fakeJpegBytes = new Uint8Array([255, 216, 255, 217, 1, 2, 3])
    const compressSpy = vi.spyOn(oneShotModule, 'compressImageToJpeg').mockImplementation(async () => {
      return new Blob([fakeJpegBytes], { type: 'image/jpeg' })
    })

    try {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2])
      const fetcher = vi.fn(async () => new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } }))

      const archiveBytes = await buildNaverHandoffArchive('workspace', {
        ...post,
        media: [
          { id: 'photo1', src: '/photo1' },
          { id: 'photo2', src: '/photo2' },
        ],
      }, fetcher)

      expect(compressSpy).toHaveBeenCalledTimes(2)
      expect(compressSpy).toHaveBeenCalledWith(expect.any(Blob), 1600, 0.82)

      const files = entries(archiveBytes)
      expect(files.get('images/01.jpg')).toEqual(fakeJpegBytes)
      expect(files.get('images/02.jpg')).toEqual(fakeJpegBytes)
      expect(files.has('images/01.png')).toBe(false)
      expect(files.has('images/02.png')).toBe(false)

      const guide = new TextDecoder().decode(files.get('placement_guide.txt'))
      expect(guide).toContain('images/01.jpg')
      expect(guide).toContain('images/02.jpg')
      expect(guide).not.toContain('.png')

      const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
      const filePaths = manifest.files.map((f: { path: string }) => f.path)
      expect(filePaths).toContain('images/01.jpg')
      expect(filePaths).toContain('images/02.jpg')
      expect(filePaths).not.toContain('images/01.png')
    } finally {
      compressSpy.mockRestore()
    }
  })

  it('압축 실패 또는 미지원 환경에서는 원본 바이트 그대로와 원래 확장자로 폴백한다', async () => {
    const compressSpy = vi.spyOn(oneShotModule, 'compressImageToJpeg').mockRejectedValue(new Error('Canvas unsupported'))

    try {
      const pngBytes = new Uint8Array([137, 80, 78, 71, 99])
      const fetcher = vi.fn(async () => new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } }))

      const archiveBytes = await buildNaverHandoffArchive('workspace', {
        ...post,
        media: [{ id: 'photo1', src: '/photo1' }],
      }, fetcher)

      const files = entries(archiveBytes)
      expect(files.get('images/01.png')).toEqual(pngBytes)
      expect(files.has('images/01.jpg')).toBe(false)

      const guide = new TextDecoder().decode(files.get('placement_guide.txt'))
      expect(guide).toContain('images/01.png')

      const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')))
      const filePaths = manifest.files.map((f: { path: string }) => f.path)
      expect(filePaths).toContain('images/01.png')
    } finally {
      compressSpy.mockRestore()
    }
  })

  it('사진 다운로드 및 압축을 동시 최대 4개로 제한하여 병렬 실행한다', async () => {
    let activeWorkers = 0
    let maxActiveWorkers = 0

    const fetcher = vi.fn(async () => {
      activeWorkers++
      if (activeWorkers > maxActiveWorkers) {
        maxActiveWorkers = activeWorkers
      }
      await new Promise((r) => setTimeout(r, 20))
      activeWorkers--
      return new Response(new Uint8Array([255, 216, 255, 217]), {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    })

    const mediaList = Array.from({ length: 8 }, (_, i) => ({
      id: `p-${i + 1}`,
      src: `/p-${i + 1}`,
    }))

    const archiveBytes = await buildNaverHandoffArchive('workspace', {
      ...post,
      media: mediaList,
    }, fetcher)

    expect(maxActiveWorkers).toBe(4)
    const files = entries(archiveBytes)
    expect(files.has('images/01.jpg')).toBe(true)
    expect(files.has('images/08.jpg')).toBe(true)
  })
})
