import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn(), generate: vi.fn(), context: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({ authorizeQuickRequest: mocks.authorize, isResponse: (v: unknown) => v instanceof Response }))
vi.mock('@/features/mobile-inbox/server/read-detail', () => ({ readConversationDetail: mocks.read }))
vi.mock('@/features/vault/transform/adapters/gemini', () => ({ createGeminiTextGenerator: () => ({ generateText: mocks.generate }) }))
vi.mock('@/features/channel-studio/knowledge-context', () => ({ createSupabaseKnowledgeGateway: () => ({}), loadGroundedBusinessContext: mocks.context }))
import { POST } from './route'
const key = 'comment:11111111-1111-4111-8111-111111111111'
const fingerprint = 'a'.repeat(64)
const detail = { thread: { id: key, workspaceId: 'ws', channel: 'instagram_comment', draft: { text: '원래 답안' } }, messages: [{ id: 'source', fromCustomer: true, text: '문의', at: '2026-10-28T00:00:00Z' }], complete: true, delivery: 'none', fingerprint }
const params = { params: Promise.resolve({ workspaceId: 'ws', threadKey: key }) }
const request = (body: unknown = { instruction: '더 친절하게 바꿔 줘', expectedFingerprint: fingerprint }) => new Request('http://localhost/rewrite', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorize.mockResolvedValue({ workspaceId: 'ws', userId: 'user', supabase: {}, admin: {} })
  mocks.read.mockResolvedValue({ status: 'ok', detail })
  mocks.context.mockResolvedValue({ businessName: '서비스', facts: [], tone: {} })
  mocks.generate.mockResolvedValue(JSON.stringify({ reply: '안녕하세요. 문의해 주셔서 감사합니다.' }))
})
it('수정 지시와 서버 원문으로 초안만 생성하고 저장·전송은 하지 않는다', async () => {
  const response = await POST(request(), params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ draftText: '안녕하세요. 문의해 주셔서 감사합니다.', basedOnFingerprint: fingerprint })
  expect(mocks.generate.mock.calls[0][0]).toContain('더 친절하게 바꿔 줘')
  expect(mocks.generate.mock.calls[0][0]).toContain('원래 답안')
  expect(mocks.generate.mock.calls[0][0]).toContain('문의')
  expect(mocks.authorize).toHaveBeenCalledWith('ws', { requireRole: 'manager' })
  expect(response.headers.get('Cache-Control')).toContain('no-store')
})
it('인증 실패는 생성기를 호출하지 않는다', async () => {
  mocks.authorize.mockResolvedValue(new Response(null, { status: 403 }))
  expect((await POST(request(), params)).status).toBe(403)
  expect(mocks.generate).not.toHaveBeenCalled()
})
it.each([{ fingerprint: 'b'.repeat(64) }, { complete: false }, { delivery: 'unknown' }])('최신 검토 조건이 다르면 재작성하지 않는다: %j', async changed => {
  mocks.read.mockResolvedValue({ status: 'ok', detail: { ...detail, ...changed } })
  expect((await POST(request(), params)).status).toBe(409)
  expect(mocks.generate).not.toHaveBeenCalled()
})
it('생성 도중 새 고객 메시지가 오면 수정안을 적용하지 않는다', async () => {
  mocks.read.mockResolvedValueOnce({ status: 'ok', detail }).mockResolvedValueOnce({ status: 'ok', detail: { ...detail, messages: [...detail.messages, { id: 'new', fromCustomer: true, text: '추가 문의' }] } })
  expect((await POST(request(), params)).status).toBe(409)
})
it('생성 실패를 성공한 수정안으로 대체하지 않는다', async () => {
  mocks.generate.mockRejectedValue(new Error('offline'))
  expect((await POST(request(), params)).status).toBe(503)
})
it('잘못된 생성 출력은 저장 가능한 답안으로 돌려주지 않는다', async () => {
  mocks.generate.mockResolvedValue('{"reply":""}')
  expect((await POST(request(), params)).status).toBe(503)
})
it('다른 workspace의 상세 응답은 사용하지 않는다', async () => {
  mocks.read.mockResolvedValue({ status: 'ok', detail: { ...detail, thread: { ...detail.thread, workspaceId: 'other' } } })
  expect((await POST(request(), params)).status).toBe(409)
  expect(mocks.generate).not.toHaveBeenCalled()
})
