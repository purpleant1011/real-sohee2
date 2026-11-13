import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: mocks.authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))
vi.mock('@/features/vault/funnel', () => ({ recordVaultFunnelEvent: vi.fn() }))
vi.mock('@/features/publishing/dual-provider-publish-service', () => {
  throw new Error('provider import forbidden')
})
vi.mock('@/features/channels/meta-capability-truth', () => {
  throw new Error('OAuth/provider import forbidden')
})

import { toUserVaultItemDto } from '@/features/vault/query/formatters'
import type { VaultItem } from '@/features/vault/types'
import { GET, PATCH } from './route'

const WS = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const DIGEST = 'c'.repeat(64)
const item = {
  id: ITEM_ID, workspace_id: WS, content_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', channel: 'daangn_business',
  release_gate: 'HELD_USER', hold_reason: null, held_at: null, held_by: null, target_date: null, approved_fingerprint: 'd'.repeat(64), fingerprint_schema_version: 3,
  policy_version: 'vault-save-v1', spec_version: '2026.10.1', approval_state: 'APPROVED', approved_by: null, bundle_id: null, idempotency_key: 'k', deleted_at: null,
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z',
}
const payloadRow = {
  id: '66666666-6666-4666-8666-666666666666', workspace_id: WS, vault_item_id: ITEM_ID, preview_artifacts: {}, created_at: '', updated_at: '',
  payload: { title: '오늘의 소식', text: '신메뉴가 나왔어요', hashtags: ['신메뉴'], media: [{ position: 0, type: 'image', mimeType: 'image/jpeg', sizeBytes: 10, renditionContentDigest: DIGEST }], settings: {}, targetAccountId: 'x' },
}
const ref = toUserVaultItemDto({ id: ITEM_ID, channel: 'daangn_business' } as VaultItem).item_ref

/** Minimal chainable query: .select().eq().eq().maybeSingle() */
function table(row: unknown, error: { message: string } | null = null) {
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error }) }
  return chain
}
const call = (itemRef = ref) => GET(new Request(`http://localhost/api/workspaces/${WS}/vault/${itemRef}`), { params: Promise.resolve({ workspaceId: WS, itemRef }) })

describe('보관 항목 변경 API (PATCH)', () => {
  it('버전 없는 요청은 400으로 거절하고 DB에 쓰지 않는다', async () => {
    const rpc = vi.fn()
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: '55555555-5555-4555-8555-555555555555', admin: { from: mocks.from, rpc } })
    const response = await PATCH(new Request(`http://localhost/api/workspaces/${WS}/vault/${ref}`, { method: 'PATCH', body: JSON.stringify({ operation: 'hold' }) }), { params: Promise.resolve({ workspaceId: WS, itemRef: ref }) })
    expect(response.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('B-2 PATCH 역할 게이트', () => {
  it('manager 이상을 요구하고 actorRole을 서비스에 전달한다', async () => {
    const rpc = vi.fn()
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: '55555555-5555-4555-8555-555555555555', role: 'viewer', admin: { from: mocks.from, rpc } })
    const body = JSON.stringify({ expectedVersion: '2026-10-07T00:00:00Z', operation: 'delete' })
    await PATCH(new Request(`http://localhost/api/workspaces/${WS}/vault/${ref}`, { method: 'PATCH', body }), { params: Promise.resolve({ workspaceId: WS, itemRef: ref }) })
    expect(mocks.authorize).toHaveBeenCalledWith(WS, expect.objectContaining({ requireRole: 'manager' }))
  })
  it('권한 응답(403)은 서비스까지 가지 않는다', async () => {
    const rpc = vi.fn()
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '이 작업은 매장 관리자만 할 수 있어요.' }), { status: 403 }))
    const response = await PATCH(new Request(`http://localhost/api/workspaces/${WS}/vault/${ref}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: 'x', operation: 'delete' }) }), { params: Promise.resolve({ workspaceId: WS, itemRef: ref }) })
    expect(response.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('보관 항목 상세 조회 API (GET)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('outbound network forbidden') }))
    mocks.from.mockImplementation((name: string) => table(name === 'vault_items' ? item : name === 'vault_variant_payloads' ? payloadRow : null))
    // `supabase` is the signed-in user's session client; `admin` must not be needed for a read.
    mocks.authorize.mockResolvedValue({ workspaceId: WS, userId: '55555555-5555-4555-8555-555555555555', supabase: { from: mocks.from }, admin: { from: vi.fn(() => { throw new Error('admin client must not be used for reads') }) } })
  })

  it('사용자 DTO를 no-store로 돌려주고 외부 호출은 하지 않는다', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ success: true, data: { item_ref: ref, channel: 'daangn_business', channel_label: '당근 비즈니스', status_label: '발행 준비 완료 · 외부 게시 전', content: { title: '오늘의 소식', body: '신메뉴가 나왔어요', tags: ['신메뉴'] }, media: [{ type: 'image', mime_type: 'image/jpeg', size_bytes: 10 }] } })
    const json = JSON.stringify(body)
    for (const hidden of [ITEM_ID, WS, DIGEST, 'd'.repeat(64), 'APPROVED']) expect(json).not.toContain(hidden)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.from.mock.calls.map(([name]) => name).sort()).toEqual(['vault_items', 'vault_variant_payloads'])
  })

  it('로그인·매장 확인 응답은 그대로 전달한다', async () => {
    mocks.authorize.mockResolvedValue(new Response(JSON.stringify({ error: '로그인이 필요해요.' }), { status: 401 }))
    expect((await call()).status).toBe(401)
  })

  it('없는 항목은 404, 잘못된 참조는 422, 내용이 비어 있으면 빈 화면이 아니라 409 오류로 알린다', async () => {
    mocks.from.mockImplementation((name: string) => table(name === 'vault_items' ? null : payloadRow))
    const missing = await call()
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ success: false, error: '보관 항목을 찾을 수 없어요.' })
    expect((await call('not-a-reference')).status).toBe(422)
    mocks.from.mockImplementation((name: string) => table(name === 'vault_items' ? item : null))
    expect((await call()).status).toBe(409)
  })

  it('조회 실패는 내부 오류 문구를 숨기고 500으로 알린다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.from.mockImplementation(() => table(null, { message: 'relation "vault_items" is broken' }))
    const response = await call()
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ success: false, error: '보관 글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' })
    expect(JSON.stringify(body)).not.toContain('relation')
    log.mockRestore()
  })
})
