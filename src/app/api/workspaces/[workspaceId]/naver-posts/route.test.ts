import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NaverPostGenerationError } from '@/features/channel-studio/naver/generate-naver-post'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  generateNaverBlogPost: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (value: unknown) => value instanceof Response,
}))

vi.mock('@/features/channel-studio/naver/generate-naver-post', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/channel-studio/naver/generate-naver-post')>()
  return {
    ...actual,
    generateNaverBlogPost: mocks.generateNaverBlogPost,
  }
})

import { POST } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const url = `http://localhost/api/workspaces/${WORKSPACE}/naver-posts`

const post = (body: unknown = { topic: '세무 상담 안내', requestKey: KEY, imageCount: 4 }, workspaceId = WORKSPACE) =>
  POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ workspaceId }),
  })

const successResult = {
  contentId: '44444444-4444-4444-4444-444444444444',
  versionId: '55555555-5555-5555-5555-555555555555',
  versionNumber: 1,
  fingerprint: 'a'.repeat(64),
  title: '세무 상담 안내 포스팅',
  imageCount: 4,
}

describe('POST /api/workspaces/[workspaceId]/naver-posts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, userId: USER_ID, admin: {}, supabase: {} })
    mocks.generateNaverBlogPost.mockResolvedValue(successResult)
  })

  it('로그인하지 않은 요청은 401로 거절한다', async () => {
    mocks.authorize.mockResolvedValue(
      new Response(JSON.stringify({ error: '로그인이 필요해요.' }), { status: 401 }),
    )
    const res = await post()
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('로그인이 필요해요.')
    expect(mocks.generateNaverBlogPost).not.toHaveBeenCalled()
  })

  it('다른 작업공간 접근은 403으로 거절한다', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = await post(undefined, 'foreign-ws')
    expect(res.status).toBe(403)
    expect(mocks.generateNaverBlogPost).not.toHaveBeenCalled()
  })

  it('요청 매장과 인가 매장이 불일치하면 403으로 거절한다', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, userId: USER_ID, admin: {}, supabase: {} })
    const res = await post(undefined, '00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errorCode).toBe('WORKSPACE_FORBIDDEN')
    expect(mocks.generateNaverBlogPost).not.toHaveBeenCalled()
  })

  it.each([
    { topic: '', requestKey: KEY },
    { topic: '   ', requestKey: KEY },
    { topic: '세무 상담', requestKey: 'not-a-uuid' },
    { topic: '세무 상담', requestKey: KEY, imageCount: 0 }, // min 1
    { topic: '세무 상담', requestKey: KEY, imageCount: 21 }, // max 20
    { topic: '세무 상담', requestKey: KEY, visibility: 'invalid' },
    { topic: '세무 상담', requestKey: KEY, categoryId: '' }, // empty categoryId rejected (F9)
    { topic: '세무 상담', requestKey: KEY, categoryId: '   ' }, // whitespace-only categoryId rejected (F9)
  ])('잘못된 입력값은 400 및 한국어 안내로 거절한다 (%j)', async (badBody) => {
    const res = await post(badBody)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/[가-힣]/)
    expect(json.errorCode).toBe('VALIDATION_FAILED')
    expect(mocks.generateNaverBlogPost).not.toHaveBeenCalled()
  })

  it('모든 모드에서 1장부터 20장까지 정상 허용하고 0장과 21장은 400으로 거절한다', async () => {
    // 1. information + 1장 통과
    const resInfo1 = await post({
      topic: '정보형 1장',
      requestKey: KEY,
      imageCount: 1,
      postMode: 'information',
    })
    expect(resInfo1.status).toBe(200)
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 1,
        postMode: 'information',
      }),
    )

    // 2. information + 20장 통과
    const resInfo20 = await post({
      topic: '정보형 20장',
      requestKey: KEY,
      imageCount: 20,
      postMode: 'information',
    })
    expect(resInfo20.status).toBe(200)
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 20,
        postMode: 'information',
      }),
    )

    // 3. photo_story + 20장 통과
    const resPhoto20 = await post({
      topic: '포토스토리 20장',
      requestKey: KEY,
      imageCount: 20,
      postMode: 'photo_story',
    })
    expect(resPhoto20.status).toBe(200)
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 20,
        postMode: 'photo_story',
      }),
    )

    // 4. 0장 거절 (400)
    const resZero = await post({
      topic: '0장 거절',
      requestKey: KEY,
      imageCount: 0,
      postMode: 'information',
    })
    expect(resZero.status).toBe(400)
    expect((await resZero.json()).errorCode).toBe('VALIDATION_FAILED')

    // 5. 21장 거절 (400)
    const resOver = await post({
      topic: '21장 거절',
      requestKey: KEY,
      imageCount: 21,
      postMode: 'photo_story',
    })
    expect(resOver.status).toBe(400)
    expect((await resOver.json()).errorCode).toBe('VALIDATION_FAILED')
  })

  it('과정 소개형(process) 및 공간 둘러보기(place_tour)도 1~20장 사진을 정상 지원한다', async () => {
    const resProc = await post({
      topic: '과정 소개',
      requestKey: KEY,
      imageCount: 1,
      postMode: 'process',
      reaction: 'visit',
      imageStyle: 'process_shot',
    })
    expect(resProc.status).toBe(200)
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 1,
        postMode: 'process',
        reaction: 'visit',
        imageStyle: 'process_shot',
      }),
    )

    const resTour = await post({
      topic: '공간 둘러보기',
      requestKey: KEY,
      imageCount: 20,
      postMode: 'place_tour',
      reaction: 'trust',
      imageStyle: 'bright_space',
    })
    expect(resTour.status).toBe(200)
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        imageCount: 20,
        postMode: 'place_tour',
        reaction: 'trust',
        imageStyle: 'bright_space',
      }),
    )
  })

  it('매장 관리자 권한으로 네이버 블로그 글을 정상 생성하고 200 반환한다', async () => {
    const res = await post({
      topic: '세무 상담 안내',
      requestKey: KEY,
      imageCount: 4,
      visibility: 'public',
      categoryId: 'cat-123',
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.authorize).toHaveBeenCalledWith(WORKSPACE, { requireRole: 'manager' })
    expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE,
        userId: USER_ID,
        topic: '세무 상담 안내',
        imageCount: 4,
        requestKey: KEY,
        visibility: 'public',
        categoryId: 'cat-123',
        signal: expect.anything(),
        deps: expect.objectContaining({
          admin: expect.anything(),
          userClient: expect.anything(),
        }),
      }),
    )

    const json = await res.json()
    expect(json.post).toEqual(successResult)
  })

  it.each(['public', 'neighbor', 'mutual_neighbor', 'private'] as const)(
    'API accepts all four visibility options (%s) (F5)',
    async (visibility) => {
      const res = await post({
        topic: '세무 상담 안내',
        requestKey: KEY,
        imageCount: 4,
        visibility,
      })
      expect(res.status).toBe(200)
      expect(mocks.generateNaverBlogPost).toHaveBeenCalledWith(
        expect.objectContaining({ visibility }),
      )
    },
  )

  it('중복 진행 중(IN_PROGRESS) 시 409 상태코드와 친절한 안내를 반환한다 (F3)', async () => {
    mocks.generateNaverBlogPost.mockRejectedValue(
      new NaverPostGenerationError(
        'IN_PROGRESS',
        '이미 글을 만들고 있어요. 잠시만 기다려 주세요.',
        409,
      ),
    )

    const res = await post()
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.errorCode).toBe('IN_PROGRESS')
    expect(json.error).toBe('이미 글을 만들고 있어요. 잠시만 기다려 주세요.')
  })

  it('사실 확인 불가(CLAIMS_NEED_REVIEW) 시 422 상태코드와 친절한 안내를 반환한다 (F7)', async () => {
    mocks.generateNaverBlogPost.mockRejectedValue(
      new NaverPostGenerationError(
        'CLAIMS_NEED_REVIEW',
        '사실 확인이 필요한 표현이 있어 글을 만들지 못했어요. 다른 주제나 표현으로 다시 시도해 주세요.',
        422,
      ),
    )

    const res = await post()
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.errorCode).toBe('CLAIMS_NEED_REVIEW')
    expect(json.error).toBe('사실 확인이 필요한 표현이 있어 글을 만들지 못했어요. 다른 주제나 표현으로 다시 시도해 주세요.')
  })

  it('크레딧 부족 시 402 상태코드와 친절한 안내 문구를 반환한다', async () => {
    mocks.generateNaverBlogPost.mockRejectedValue(
      new NaverPostGenerationError(
        'CREDIT_INSUFFICIENT',
        '크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.',
        402,
      ),
    )

    const res = await post()
    expect(res.status).toBe(402)
    const json = await res.json()
    expect(json.errorCode).toBe('CREDIT_INSUFFICIENT')
    expect(json.error).toBe('크레딧이 부족해서 글을 만들 수 없어요. 크레딧을 충전한 뒤 다시 시도해 주세요.')
  })

  it('이미지 생성 불완전(IMAGES_INCOMPLETE) 시 500 상태코드와 친절한 안내를 반환한다', async () => {
    mocks.generateNaverBlogPost.mockRejectedValue(
      new NaverPostGenerationError(
        'IMAGES_INCOMPLETE',
        '이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        500,
      ),
    )

    const res = await post()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.errorCode).toBe('IMAGES_INCOMPLETE')
    expect(json.error).toBe('이미지를 모두 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  })
})
