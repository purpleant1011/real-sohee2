import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const authorize = vi.hoisted(() => vi.fn())
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))

import { GET } from './route'

const params = { params: Promise.resolve({ workspaceId: 'ws' }) }

describe('GET mobile-campaigns', () => {
  beforeEach(() => authorize.mockReset())

  it('인증 실패 응답은 그대로 돌려준다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(new Request('http://x'), params)).status).toBe(401)
  })

  it('매니저 권한을 요구한다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    await GET(new Request('http://x'), params)
    expect(authorize).toHaveBeenCalledWith('ws', { requireRole: 'manager' })
  })

  it('원본 미연결이면 빈 200 이 아니라 503 + unknown, 인증된 매장 id 로만 답한다', async () => {
    authorize.mockResolvedValue({ userId: 'u', workspaceId: 'ws-resolved', role: 'manager' })
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(503)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ workspaceId: 'ws-resolved', loadState: 'unknown', sourceConnected: false, candidates: [] })
  })

  it('dataset_mode 가 ACTUAL 이 아니면 503 + unknown (fail-closed)', async () => {
    const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { dataset_mode: 'SHOWCASE_DEMO' }, error: null }) }
    authorize.mockResolvedValue({ userId: 'u', workspaceId: 'ws-resolved', role: 'manager', supabase: { from: () => qb } })
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ workspaceId: 'ws-resolved', loadState: 'unknown', sourceConnected: false, candidates: [] })
  })
})
