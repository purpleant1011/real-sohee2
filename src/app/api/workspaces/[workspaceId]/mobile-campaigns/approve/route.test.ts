import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const authorize = vi.hoisted(() => vi.fn())
const approveCampaign = vi.hoisted(() => vi.fn())

vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))
// 코어 로직은 단위 테스트(approve-campaign.test.ts)가 담당한다. 라우트 테스트는 상태코드·헤더·본문 계약만 본다.
vi.mock('@/features/mobile-campaigns/server/approve-campaign', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/mobile-campaigns/server/approve-campaign')>()
  return { ...actual, approveCampaign }
})

import { POST } from './route'

const params = { params: Promise.resolve({ workspaceId: 'ws-path' }) }
const RESOLVED_WS = 'ws-resolved'
const FINGERPRINT = 'a'.repeat(64)

function request(opts: { key?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (typeof opts.key === 'string') headers['Idempotency-Key'] = opts.key
  return new Request('http://x/api', {
    method: 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

const validBody = {
  proposalId: `campaign:${RESOLVED_WS}:slot-1`,
  slotId: 'slot-1',
  expectedFingerprint: FINGERPRINT,
}

describe('POST mobile-campaigns/approve', () => {
  beforeEach(() => {
    authorize.mockReset()
    approveCampaign.mockReset()
    authorize.mockResolvedValue({ userId: 'u', workspaceId: RESOLVED_WS, role: 'manager', supabase: {} })
  })

  it('인증 실패 응답은 그대로 돌려준다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    const res = await POST(request({ key: 'k', body: validBody }), params)
    expect(res.status).toBe(401)
    expect(approveCampaign).not.toHaveBeenCalled()
  })

  it('매니저 권한을 요구한다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await POST(request({ key: 'k', body: validBody }), params)
    expect(res.status).toBe(403)
    expect(authorize).toHaveBeenCalledWith('ws-path', { requireRole: 'manager' })
  })

  it('Idempotency-Key 가 없으면 422 이고 아무것도 쓰지 않는다', async () => {
    const res = await POST(request({ body: validBody }), params)
    expect(res.status).toBe(422)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'MISSING_IDEMPOTENCY_KEY' })
    expect(approveCampaign).not.toHaveBeenCalled()
  })

  it('본문에 모르는 키가 있으면 422', async () => {
    const res = await POST(request({ key: 'k', body: { ...validBody, extra: 'x' } }), params)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(approveCampaign).not.toHaveBeenCalled()
  })

  it('인증된 매장과 무관한 제안 id 는 422 로 거부한다', async () => {
    const res = await POST(request({ key: 'k', body: { ...validBody, proposalId: 'campaign:other-ws:slot-1' } }), params)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(approveCampaign).not.toHaveBeenCalled()
  })

  it('경쟁에서 지면 409 + no-store 를 그대로 내려준다', async () => {
    approveCampaign.mockResolvedValue({ status: 409, body: { error: 'SLOT_ALREADY_RESERVED' } })
    const res = await POST(request({ key: 'k', body: validBody }), params)
    expect(res.status).toBe(409)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'SLOT_ALREADY_RESERVED' })
  })

  it('승인 성공은 200 + no-store 이고, 경로가 아니라 인증이 확정한 매장·본문 값으로 호출한다', async () => {
    approveCampaign.mockResolvedValue({
      status: 200,
      body: { approved: true, decidedAt: '2026-10-24T12:00:00.000Z', externalPublishCount: 0 },
    })
    const res = await POST(request({ key: 'key-1', body: validBody }), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({
      approved: true,
      decidedAt: '2026-10-24T12:00:00.000Z',
      externalPublishCount: 0,
    })
    expect(approveCampaign).toHaveBeenCalledWith(
      {
        workspaceId: RESOLVED_WS,
        proposalId: validBody.proposalId,
        slotId: validBody.slotId,
        expectedFingerprint: FINGERPRINT,
        idempotencyKey: 'key-1',
      },
      expect.anything(),
    )
  })
})
