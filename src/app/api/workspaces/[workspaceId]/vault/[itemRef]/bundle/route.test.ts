import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getBundle: vi.fn(),
  registerUrl: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))

vi.mock('@/features/vault/bundle/service', () => ({
  getCopyBundle: mocks.getBundle,
  registerManualPublishUrl: mocks.registerUrl,
  VaultBundleError: class VaultBundleError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message)
    }
  },
}))

vi.mock('@/features/vault/bundle/repository', () => ({
  SupabaseVaultBundleRepository: class {},
  createSupabaseRenditionReader: vi.fn(),
  createSupabaseRenditionSigner: vi.fn(),
}))

vi.mock('@/features/publishing/dual-provider-publish-service', () => {
  throw new Error('provider import forbidden')
})
vi.mock('@/features/channels/meta-capability-truth', () => {
  throw new Error('OAuth/provider import forbidden')
})

import { GET, POST } from './route'

const WS = '11111111-1111-4111-8111-111111111111'
const ITEM_REF = '22222222-2222-4222-8222-222222222222'

const callGet = () =>
  GET(new Request(`http://localhost/api/workspaces/${WS}/vault/${ITEM_REF}/bundle`), {
    params: Promise.resolve({ workspaceId: WS, itemRef: ITEM_REF }),
  })

const callPost = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/workspaces/${WS}/vault/${ITEM_REF}/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ workspaceId: WS, itemRef: ITEM_REF }),
    },
  )

describe('bundle API route (ANI-1541)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('outbound network forbidden')
      }),
    )
    mocks.authorize.mockResolvedValue({
      workspaceId: WS,
      userId: '44444444-4444-4444-8444-444444444444',
      admin: { from: vi.fn(), storage: { from: vi.fn() } },
    })
  })

  it('GET: returns bundle on success with no-store header', async () => {
    const mockBundle = {
      itemRef: ITEM_REF,
      channel: 'naver_blog',
      channelLabel: '네이버 블로그',
      title: '제목',
      body: '본문',
      tags: ['태그'],
      formattedTags: '#태그',
      fullText: '전체',
      settingsNotice: '직접 선택',
      images: [],
      guideSteps: [],
      publicationStatus: {
        statusLabel: '발행 준비 완료 · 외부 게시 전',
        isPublishedUrlRegistered: false,
        publishedUrl: null,
        registeredAt: null,
      },
    }
    mocks.getBundle.mockResolvedValue(mockBundle)

    const res = await callGet()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual(mockBundle)
  })

  it('GET: handles unauthorized or missing workspace', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = await callGet()
    expect(res.status).toBe(403)
    expect(mocks.getBundle).not.toHaveBeenCalled()
  })

  it('POST: registers manual publication URL and returns status', async () => {
    mocks.registerUrl.mockResolvedValue({
      success: true,
      publishedUrl: 'https://blog.naver.com/my/123',
      statusLabel: '사장님이 직접 올린 글로 기록됐어요(확인 전)',
      registeredAt: '2026-10-08T10:00:00Z',
    })

    const res = await callPost({ url: 'https://blog.naver.com/my/123' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const json = await res.json()
    expect(json.statusLabel).toBe('사장님이 직접 올린 글로 기록됐어요(확인 전)')
  })

  it('POST: rejects empty or missing URL with 422', async () => {
    const res = await callPost({ url: '' })
    expect(res.status).toBe(422)
    expect(mocks.registerUrl).not.toHaveBeenCalled()
  })
})

describe('B-2 publish URL registration role gate', () => {
  it('POST requires manager role and forwards actor role; GET stays member-level', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: 'u1', role: 'owner', admin: {} })
    mocks.registerUrl.mockResolvedValue({ success: true })
    await callPost({ url: 'https://blog.naver.com/a/1' })
    expect(mocks.authorize).toHaveBeenLastCalledWith(WS, expect.objectContaining({ requireRole: 'manager' }))
    expect(mocks.registerUrl).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ actorRole: 'owner' }) }))
    mocks.getBundle.mockResolvedValue({})
    await callGet()
    expect(mocks.authorize).toHaveBeenLastCalledWith(WS)
  })
  it('POST returns the auth 403 without calling the service', async () => {
    mocks.registerUrl.mockClear()
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '이 작업은 매장 관리자만 할 수 있어요.' }), { status: 403 }))
    const res = await callPost({ url: 'https://blog.naver.com/a/1' })
    expect(res.status).toBe(403)
    expect(mocks.registerUrl).not.toHaveBeenCalled()
  })
})
