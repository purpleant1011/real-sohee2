import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelDraftError } from '@/features/channel-studio/types'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), create: vi.fn(), generate: vi.fn(), edit: vi.fn(), listRecent: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (value: unknown) => value instanceof Response }))
vi.mock('@/features/channel-studio/compose', () => ({ createChannelDraftService: mocks.create }))

import { GET, PATCH, POST } from './route'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const KEY = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const url = `http://localhost/api/workspaces/${WORKSPACE}/channel-drafts`
const post = (body: unknown = { topic: '  가게 인사  ', requestKey: KEY }, workspaceId = WORKSPACE) =>
  POST(new Request(url, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceId }) })
const get = (workspaceId = WORKSPACE) => GET(new Request(url), { params: Promise.resolve({ workspaceId }) })
const patch = (body: unknown = { requestKey: KEY, channel: 'threads', edits: { text: '바뀐 글' } }, workspaceId = WORKSPACE) => PATCH(new Request(url, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ workspaceId }) })
const saved = {
  requestKey: KEY, topic: '가게 인사', createdAt: '2026-10-08T12:00:00.000Z', basisNotes: ['지식 v3 기준'], imageNotice: '이미지는 아직 만들지 않았어요.',
  variants: [{ channel: 'threads', payload: { text: '가게 인사', media: [] }, status: 'READY', statusLabel: '보관할 수 있어요', issues: [], contentId: null, versionId: null, vaultSavable: true, blockedReason: null }],
}

describe('채널별 글 API 권한과 사용자 응답', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, userId, admin: {} })
    mocks.create.mockReturnValue({ generate: mocks.generate, edit: mocks.edit, listRecent: mocks.listRecent })
    mocks.edit.mockResolvedValue(saved)
    mocks.generate.mockResolvedValue(saved)
    mocks.listRecent.mockResolvedValue([saved])
  })

  it('로그인하지 않은 POST는 서비스 생성 전에 401로 거절한다', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '로그인이 필요해요.' }), { status: 401 }))
    const res = await post()
    expect(res.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('다른 매장 POST는 서비스 생성 전에 403으로 거절한다', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = await post(undefined, 'foreign')
    expect(res.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('인가 결과가 요청 매장과 불일치하면 서비스 역할 클라이언트를 사용하지 않는다', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, userId, admin: {} })
    const postResponse = await post(undefined, 'foreign')
    const getResponse = await get('foreign')
    expect(postResponse.status).toBe(403)
    expect(getResponse.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('다른 매장 GET도 목록 조회 전에 차단한다', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    const res = await get('foreign')
    expect(res.status).toBe(403)
    expect(mocks.listRecent).not.toHaveBeenCalled()
  })

  it.each([{ topic: '', requestKey: KEY }, { topic: '  ', requestKey: KEY }, { topic: '가게 인사', requestKey: 'invalid' }, { topic: '가게 인사', requestKey: KEY, extra: 'bad' }, { topic: '가게 인사', requestKey: KEY, includeImage: 'true' }])('잘못된 입력은 400으로 거절한다', async (body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/[가-힣]/)
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('인증된 관리자는 채널 연결 없이도 200으로 글을 생성한다', async () => {
    const res = await post({ topic: ' 가게 인사 ', requestKey: KEY, includeImage: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.authorize).toHaveBeenCalledWith(WORKSPACE, { requireRole: 'manager' })
    expect(mocks.generate).toHaveBeenCalledWith({ workspaceId: WORKSPACE, userId, topic: '가게 인사', requestKey: KEY, includeImage: true })
    expect((await res.json()).draft.variants[0].payload.text).toBe('가게 인사')
  })

  it('PATCH는 매장 관리자 인가 후 전체 초안을 반환하고 내부 필드를 숨긴다', async () => {
    mocks.edit.mockResolvedValue({ ...saved, internalSecret: 'secret', variants: [{ ...saved.variants[0], payload: { text: '바뀐 글', secret: 'secret' } }] })
    const res = await patch()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mocks.authorize).toHaveBeenCalledWith(WORKSPACE, { requireRole: 'manager' })
    expect(mocks.edit).toHaveBeenCalledWith({ workspaceId: WORKSPACE, userId, requestKey: KEY, channel: 'threads', edits: { text: '바뀐 글' } })
    expect((await res.json()).draft.variants[0].payload).toEqual({ text: '바뀐 글' })
  })

  it('PATCH 인가 실패와 다른 매장 접근은 서비스 생성 전에 차단한다', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await patch()).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.authorize.mockResolvedValue({ workspaceId: WORKSPACE, userId, admin: {} })
    expect((await patch(undefined, 'foreign')).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    { requestKey: 'bad', channel: 'threads', edits: { text: '글' } },
    { requestKey: KEY, channel: 'other', edits: { text: '글' } },
    { requestKey: KEY, channel: 'threads', edits: { text: '글', unknown: 'no' } },
    { requestKey: KEY, channel: 'threads', edits: {} },
    { requestKey: KEY, channel: 'threads', edits: { text: 42 } },
    { requestKey: KEY, channel: 'threads', edits: { hashtags: ['a'.repeat(51)] } },
    { requestKey: KEY, channel: 'threads', edits: { text: '글' }, extra: 'no' },
  ])('PATCH의 유효하지 않은 body는 400이며 쓰기를 하지 않는다', async (body) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    expect(mocks.edit).not.toHaveBeenCalled()
    expect((await res.json()).error).toMatch(/[가-힣]/)
  })

  it.each([404, 409])('PATCH 서비스 오류 %i는 한국어만 노출한다', async (status) => {
    mocks.edit.mockRejectedValue(new ChannelDraftError('글을 다시 확인해 주세요.', status === 404 ? 'DRAFT_NOT_FOUND' : 'EDIT_CONFLICT', status))
    const res = await patch()
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ error: '글을 다시 확인해 주세요.' })
  })

  it('GET은 멤버 권한으로 인증하고 최근 목록만 반환한다', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(mocks.authorize).toHaveBeenCalledWith(WORKSPACE)
    expect(mocks.listRecent).toHaveBeenCalledWith(WORKSPACE, 20)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).items).toHaveLength(1)
  })

  it('서비스 오류는 상태 코드와 한국어 문구를 유지하고 원인 예외는 노출하지 않는다', async () => {
    mocks.generate.mockRejectedValue(new ChannelDraftError('오늘 작성할 수 있는 글이 모두 소진됐어요.', 'DAILY_LIMIT_REACHED', 429))
    const res = await post()
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: '오늘 작성할 수 있는 글이 모두 소진됐어요.', code: 'DAILY_LIMIT_REACHED' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('인증 실패 응답의 내부 식별 코드와 원문 메시지를 제거한다', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: 'Access denied (CROSS_TENANT_ACCESS_DENIED)', code: 'CROSS_TENANT_ACCESS_DENIED', debug: 'sk-private' }), { status: 403 }))
    const res = await post()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/CROSS_TENANT|sk-private|Access denied/)
    expect(body.error).toMatch(/[가-힣]/)
  })

  it('예상치 못한 오류는 내부 원문을 숨기고 503을 반환한다', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      mocks.generate.mockRejectedValue(new Error('provider token secret'))
      const res = await post()
      expect(res.status).toBe(503)
      expect(JSON.stringify(await res.json())).not.toContain('provider token secret')
      expect(consoleSpy).toHaveBeenCalled()
    } finally { consoleSpy.mockRestore() }
  })

  it('미리보기용 매장 미디어 경로만 전달하고 외부 이미지 주소와 내부 필드는 차단한다', async () => {
    const safe = `/api/workspaces/${WORKSPACE}/media/44444444-4444-4444-8444-444444444444`
    mocks.generate.mockResolvedValue({ ...saved, variants: [{ ...saved.variants[0], payload: { text: '사진 글', imageUrl: safe, imageUrls: [safe, 'https://secret.example/signed'], media: [{ type: 'image', src: safe, mimeType: 'image/png', sha256Digest: 'internal' }, { type: 'image', src: 'https://secret.example/signed' }] } }] })
    const res = await post()
    const body = await res.json()
    expect(body.draft.variants[0].payload.imageUrl).toBe(safe)
    expect(body.draft.variants[0].payload.imageUrls).toEqual([safe])
    expect(body.draft.variants[0].payload.media).toEqual([{ type: 'image', mimeType: 'image/png', src: safe }, { type: 'image' }])
    expect(JSON.stringify(body)).not.toMatch(/secret|sha256Digest/)
  })

  it('서버의 내부 감사 필드와 중첩된 제공자 메타데이터는 DTO에 전달하지 않는다', async () => {
    mocks.generate.mockResolvedValue({ ...saved, providerKey: 'hidden', prompt: 'secret', variants: [{ ...saved.variants[0], tone_trace: { rationale: 'internal' }, payload: { text: '가게 인사', media: [{ type: 'image', format: 'jpeg', url: 'signed-secret', token: 'hidden' }], blocks: [{ type: 'paragraph', text: '원문', rawProvider: 'hidden' }], rawProvider: 'hidden' } }] })
    const res = await post()
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/providerKey|rawProvider|tone_trace|prompt|secret|internal|token/)
    expect(body.draft.variants[0].payload.media).toEqual([{ type: 'image', format: 'jpeg' }])
    expect(body.draft.variants[0].payload.blocks).toEqual([{ type: 'paragraph', text: '원문' }])
  })
})
