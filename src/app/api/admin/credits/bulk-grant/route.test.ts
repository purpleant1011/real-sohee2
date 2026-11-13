import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { OperatorAccessError } from '@/features/operator-auth/current-operator'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), admin: vi.fn() }))
vi.mock('@/features/operator-auth/require-operator', () => ({ requireOperator: mocks.guard }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: mocks.admin }))
import { POST } from './route'
import { POST as preview } from './preview/route'
const actor = 'b7000000-0000-4000-8000-000000000001'
const request = (path: string, body: unknown) => new NextRequest(`http://localhost/api/admin/credits/bulk-grant${path}`, { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ userId: actor })
  mocks.admin.mockReturnValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: { campaign_id: 'b7000000-0000-4000-8000-000000000002', target_count: 2, granted_count: 2, skipped_count: 0, sample_names: ['가게 하나'] }, error: null })
})

describe('일괄 지급 API', () => {
  it('전역 승인 권한이 없으면 두 작업 모두 특권 DB를 호출하지 않는다', async () => {
    mocks.guard.mockRejectedValue(new OperatorAccessError('PERMISSION_DENIED'))
    expect((await POST(request('', {}))).status).toBe(403)
    expect((await preview(request('/preview', {}))).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('검증 오류와 초과 지급 및 잘못된 멱등키를 한국어로 거부한다', async () => {
    for (const body of [
      { audience: 'all_active', amount: 50001, reason: '확인', idempotencyKey: 'valid-key-123' },
      { audience: 'all_active', amount: 10, reason: ' ', idempotencyKey: 'valid-key-123' },
      { audience: 'recent_signups', recentDays: 31, amount: 10, reason: '확인', idempotencyKey: 'valid-key-123' },
      { audience: 'all_active', amount: 10, reason: '확인', idempotencyKey: 'bulk:illegal' },
    ]) {
      const response = await POST(request('', body))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/[가-힣]/)
    }
    expect((await preview(request('/preview', { audience: 'recent_signups', recentDays: 0 }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('대상 미리보기와 지급을 각각 서비스 전용 RPC로 호출하고 결과를 응답한다', async () => {
    const input = { audience: 'recent_signups', recentDays: 7, amount: 25, reason: ' 신규 환영 ', idempotencyKey: 'grant-key-123' }
    const a = await preview(request('/preview', { audience: input.audience, recentDays: input.recentDays }))
    expect(a.status).toBe(200)
    expect((await a.json()).target_count).toBe(2)
    const b = await POST(request('', input))
    expect(b.status).toBe(200)
    expect((await b.json()).granted_count).toBe(2)
    expect(mocks.rpc).toHaveBeenCalledWith('grant_bulk_credits', { p_operator_id: actor, p_audience: 'recent_signups', p_recent_days: 7, p_amount: 25, p_reason: '신규 환영', p_idempotency_key: 'grant-key-123' })
  })
  it('DB 실패를 성공으로 포장하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const response = await POST(request('', { audience: 'all_active', amount: 20, reason: '환영', idempotencyKey: 'valid-key-123' }))
    expect(response.status).toBe(500)
    expect((await response.json()).error).toMatch(/[가-힣]/)
  })
})
