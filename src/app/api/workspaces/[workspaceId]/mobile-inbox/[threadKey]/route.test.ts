import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const authorize = vi.hoisted(() => vi.fn())
vi.mock('@/features/quick-start/route-auth', () => ({
  authorizeQuickRequest: authorize,
  isResponse: (v: unknown) => v instanceof Response,
}))

import { GET } from './route'

const WS = 'ws'
const ID = '11111111-1111-4111-8111-111111111111'
const KEY = `dm:${ID}`

function params(threadKey: string) {
  return { params: Promise.resolve({ workspaceId: WS, threadKey }) }
}
type Tables = Record<string, { data?: unknown; error?: unknown }>
type Order = [column: string, ascending: boolean]
type Filter =
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'in'; column: string; values: unknown[] }

const fromSpy = vi.fn()

function supabase(tables: Tables = {}) {
  return {
    from(table: string) {
      fromSpy(table)
      const appliedOrders: Order[] = []
      const appliedFilters: Filter[] = []
      const compare = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
        for (const [column, ascending] of appliedOrders) {
          const x = String(a[column] ?? '')
          const y = String(b[column] ?? '')
          if (x === y) continue
          const d = x < y ? -1 : 1
          return ascending ? d : -d
        }
        return 0
      }
      const qb: Record<string, unknown> = {}
      for (const m of ['select']) qb[m] = () => qb
      qb.eq = (c: string, v: unknown) => {
        appliedFilters.push({ type: 'eq', column: c, value: v })
        return qb
      }
      qb.in = (c: string, vs: unknown[]) => {
        appliedFilters.push({ type: 'in', column: c, values: vs })
        return qb
      }
      qb.order = (c: string, o: { ascending: boolean }) => {
        appliedOrders.push([c, o.ascending])
        return qb
      }
      qb.limit = async (n?: number) => {
        let rows = [...((tables[table]?.data ?? []) as Array<Record<string, unknown>>)]
        for (const f of appliedFilters) {
          if (f.type === 'eq') {
            rows = rows.filter(r => String(r[f.column] ?? '') === String(f.value ?? ''))
          } else if (f.type === 'in') {
            const set = new Set(f.values.map(v => String(v ?? '')))
            rows = rows.filter(r => set.has(String(r[f.column] ?? '')))
          }
        }
        if (appliedOrders.length > 0) rows.sort(compare)
        return { data: (typeof n === 'number' ? rows.slice(0, n) : rows) as never, error: (tables[table]?.error ?? null) as never }
      }
      return qb
    },
  }
}
const authored = (tables?: Tables) => authorize.mockResolvedValue({ userId: 'u', workspaceId: WS, role: 'manager', supabase: supabase(tables) })
const thread = { id: ID, workspace_id: WS, customer_handle: 'minji', customer_name: '김민지', last_message_at: '2026-10-23T08:50:00Z', expires_at: '2026-10-24T08:50:00Z', status: 'NEEDS_REPLY', last_message_text: '마지막' }
const ok = (): Tables => ({
  instagram_dm_threads: { data: [thread] },
  instagram_dm_messages: { data: [{ id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '예약 되나요', sent_at: '2026-10-23T08:49:00Z' }] },
  instagram_dm_drafts: { data: [{ workspace_id: WS, thread_id: ID, draft_text: '가능해요', updated_at: '2026-10-23T08:55:00Z' }] },
})

describe('GET mobile-inbox/[threadKey]', () => {
  beforeEach(() => {
    authorize.mockReset()
    fromSpy.mockReset()
  })

  it('인증 실패(401) 응답은 그대로 돌려주고 underlying from/query 를 전혀 호출하지 않는다 (호출 0건)', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(401)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('권한 부족(403) 응답도 그대로 돌려주고 underlying from/query 를 전혀 호출하지 않는다 (호출 0건)', async () => {
    authorize.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(403)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('정상이면 200 + no-store + 원문·답안·지문', async () => {
    authored(ok())
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body.thread.id).toBe(KEY)
    expect(body.messages.map((m: { text: string }) => m.text)).toEqual(['예약 되나요'])
    expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(body.delivery).toBe('none')
  })

  it('인코딩된 키(dm%3A…)도 풀어서 같은 대화를 연다', async () => {
    authored(ok())
    expect((await GET(new Request('http://x'), params(encodeURIComponent(KEY)))).status).toBe(200)
  })

  it('잘못된 이스케이프는 500 이 아니라 400(잘못된 키)이다', async () => {
    authored(ok())
    const res = await GET(new Request('http://x'), params('%E0%A4%A'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad_key')
  })

  it('없는 대화는 404, DB 오류는 503 으로 구분한다', async () => {
    authored({})
    expect((await GET(new Request('http://x'), params(KEY))).status).toBe(404)
    authored({ instagram_dm_threads: { data: null, error: { message: 'x' } } })
    expect((await GET(new Request('http://x'), params(KEY))).status).toBe(503)
  })

  it('다른 가게 관리자 권한으로만 조회한다', async () => {
    authored(ok())
    await GET(new Request('http://x'), params(KEY))
    expect(authorize).toHaveBeenCalledWith(WS, { requireRole: 'manager' })
  })

  it('다른 workspace 의 대화는 404 not_found 로 격리한다', async () => {
    authored({
      instagram_dm_threads: { data: [{ ...thread, workspace_id: 'other-ws' }] },
    })
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('201건 메시지가 있을 때 최신 200건만 시간 오름차순으로 반환하고 가장 오래된 201번째는 제외하며 complete=false 로 절단을 알린다', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `m${String(i).padStart(3, '0')}`, workspace_id: WS, thread_id: ID, sender_type: 'customer', text: `글 ${i}`,
      sent_at: new Date(Date.UTC(2026, 9, 22, 0, 200 - i, 0)).toISOString(),
    }))
    authored({
      ...ok(),
      instagram_dm_messages: { data: rows },
    })
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages).toHaveLength(200)
    expect(body.complete).toBe(false)
    // 가장 오래된 201번째(글 200, m200)는 제외되고, 시간 오름차순으로 정렬되어 첫 글은 '글 199', 마지막 글은 '글 0'
    expect(body.messages[0].text).toBe('글 199')
    expect(body.messages[199].text).toBe('글 0')
    expect(body.messages.some((m: { text: string }) => m.text === '글 200')).toBe(false)
  })

  it('route 호출 시 다른 workspace/thread 데이터가 섞여 있어도 eq 필터링으로 대상 thread 메시지만 격리한다', async () => {
    const OTHER_WS = 'other-ws'
    const OTHER_THREAD = '22222222-2222-4222-8222-222222222222'
    authored({
      instagram_dm_threads: { data: [
        { ...thread, workspace_id: OTHER_WS, id: ID },
        { ...thread, workspace_id: WS, id: OTHER_THREAD },
        thread,
      ] },
      instagram_dm_messages: { data: [
        { id: 'm-other-ws', workspace_id: OTHER_WS, thread_id: ID, sender_type: 'customer', text: '타가게글', sent_at: '2026-10-23T08:40:00Z' },
        { id: 'm-other-th', workspace_id: WS, thread_id: OTHER_THREAD, sender_type: 'customer', text: '타대화글', sent_at: '2026-10-23T08:41:00Z' },
        { id: 'm-target', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '예약 되나요', sent_at: '2026-10-23T08:49:00Z' },
      ] },
      instagram_dm_drafts: { data: [
        { workspace_id: OTHER_WS, thread_id: ID, draft_text: '남의초안' },
        { workspace_id: WS, thread_id: ID, draft_text: '가능해요', updated_at: '2026-10-23T08:55:00Z' },
      ] },
    })
    const res = await GET(new Request('http://x'), params(KEY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m-target'])
    expect(body.thread.draft.text).toBe('가능해요')
  })
})
