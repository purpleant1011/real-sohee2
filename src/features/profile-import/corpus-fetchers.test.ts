import { describe, expect, it, vi } from 'vitest'
import { fetchInstagramCorpus, fetchThreadsOwnCorpus } from './corpus-fetchers'

describe('corpus-fetchers', () => {
  describe('fetchInstagramCorpus', () => {
    const validToken = 'EAABsbCS1234567890abcdef'
    const accountId = '17841400000000001'

    it('내 계정(ownHandle과 targetHandle 일치): 프로필과 미디어 목록을 조회하고 매핑한다', async () => {
      const mockFetcher = vi.fn()

      // 1. 프로필 정보 응답
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            username: 'my_account',
            name: '내 브랜드',
            biography: '소개글입니다',
            followers_count: 1234,
            media_count: 56,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      // 2. 미디어 목록 응답
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'media_1',
                caption: '첫 번째 사진 #일상',
                media_type: 'IMAGE',
                media_url: 'https://cdninstagram.com/p1.jpg',
                permalink: 'https://instagram.com/p/1',
                timestamp: '2026-11-01T10:00:00Z',
                like_count: 42,
                comments_count: 5,
              },
              {
                id: 'media_2',
                caption: '캐러셀 앨범',
                media_type: 'CAROUSEL_ALBUM',
                media_url: 'https://cdninstagram.com/carousel_cover.jpg',
                permalink: 'https://instagram.com/p/2',
                timestamp: '2026-11-02T10:00:00Z',
                like_count: 100,
                comments_count: 12,
                children: {
                  data: [
                    { media_type: 'IMAGE', media_url: 'https://cdninstagram.com/c1.jpg' },
                    { media_type: 'VIDEO', thumbnail_url: 'https://cdninstagram.com/c2_thumb.jpg' },
                    { media_type: 'IMAGE', media_url: 'https://cdninstagram.com/c3.jpg' },
                  ],
                },
              },
              {
                id: 'media_3',
                caption: '영상 릴스',
                media_type: 'VIDEO',
                thumbnail_url: 'https://cdninstagram.com/v_thumb.jpg',
                permalink: 'https://instagram.com/p/3',
                timestamp: '2026-11-03T10:00:00Z',
                like_count: null,
                comments_count: null,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchInstagramCorpus({
        accountId,
        accessToken: validToken,
        ownHandle: 'my_account',
        targetHandle: 'MY_ACCOUNT', // 대소문자 무시
        fetcher: mockFetcher,
        limit: 10,
      })

      expect(result.platform).toBe('instagram')
      expect(result.handle).toBe('my_account')
      expect(result.displayName).toBe('내 브랜드')
      expect(result.biography).toBe('소개글입니다')
      expect(result.followersCount).toBe(1234)
      expect(result.mediaCount).toBe(56)
      expect(result.isOwnAccount).toBe(true)
      expect(result.posts).toHaveLength(3)

      expect(result.posts[0]).toEqual({
        id: 'media_1',
        caption: '첫 번째 사진 #일상',
        mediaType: 'IMAGE',
        imageUrls: ['https://cdninstagram.com/p1.jpg'],
        permalink: 'https://instagram.com/p/1',
        timestamp: '2026-11-01T10:00:00Z',
        likeCount: 42,
        commentsCount: 5,
      })

      // 캐러셀은 children 중 IMAGE의 media_url과 VIDEO의 thumbnail_url을 순서대로 추출
      expect(result.posts[1]?.imageUrls).toEqual([
        'https://cdninstagram.com/c1.jpg',
        'https://cdninstagram.com/c2_thumb.jpg',
        'https://cdninstagram.com/c3.jpg',
      ])

      // VIDEO는 thumbnail_url 만 추출
      expect(result.posts[2]?.imageUrls).toEqual([
        'https://cdninstagram.com/v_thumb.jpg',
      ])

      // 헤더 및 URL 검증
      expect(mockFetcher).toHaveBeenCalledTimes(2)
      const firstCall = mockFetcher.mock.calls[0]!
      expect(firstCall[0]).toContain(`https://graph.instagram.com/v26.0/${accountId}?fields=`)
      expect(firstCall[1]?.headers).toEqual({ authorization: `Bearer ${validToken}` })
      expect(firstCall[1]?.cache).toBe('no-store')

      const secondCall = mockFetcher.mock.calls[1]!
      expect(secondCall[0]).toContain(`https://graph.instagram.com/v26.0/${accountId}/media?`)
    })

    it('타인 계정 요청 시 네트워크 요청 없이 PROVIDER_REJECTED 에러를 던지며 실제 지원 범위를 안내한다 (공식 Meta Business Discovery 미지원)', async () => {
      const mockFetcher = vi.fn()

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'other_brand',
          fetcher: mockFetcher,
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_REJECTED',
        message: expect.stringContaining('인스타그램은 현재 연결한 내 계정만 분석할 수 있어요. 다른 계정은 사진·텍스트 자료로 직접 등록해 주세요.'),
      })

      expect(mockFetcher).not.toHaveBeenCalled()
    })

    it('ownHandle이 null인 경우에도 타계정으로 간주하여 네트워크 요청 없이 PROVIDER_REJECTED를 던진다', async () => {
      const mockFetcher = vi.fn()

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: null,
          targetHandle: 'any_brand',
          fetcher: mockFetcher,
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_REJECTED',
        message: expect.stringContaining('인스타그램은 현재 연결한 내 계정만 분석할 수 있어요. 다른 계정은 사진·텍스트 자료로 직접 등록해 주세요.'),
      })

      expect(mockFetcher).not.toHaveBeenCalled()
    })

    it('429 응답 시 RATE_LIMITED 에러와 사용자용 한국어 메시지를 반환하며 토큰을 노출하지 않는다', async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      )

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'my_account',
          fetcher: mockFetcher,
        }),
      ).rejects.toSatisfy((err: unknown) => {
        const error = err as Error & { code?: string }
        expect(error.code).toBe('RATE_LIMITED')
        expect(error.message).toContain('요청 한도를 초과했습니다')
        expect(error.message).not.toContain(validToken)
        return true
      })
    })

    it('401/403 응답 시 TOKEN_EXPIRED 에러와 사용자용 한국어 메시지를 반환하며 토큰을 노출하지 않는다', async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Session expired' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      )

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'my_account',
          fetcher: mockFetcher,
        }),
      ).rejects.toSatisfy((err: unknown) => {
        const error = err as Error & { code?: string }
        expect(error.code).toBe('TOKEN_EXPIRED')
        expect(error.message).toContain('인증이 만료되었습니다')
        expect(error.message).not.toContain(validToken)
        return true
      })
    })

    it('500 서버 에러 발생 시 TEMPORARY_NETWORK 에러와 사용자용 한국어 메시지를 반환하며 토큰을 노출하지 않는다', async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Internal Server Error' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
      )

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'my_account',
          fetcher: mockFetcher,
        }),
      ).rejects.toSatisfy((err: unknown) => {
        const error = err as Error & { code?: string }
        expect(error.code).toBe('TEMPORARY_NETWORK')
        expect(error.message).toContain('일시적인 문제가 발생했습니다')
        expect(error.message).not.toContain(validToken)
        return true
      })
    })

    it('캡션이 없는 게시물(caption 누락 또는 null)을 빈 문자열로 정상 처리한다', async () => {
      const mockFetcher = vi.fn()
      mockFetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ username: 'my_account' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'p_no_caption_1', media_type: 'IMAGE', media_url: 'https://cdninstagram.com/pic.jpg' },
              { id: 'p_no_caption_2', caption: null, media_type: 'IMAGE', media_url: 'https://cdninstagram.com/pic2.jpg' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchInstagramCorpus({
        accountId,
        accessToken: validToken,
        ownHandle: 'my_account',
        targetHandle: 'my_account',
        fetcher: mockFetcher,
      })

      expect(result.posts).toHaveLength(2)
      expect(result.posts[0]?.caption).toBe('')
      expect(result.posts[1]?.caption).toBe('')
    })

    it('빈 미디어 응답(data: [] 또는 빈 객체)인 경우 빈 포스트 목록을 안전하게 반환한다', async () => {
      const mockFetcher = vi.fn()
      mockFetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ username: 'my_account' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      mockFetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

      const result = await fetchInstagramCorpus({
        accountId,
        accessToken: validToken,
        ownHandle: 'my_account',
        targetHandle: 'my_account',
        fetcher: mockFetcher,
      })

      expect(result.posts).toEqual([])
    })

    it('페이지네이션: limit을 채우기 위해 paging.next 링크를 따라가서 포스트를 추가 수집한다', async () => {
      const mockFetcher = vi.fn()
      // 프로필
      mockFetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ username: 'my_account' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      // 1페이지 (1개 + paging.next)
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'p_page1', media_type: 'IMAGE', media_url: 'https://cdninstagram.com/1.jpg' }],
            paging: {
              next: 'https://graph.instagram.com/v26.0/17841400000000001/media?after=cursor_xyz',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      // 2페이지 (1개)
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'p_page2', media_type: 'IMAGE', media_url: 'https://cdninstagram.com/2.jpg' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchInstagramCorpus({
        accountId,
        accessToken: validToken,
        ownHandle: 'my_account',
        targetHandle: 'my_account',
        fetcher: mockFetcher,
        limit: 2,
      })

      expect(result.posts).toHaveLength(2)
      expect(result.posts[0]?.id).toBe('p_page1')
      expect(result.posts[1]?.id).toBe('p_page2')
      expect(mockFetcher).toHaveBeenCalledTimes(3)
    })

    it('페이지네이션 보안: paging.next의 호스트가 비정상 도메인이면 따라가지 않고 중단한다', async () => {
      const mockFetcher = vi.fn()
      mockFetcher.mockResolvedValueOnce(
        new Response(JSON.stringify({ username: 'my_account' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'p1', media_type: 'IMAGE', media_url: 'https://cdninstagram.com/1.jpg' }],
            paging: {
              next: 'https://evil.com/fake-meta-endpoint',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchInstagramCorpus({
        accountId,
        accessToken: validToken,
        ownHandle: 'my_account',
        targetHandle: 'my_account',
        fetcher: mockFetcher,
        limit: 10,
      })

      expect(result.posts).toHaveLength(1)
      expect(mockFetcher).toHaveBeenCalledTimes(2)
    })

    it('내 계정 조회 중 400 에러(code 110 등)가 발생하면 PROVIDER_REJECTED를 던진다', async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 110,
              message: 'Invalid user id',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      )

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'my_account',
          fetcher: mockFetcher,
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_REJECTED',
      })
    })

    it('네트워크 요청 실패 시 TEMPORARY_NETWORK 에러를 던진다', async () => {
      const mockFetcher = vi.fn().mockRejectedValueOnce(new Error('Network offline'))

      await expect(
        fetchInstagramCorpus({
          accountId,
          accessToken: validToken,
          ownHandle: 'my_account',
          targetHandle: 'my_account',
          fetcher: mockFetcher,
        }),
      ).rejects.toMatchObject({ code: 'TEMPORARY_NETWORK' })
    })
  })

  describe('fetchThreadsOwnCorpus', () => {
    const validToken = 'TH_TOKEN_1234567890abcdef'

    it('내 계정과 다르면 PROVIDER_REJECTED 에러를 던진다', async () => {
      const mockFetcher = vi.fn()

      await expect(
        fetchThreadsOwnCorpus({
          accessToken: validToken,
          ownHandle: 'my_threads',
          targetHandle: 'someone_else',
          fetcher: mockFetcher,
        }),
      ).rejects.toMatchObject({
        code: 'PROVIDER_REJECTED',
        message: expect.stringContaining('스레드는 내가 연결한 계정만 분석할 수 있어요'),
      })

      expect(mockFetcher).not.toHaveBeenCalled()
    })

    it('내 계정의 스레드 목록을 조회하여 ProfileCorpus로 매핑한다', async () => {
      const mockFetcher = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'th_post_1',
                text: '텍스트만 있는 스레드 글',
                media_type: 'TEXT_POST',
                permalink: 'https://threads.net/@my_threads/post/1',
                timestamp: '2026-11-04T08:00:00Z',
              },
              {
                id: 'th_post_2',
                text: '사진 1장 스레드',
                media_type: 'IMAGE',
                media_url: 'https://threads.net/img1.jpg',
                permalink: 'https://threads.net/@my_threads/post/2',
                timestamp: '2026-11-04T09:00:00Z',
              },
              {
                id: 'th_post_3',
                text: '캐러셀 스레드',
                media_type: 'CAROUSEL_ALBUM',
                permalink: 'https://threads.net/@my_threads/post/3',
                timestamp: '2026-11-04T10:00:00Z',
                children: {
                  data: [
                    { media_type: 'IMAGE', media_url: 'https://threads.net/c1.jpg' },
                    { media_type: 'IMAGE', media_url: 'https://threads.net/c2.jpg' },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchThreadsOwnCorpus({
        accessToken: validToken,
        ownHandle: 'my_threads',
        targetHandle: 'MY_THREADS',
        fetcher: mockFetcher,
      })

      expect(result.platform).toBe('threads')
      expect(result.handle).toBe('MY_THREADS')
      expect(result.isOwnAccount).toBe(true)
      expect(result.posts).toHaveLength(3)

      expect(result.posts[0]).toEqual({
        id: 'th_post_1',
        caption: '텍스트만 있는 스레드 글',
        mediaType: 'TEXT',
        imageUrls: [],
        permalink: 'https://threads.net/@my_threads/post/1',
        timestamp: '2026-11-04T08:00:00Z',
        likeCount: null,
        commentsCount: null,
      })

      expect(result.posts[1]?.mediaType).toBe('IMAGE')
      expect(result.posts[1]?.imageUrls).toEqual(['https://threads.net/img1.jpg'])

      expect(result.posts[2]?.mediaType).toBe('CAROUSEL_ALBUM')
      expect(result.posts[2]?.imageUrls).toEqual([
        'https://threads.net/c1.jpg',
        'https://threads.net/c2.jpg',
      ])

      const call = mockFetcher.mock.calls[0]!
      expect(call[0]).toContain('https://graph.threads.net/v1.0/me/threads?fields=')
      expect(call[1]?.headers).toEqual({ authorization: `Bearer ${validToken}` })
      expect(call[1]?.cache).toBe('no-store')
    })

    it('스레드 페이지네이션: paging.next 링크를 따라가며 포스트를 추가 수집한다', async () => {
      const mockFetcher = vi.fn()
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'th1', text: '글1', media_type: 'TEXT_POST' }],
            paging: {
              next: 'https://graph.threads.net/v1.0/me/threads?after=cursor_1',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      mockFetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'th2', text: '글2', media_type: 'TEXT_POST' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

      const result = await fetchThreadsOwnCorpus({
        accessToken: validToken,
        ownHandle: 'my_threads',
        targetHandle: 'my_threads',
        fetcher: mockFetcher,
        limit: 2,
      })

      expect(result.posts).toHaveLength(2)
      expect(result.posts[0]?.id).toBe('th1')
      expect(result.posts[1]?.id).toBe('th2')
      expect(mockFetcher).toHaveBeenCalledTimes(2)
    })
  })
})
