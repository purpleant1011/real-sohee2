import { describe, expect, it, vi } from 'vitest'
import type { CorpusPost } from './types'
import { downloadProfileImage, pickRepresentativeImageUrls } from './image-download'

describe('image-download', () => {
  describe('downloadProfileImage', () => {
    it('허용된 호스트(cdninstagram.com)의 올바른 jpeg 이미지를 다운로드하여 File로 반환한다', async () => {
      const dummyBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response(dummyBytes, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(dummyBytes.byteLength),
          },
        }),
      )

      const file = await downloadProfileImage('https://scontent.cdninstagram.com/v/t51/photo.jpg', mockFetch as unknown as typeof fetch)

      expect(file).not.toBeNull()
      expect(file).toBeInstanceOf(File)
      expect(file?.type).toBe('image/jpeg')
      expect(file?.name).toMatch(/^profile-\d+\.jpg$/)
      expect(file?.size).toBe(dummyBytes.byteLength)
    })

    it('허용된 호스트(fbcdn.net, threads.net, threads.com)를 지원한다', async () => {
      const dummyBytes = new Uint8Array([1, 2, 3])
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(dummyBytes, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
      )

      const allowedUrls = [
        'https://scontent.xx.fbcdn.net/v/photo.png',
        'https://static.threads.net/images/p.png',
        'https://sub.threads.com/media/p.png',
      ]

      for (const url of allowedUrls) {
        const file = await downloadProfileImage(url, mockFetch as unknown as typeof fetch)
        expect(file).not.toBeNull()
        expect(file?.name).toMatch(/^profile-\d+\.png$/)
      }
    })

    it('http 프로토콜이거나 유효하지 않은 URL이면 null을 반환한다', async () => {
      const mockFetch = vi.fn()

      expect(await downloadProfileImage('http://cdninstagram.com/photo.jpg', mockFetch as unknown as typeof fetch)).toBeNull()
      expect(await downloadProfileImage('not-a-url', mockFetch as unknown as typeof fetch)).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('허용 목록에 없는 호스트, 유사 호스트, IP 주소, 사설망이면 null을 반환한다', async () => {
      const mockFetch = vi.fn()

      const blockedUrls = [
        'https://evil-cdninstagram.com/photo.jpg',
        'https://mycdninstagram.com/photo.jpg',
        'https://google.com/photo.jpg',
        'https://127.0.0.1/photo.jpg',
        'https://192.168.1.1/photo.jpg',
        'https://localhost/photo.jpg',
        'https://cdninstagram.com:8443/photo.jpg',
        'https://user:pass@cdninstagram.com/photo.jpg',
      ]

      for (const url of blockedUrls) {
        const result = await downloadProfileImage(url, mockFetch as unknown as typeof fetch)
        expect(result).toBeNull()
      }
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects redirects before following them to a potentially private host', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, {
        status: 302,
        headers: { location: 'https://127.0.0.1/private' },
      }))
      expect(await downloadProfileImage('https://cdninstagram.com/photo.jpg', mockFetch)).toBeNull()
      expect(mockFetch).toHaveBeenCalledWith('https://cdninstagram.com/photo.jpg', expect.objectContaining({ redirect: 'error' }))
    })

    it('리다이렉트 후의 URL 호스트가 허용되지 않으면 null을 반환한다', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        redirected: true,
        url: 'https://attacker.com/steal.jpg',
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })

      const file = await downloadProfileImage('https://cdninstagram.com/photo.jpg', mockFetch as unknown as typeof fetch)
      expect(file).toBeNull()
    })

    it('허용되지 않는 content-type(html, json, gif 등)이면 null을 반환한다', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce(
        new Response('<html>alert(1)</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      )

      const file = await downloadProfileImage('https://cdninstagram.com/page', mockFetch as unknown as typeof fetch)
      expect(file).toBeNull()
    })

    it('크기가 4MB를 초과하면(content-length 또는 실제 바이트) null을 반환한다', async () => {
      // 1. content-length 초과
      const mockFetch1 = vi.fn().mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
            'content-length': String(4 * 1024 * 1024 + 1),
          },
        }),
      )
      expect(await downloadProfileImage('https://cdninstagram.com/large.jpg', mockFetch1 as unknown as typeof fetch)).toBeNull()

      // 2. 실제 바이트 초과
      const oversizedBytes = new Uint8Array(4 * 1024 * 1024 + 10)
      const mockFetch2 = vi.fn().mockResolvedValueOnce(
        new Response(oversizedBytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      )
      expect(await downloadProfileImage('https://cdninstagram.com/large.jpg', mockFetch2 as unknown as typeof fetch)).toBeNull()
    })

    it('바이트 크기가 0이거나 네트워크 에러 발생 시 null을 반환한다', async () => {
      const emptyFetch = vi.fn().mockResolvedValueOnce(
        new Response(new Uint8Array(0), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      )
      expect(await downloadProfileImage('https://cdninstagram.com/empty.jpg', emptyFetch as unknown as typeof fetch)).toBeNull()

      const errorFetch = vi.fn().mockRejectedValueOnce(new Error('Fetch timeout'))
      expect(await downloadProfileImage('https://cdninstagram.com/err.jpg', errorFetch as unknown as typeof fetch)).toBeNull()
    })
  })

  describe('pickRepresentativeImageUrls', () => {
    function makePost(id: string, mediaType: CorpusPost['mediaType'], imageUrls: string[]): CorpusPost {
      return {
        id,
        caption: `Post ${id}`,
        permalink: null,
        timestamp: null,
        mediaType,
        imageUrls,
        likeCount: null,
        commentsCount: null,
      }
    }

    it('게시물에서 첫 번째 사진/썸네일을 추출하고 중복을 제거한다', () => {
      const posts: CorpusPost[] = [
        makePost('1', 'IMAGE', ['https://cdn.com/1.jpg']),
        makePost('2', 'CAROUSEL_ALBUM', ['https://cdn.com/2.jpg', 'https://cdn.com/extra.jpg']),
        makePost('3', 'VIDEO', ['https://cdn.com/3_thumb.jpg']),
        makePost('4', 'TEXT', []),
        makePost('5', 'IMAGE', ['https://cdn.com/1.jpg']), // 중복
      ]

      const picked = pickRepresentativeImageUrls(posts, 8)
      expect(picked).toEqual([
        'https://cdn.com/1.jpg',
        'https://cdn.com/2.jpg',
        'https://cdn.com/3_thumb.jpg',
      ])
    })

    it('사진 개수가 max 이하이면 순서를 유지하며 전부 반환한다', () => {
      const posts = [
        makePost('1', 'IMAGE', ['https://cdn.com/a.jpg']),
        makePost('2', 'IMAGE', ['https://cdn.com/b.jpg']),
      ]
      expect(pickRepresentativeImageUrls(posts, 4)).toEqual([
        'https://cdn.com/a.jpg',
        'https://cdn.com/b.jpg',
      ])
    })

    it('사진 개수가 max보다 많으면 균등 간격으로 max개를 선택한다', () => {
      // 10개의 고유 사진
      const posts = Array.from({ length: 10 }, (_, i) =>
        makePost(String(i), 'IMAGE', [`https://cdn.com/${i}.jpg`]),
      )

      const picked = pickRepresentativeImageUrls(posts, 4)
      expect(picked).toHaveLength(4)
      // 첫 번째와 마지막이 포함되고 순서가 유지되는 균등 간격
      expect(picked[0]).toBe('https://cdn.com/0.jpg')
      expect(picked[picked.length - 1]).toBe('https://cdn.com/9.jpg')
      // 인덱스 간격이 균일하게 증가해야 함
      const indices = picked.map((url) => Number(url.replace('https://cdn.com/', '').replace('.jpg', '')))
      expect(indices).toEqual([0, 3, 6, 9])
    })

    it('기본 max는 8이다', () => {
      const posts = Array.from({ length: 20 }, (_, i) =>
        makePost(String(i), 'IMAGE', [`https://cdn.com/${i}.jpg`]),
      )
      const picked = pickRepresentativeImageUrls(posts)
      expect(picked).toHaveLength(8)
    })
  })
})
