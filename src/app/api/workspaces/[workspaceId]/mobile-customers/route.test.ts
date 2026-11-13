import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { authorize, dataset } = vi.hoisted(() => ({ authorize: vi.fn(), dataset: vi.fn() }))
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))
vi.mock('@/features/reporting/dataset', () => ({ readWorkspaceDataset: dataset }))

import { GET } from './route'

const params = (workspaceId: string) => ({ params: Promise.resolve({ workspaceId }) })
const from = vi.fn()
function supabase(tables: Record<string, Array<Record<string, unknown>> | null>) {
  return {
    from(table: string) {
      from(table)
      let ws: string | null = null
      const qb: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'order']) qb[m] = () => qb
      qb.eq = (_c: string, v: string) => { ws = v; return qb }
      qb.limit = async () => {
        const rows = tables[table]
        return rows ? { data: rows.filter(r => r.workspace_id === ws), error: null } : { data: null, error: { message: 'x' } }
      }
      return qb
    },
  }
}
const auth = (supabaseClient: unknown) => ({ userId: 'u', workspaceId: 'ws-a', role: 'manager', supabase: supabaseClient, admin: {} })

const conv = (workspace_id: string, label: string) => ({
  id: `c-${workspace_id}`, workspace_id, customer_id: null, display_label: label, channel: 'naver_place', status: 'open',
  latest_message_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_anonymized: false,
})

describe('GET mobile-customers', () => {
  beforeEach(() => {
    authorize.mockReset()
    from.mockReset()
    dataset.mockReset().mockResolvedValue({ mode: 'ACTUAL', state: 'OBSERVED' })
  })

  it('인증 실패 응답은 그대로 돌려주고 DB 를 조회하지 않는다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }))
    expect((await GET(new Request('http://x'), params('ws-a'))).status).toBe(401)
    expect(dataset).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('다른 workspace 를 요청한 비구성원은 403 이고 조회하지 않는다', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await GET(new Request('http://x'), params('ws-b'))
    expect(res.status).toBe(403)
    expect(dataset).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('정상이면 200 + no-store, 인증이 확정한 workspace 고객만 내려간다', async () => {
    const tables = { customer_conversations: [conv('ws-a', '김가게'), conv('ws-b', '이타가게')], customer_opt_outs: [] }
    authorize.mockResolvedValue(auth(supabase(tables)))
    const res = await GET(new Request('http://x'), params('ws-b')) // 경로는 ws-b 여도 인증 결과(ws-a)만 쓴다
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.workspaceId).toBe('ws-a')
    expect(body.customers.map((c: { displayName: string }) => c.displayName)).toEqual(['김가게'])
    expect(JSON.stringify(body)).not.toContain('이타가게')
    // 분류 조회도 인증이 확정한 workspace 로만 한다.
    expect(dataset).toHaveBeenCalledWith({}, 'ws-a')
  })

  it('DB 오류는 빈 목록 200 이 아니라 503 + error', async () => {
    authorize.mockResolvedValue(auth(supabase({ customer_conversations: null, customer_opt_outs: [] })))
    const res = await GET(new Request('http://x'), params('ws-a'))
    expect(res.status).toBe(503)
    expect((await res.json()).loadState).toBe('error')
  })

  it.each([
    ['EXCLUDED', 'NOT_OBSERVED'],
    ['UNKNOWN', 'NOT_OBSERVED'],
  ])('분류가 %s 이면 실제 고객 데이터를 조회하지 않고 503 + error', async (mode, state) => {
    dataset.mockResolvedValue({ mode, state })
    authorize.mockResolvedValue(auth(supabase({ customer_conversations: [conv('ws-a', '시연고객')], customer_opt_outs: [] })))
    const res = await GET(new Request('http://x'), params('ws-a'))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.loadState).toBe('error')
    expect(body.customers).toEqual([])
    expect(JSON.stringify(body)).not.toContain('시연고객')
    expect(from).not.toHaveBeenCalled()
  })

  it('분류 조회가 실패하면 실제 데이터 없이 503 + error', async () => {
    dataset.mockResolvedValue({ mode: 'UNKNOWN', state: 'ERROR' })
    authorize.mockResolvedValue(auth(supabase({ customer_conversations: [conv('ws-a', '시연고객')], customer_opt_outs: [] })))
    const res = await GET(new Request('http://x'), params('ws-a'))
    expect(res.status).toBe(503)
    expect((await res.json()).loadState).toBe('error')
    expect(from).not.toHaveBeenCalled()
  })
})
