import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { authorize, dataset } = vi.hoisted(() => ({ authorize: vi.fn(), dataset: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))
vi.mock('@/features/reporting/dataset', () => ({ readWorkspaceDataset: dataset }))

import { GET } from './route'

const params = { params: Promise.resolve({ workspaceId: 'ws' }) }
const from = vi.fn()
/** 조회 표를 흉내 낸다. limit() 이 표의 행을 돌려준다. */
function supabase(tables: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    from(table: string) {
      from(table)
      const qb: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order']) qb[m] = () => qb
      qb.limit = async () => ({ data: tables[table] ?? [], error: null })
      return qb
    },
  }
}
const auth = (supabaseClient: unknown = supabase()) => ({
  userId: 'u', workspaceId: 'ws', role: 'manager', supabase: supabaseClient, admin: {},
})
const at = '2026-10-24T00:00:00.000Z'
const threadRow = {
  id: 't1', workspace_id: 'ws', channel: 'instagram_dm', customer_handle: 'demo',
  customer_name: '시연고객', last_message_at: at, expires_at: at, status: 'NEEDS_REPLY', last_message_text: '안녕하세요',
}

describe('GET mobile-inbox', () => {
  beforeEach(() => {
    authorize.mockReset()
    from.mockReset()
    dataset.mockReset().mockResolvedValue({ mode: 'ACTUAL', state: 'OBSERVED' })
  })

  it('인증 실패 응답은 그대로 돌려준다(조회하지 않음)', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(new Request('http://x'), params)).status).toBe(401)
    expect(dataset).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it('정상이면 200 + no-store + ready 스냅샷', async () => {
    authorize.mockResolvedValue(auth(supabase({ instagram_dm_threads: [threadRow] })))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect((await res.json()).loadState).toBe('ready')
  })
  it('DB 오류는 빈 목록 200 이 아니라 503 + error', async () => {
    const client = {
      from(table: string) {
        from(table)
        const qb: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'order']) qb[m] = () => qb
        qb.limit = async () => ({ data: null, error: { message: 'x' } })
        return qb
      },
    }
    authorize.mockResolvedValue(auth(client))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(503)
    expect((await res.json()).loadState).toBe('error')
  })

  it('ACTUAL 확인 뒤에만 원본 테이블을 조회한다', async () => {
    authorize.mockResolvedValue(auth(supabase({ instagram_dm_threads: [threadRow] })))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(200)
    // 분류 조회는 인증이 확정한 workspace 로만 한다.
    expect(dataset).toHaveBeenCalledWith({}, 'ws')
    expect(from.mock.calls.map((c: unknown[]) => c[0])).toContain('instagram_dm_threads')
  })

  it.each([
    ['EXCLUDED', 'NOT_OBSERVED'],
    ['UNKNOWN', 'NOT_OBSERVED'],
  ])('분류가 %s 이면 실제 고객 데이터를 조회하지 않고 503 + error', async (mode, state) => {
    dataset.mockResolvedValue({ mode, state })
    authorize.mockResolvedValue(auth(supabase({ instagram_dm_threads: [threadRow] })))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.loadState).toBe('error')
    expect(body.threads).toEqual([])
    expect(JSON.stringify(body)).not.toContain('시연고객')
    // 분류 판정 전에 원본 테이블을 읽지 않는다.
    expect(from).not.toHaveBeenCalled()
  })

  it('분류 조회가 실패하면 실제 데이터 없이 503 + error', async () => {
    dataset.mockResolvedValue({ mode: 'UNKNOWN', state: 'ERROR' })
    authorize.mockResolvedValue(auth(supabase({ instagram_dm_threads: [threadRow] })))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(503)
    expect((await res.json()).loadState).toBe('error')
    expect(from).not.toHaveBeenCalled()
  })
})
