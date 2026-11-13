import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), save: vi.fn(), record: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/vault/service/save', () => ({ saveToVault: mocks.save, VaultSaveError: class VaultSaveError extends Error { constructor(public status: number, public reason: string, message: string) { super(message) } } }))
vi.mock('@/features/quick-start/funnel-events', () => ({ recordFunnelEvent: mocks.record }))
vi.mock('@/features/vault/model/supabase-save-repository', () => ({ SupabaseVaultSaveRepository: class {} }))
vi.mock('@/features/publishing/dual-provider-publish-service', () => { throw new Error('provider import forbidden') })
vi.mock('@/features/channels/meta-capability-truth', () => { throw new Error('OAuth/provider import forbidden') })

import { POST } from './route'
const WS = '11111111-1111-4111-8111-111111111111'
const body = { contentId: '22222222-2222-4222-8222-222222222222', versionId: '33333333-3333-4333-8333-333333333333', channels: ['instagram', 'threads'], targetDate: null, idempotencyKey: 'save-1' }
const call = (value: typeof body | { [key: string]: unknown } = body) => POST(new Request(`http://localhost/api/workspaces/${WS}/vault`, { method: 'POST', body: JSON.stringify(value) }), { params: Promise.resolve({ workspaceId: WS }) })

describe('vault API authorization and zero-provider boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('outbound network forbidden') }))
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: '44444444-4444-4444-8444-444444444444', admin: { from: vi.fn() } })
    mocks.save.mockResolvedValue({ saved: [{ channel: 'instagram', release_gate_label: '채널 연결을 기다리는 중 · 외부 게시 전', status_label: '발행 준비 완료 · 외부 게시 전' }], rejected: [{ channel: 'threads', reason_label: '내용을 확인해 주세요' }], external_posts: 0 })
  })
  it('returns partial success and explicit zero external posts with blocked provider imports', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ saved: [{ channel: 'instagram', release_gate_label: '채널 연결을 기다리는 중 · 외부 게시 전', status_label: '발행 준비 완료 · 외부 게시 전' }], rejected: [{ channel: 'threads', reason_label: '내용을 확인해 주세요' }], external_posts: 0 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires manager role at the route and forwards the actor role to the service (B-2)', async () => {
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: '44444444-4444-4444-8444-444444444444', role: 'manager', admin: { from: vi.fn() } })
    await call()
    expect(mocks.authorize).toHaveBeenCalledWith(WS, expect.objectContaining({ requireRole: 'manager' }))
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ actorRole: 'manager' }), expect.anything())
  })
  it('rejects non-member before service-role repository is constructed', async () => {
    mocks.authorize.mockResolvedValue(new Response('{}', { status: 403 }))
    const response = await call()
    expect(response.status).toBe(403)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('returns not found when scoped draft is unavailable', async () => {
    mocks.save.mockRejectedValue(Object.assign(new Error('콘텐츠를 찾을 수 없어요.'), { status: 404, reason: 'CONTENT_NOT_FOUND' }))
    const response = await call()
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: '콘텐츠를 찾을 수 없어요.', external_posts: 0 })
  })
  it('rejects unsupported channels and malformed dates before saving', async () => {
    const response = await call({ ...body, channels: ['unsupported'], targetDate: '2026-02-31' })
    expect(response.status).toBe(422)
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
