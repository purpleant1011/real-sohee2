import { describe, expect, it } from 'vitest'
import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'
import { contactCtas, campaignAudience } from '../customer-model'
import { readCustomerSource } from './customer-source'
import { readMobileCustomers } from './read-customers'

const NOW = '2026-10-24T09:00:00.000Z'
const A = 'ws-a'
const B = 'ws-b'
const now = () => NOW

type Row = Record<string, unknown>
/** workspace_id eq 필터를 적용하는 가짜 클라이언트. selected 컬럼 목록도 기록한다. */
function fakeClient(tables: Record<string, Row[]>, opts: { leakFilter?: boolean; failOn?: string } = {}) {
  const selects: Record<string, string> = {}
  const workspaceFilters: Record<string, string> = {}
  const client: InboxClient = {
    from(table) {
      let ws: string | null = null
      const qb: any = {
        select: (cols: string) => { selects[table] = cols; return qb },
        eq: (_c: string, v: string) => { ws = v; workspaceFilters[table] = v; return qb },
        in: () => qb,
        order: () => qb,
        limit: async () => opts.failOn === table
          ? { data: null, error: { message: 'x' } }
          : { data: (tables[table] ?? []).filter(r => opts.leakFilter || r.workspace_id === ws), error: null },
      }
      return qb
    },
  }
  return { client, selects, workspaceFilters }
}

const conv = (o: Row = {}): Row => ({
  id: 'c1', workspace_id: A, customer_id: 'cust-1', display_label: '김민지', channel: 'instagram', status: 'open',
  latest_message_at: '2026-10-24T08:00:00Z', updated_at: '2026-10-24T08:00:00Z', is_anonymized: false, ...o,
})
const optOut = (o: Row = {}): Row => ({ workspace_id: A, customer_id: 'cust-9', opted_out_at: '2026-10-20T00:00:00Z', source: 'customer_request', ...o })

async function read(tables: Record<string, Row[]>, opts: Parameters<typeof fakeClient>[1] = {}, ws = A) {
  const { client, selects, workspaceFilters } = fakeClient(tables, opts)
  const result = await readMobileCustomers({ workspaceId: ws, userId: 'u' }, {
    now, datasetMode: 'ACTUAL', readCustomers: ctx => readCustomerSource(client, ctx.workspaceId, { now }),
  })
  return { result, selects, workspaceFilters }
}

describe('고객 읽기 의미 정의', () => {
  it('수신거부 원장이 없으면 동의를 단정하지 않고 unknown, 연락처도 비어 CTA 는 전부 비활성', async () => {
    const { result } = await read({ customer_conversations: [conv()], customer_opt_outs: [] })
    const c = result.snapshot.customers[0]
    expect(c.consent).toEqual({ status: 'unknown', checkedAt: null, source: null })
    expect(c.verifiedContacts).toEqual([])
    expect(contactCtas(c).every(x => !x.enabled)).toBe(true)
    expect(campaignAudience(result.snapshot.customers, A)).toEqual([])
  })

  it('수신거부 행이 있으면 withdrawn, 이름은 서버에서 마스킹, 출처는 사용자용 라벨', async () => {
    const { result } = await read({ customer_conversations: [conv({ customer_id: 'cust-9' })], customer_opt_outs: [optOut()] })
    const c = result.snapshot.customers[0]
    expect(c.consent).toEqual({ status: 'withdrawn', checkedAt: '2026-10-20T00:00:00.000Z', source: '고객 요청' })
    expect(c.displayName).toBe('김○지')
  })

  it('customer_id 가 없으면 원장과 대조할 수 없어 unknown', async () => {
    const { result } = await read({ customer_conversations: [conv({ customer_id: null })], customer_opt_outs: [optOut()] })
    expect(result.snapshot.customers[0].consent.status).toBe('unknown')
  })

  it('다른 가게의 수신거부 행은 이 가게 고객에 적용되지 않는다', async () => {
    const { result } = await read({ customer_conversations: [conv({ customer_id: 'cust-9' })], customer_opt_outs: [optOut({ workspace_id: B })] })
    expect(result.snapshot.customers[0].consent.status).toBe('unknown')
  })

  it('익명화된 행은 목록에서 빠지고, 연락처·요약 컬럼은 select 하지 않는다', async () => {
    const { result, selects } = await read({ customer_conversations: [conv({ is_anonymized: true }), conv({ id: 'c2' })], customer_opt_outs: [] })
    expect(result.snapshot.customers.map(c => c.id)).toEqual(['c2'])
    expect(selects.customer_conversations).not.toMatch(/summary|content|phone|email|hash/)
    expect(JSON.stringify(result.snapshot)).not.toMatch(/phone":"|email|@/)
  })
})

describe('한 사람은 목록에 한 번만 나온다', () => {
  // 원천은 상담(대화) 행이다. 한 고객이 상담을 여러 번 하면 행이 여러 개 온다.
  // 그대로 그리면 같은 사장님 고객이 목록에 두 번, 세 번 나온다.
  it('같은 customer_id 의 상담이 여러 건이면 최근 상담 한 건만 남는다', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c-old', customer_id: 'cust-1', latest_message_at: '2026-10-20T01:00:00Z', status: 'resolved' }),
        conv({ id: 'c-new', customer_id: 'cust-1', latest_message_at: '2026-10-24T08:00:00Z', status: 'open' }),
      ],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers).toHaveLength(1)
    expect(result.snapshot.customers[0].id).toBe('c-new')
    expect(result.snapshot.customers[0].lastAction?.label).toBe('상담 진행 중')
  })

  it('customer_id 가 없는 행은 서로 다른 사람으로 취급해 합치지 않는다', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c1', customer_id: null, latest_message_at: '2026-10-24T08:00:00Z' }),
        conv({ id: 'c2', customer_id: null, latest_message_at: '2026-10-24T07:00:00Z' }),
      ],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('customer_uuid가 동일하면 채널이나 customer_id가 달라도 하나의 정본 고객으로 묶인다', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c-ig', customer_id: 'cust-ig', customer_uuid: 'uuid-1', latest_message_at: '2026-10-20T01:00:00Z', channel: 'instagram' }),
        conv({ id: 'c-threads', customer_id: 'cust-th', customer_uuid: 'uuid-1', latest_message_at: '2026-10-24T08:00:00Z', channel: 'threads' }),
      ],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers).toHaveLength(1)
    expect(result.snapshot.customers[0].id).toBe('c-threads')
    expect(result.snapshot.customers[0].customerUuid).toBe('uuid-1')
  })

  it('중복을 합쳐도 전체를 읽었다는 표시는 유지된다', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c1', customer_id: 'cust-1' }),
        conv({ id: 'c2', customer_id: 'cust-1' }),
      ],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers).toHaveLength(1)
    expect(result.snapshot.complete).toBe(true)
  })

  // W10r 반례: 계약을 못 지킨 행이 '중복'이라는 이유로 dedupe 단계에서 먼저 사라지면
  // rejectedRows 가 0 이 되고 complete=true 가 된다. 같은 malformed 행도 customer_id 가 다르면
  // rejected=1 이므로, 중복 상황에서만 '전체를 읽었다'는 주장이 과대해진다.
  it('중복으로 합쳐진 행이 계약을 못 지켰다면 여전히 rejected 로 센다', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c-new', customer_id: 'cust-1', latest_message_at: '2026-10-24T08:00:00Z' }),
        conv({ id: 'c-old', customer_id: 'cust-1', display_label: null, latest_message_at: '2026-10-20T01:00:00Z' }),
      ],
      customer_opt_outs: [],
    })

    // 보여줄 고객은 정상 1명이지만, 읽은 행 중 계약 위반이 있었으므로 완전한 목록이 아니다.
    expect(result.snapshot.customers).toHaveLength(1)
    expect(result.rejectedRows).toBe(1)
    expect(result.snapshot.complete).toBe(false)
  })

  it('중복 행이 모두 정상이면 rejected 는 0 이다(회귀)', async () => {
    const { result } = await read({
      customer_conversations: [
        conv({ id: 'c-new', customer_id: 'cust-1', latest_message_at: '2026-10-24T08:00:00Z' }),
        conv({ id: 'c-old', customer_id: 'cust-1', latest_message_at: '2026-10-20T01:00:00Z' }),
      ],
      customer_opt_outs: [],
    })

    expect(result.rejectedRows).toBe(0)
    expect(result.snapshot.complete).toBe(true)
  })
})

describe('익명화 신호가 섞인 고객 그룹 (가역 안전 fallback)', () => {
  // 정책 정본 미확정: 익명화가 '고객 단위 삭제 요청'인지 '대화 단위'인지 정해지지 않았다.
  // 그래서 삭제를 단정하지 않고, 같은 (workspace, customer_id) 안에 익명화 신호가 하나라도 있으면
  // 옛 비익명 행의 이름·최근 진행만 보수적으로 감춘다. 정책이 확정되면 되돌릴 수 있는 조치다.
  const mixed = (o: Row = {}) => conv({ customer_id: 'cust-1', ...o })

  it('최신 행이 익명이면 옛 비익명 행의 이름과 최근 진행을 노출하지 않는다', async () => {
    const { result } = await read({
      customer_conversations: [
        mixed({ id: 'c-new', is_anonymized: true, latest_message_at: '2026-10-24T08:00:00Z' }),
        mixed({ id: 'c-old', display_label: '김민지', status: 'open', latest_message_at: '2026-10-20T01:00:00Z' }),
      ],
      customer_opt_outs: [],
    })

    expect(JSON.stringify(result.snapshot)).not.toContain('김민지')
    expect(result.snapshot.customers.every(c => c.lastAction === null)).toBe(true)
    expect(result.snapshot.customers.every(c => c.sourceLabel === null)).toBe(true)
  })

  it('숨김을 "고객 없음"이나 "삭제 완료"로 단정하지 않는다 — partial 로 남긴다', async () => {
    const { result } = await read({
      customer_conversations: [
        mixed({ id: 'c-new', is_anonymized: true }),
        mixed({ id: 'c-old', display_label: '김민지' }),
      ],
      customer_opt_outs: [],
    })

    // 고객 자체는 목록에 남아 있지만 완전한 목록이라고 주장하지 않는다.
    expect(result.snapshot.customers).toHaveLength(1)
    expect(result.snapshot.complete).toBe(false)
  })

  it('익명화 신호가 없으면 이름과 최근 진행을 그대로 보여준다(회귀)', async () => {
    const { result } = await read({
      customer_conversations: [mixed({ id: 'c1', display_label: '김민지', status: 'open' })],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers[0].displayName).toBe('김민지')
    expect(result.snapshot.customers[0].lastAction).not.toBeNull()
    expect(result.snapshot.complete).toBe(true)
  })

  it('다른 workspace 의 익명화 신호는 이 가게 그룹을 감추지 않는다', async () => {
    const { result } = await read({
      customer_conversations: [
        mixed({ id: 'c1', display_label: '김민지', status: 'open' }),
        mixed({ id: 'b1', workspace_id: B, is_anonymized: true }),
      ],
      customer_opt_outs: [],
    })

    expect(result.snapshot.customers[0].displayName).toBe('김민지')
    expect(result.snapshot.complete).toBe(true)
  })

  it('감춰도 계약 위반 감지 신호는 그대로 센다', async () => {
    const { result } = await read({
      customer_conversations: [
        mixed({ id: 'c-new', is_anonymized: true }),
        mixed({ id: 'c-bad', display_label: null }),
      ],
      customer_opt_outs: [],
    })

    expect(result.rejectedRows).toBe(1)
    expect(result.snapshot.complete).toBe(false)
  })
})

describe('workspace 경계', () => {
  it('다른 workspace 행은 조회 단계에서 걸러진다', async () => {
    const { result } = await read({ customer_conversations: [conv(), conv({ id: 'x', workspace_id: B, display_label: '이타가게' })], customer_opt_outs: [] })
    expect(result.snapshot.customers.map(c => c.id)).toEqual(['c1'])
  })

  it('필터가 새도(RLS 실패 가정) 어댑터가 다른 workspace 줄을 버리고 partial 로 알린다', async () => {
    const { result } = await read({ customer_conversations: [conv(), conv({ id: 'x', workspace_id: B, display_label: '이타가게' })], customer_opt_outs: [] }, { leakFilter: true })
    expect(result.snapshot.customers.map(c => c.id)).toEqual(['c1'])
    expect(result.rejectedRows).toBe(1)
    expect(result.snapshot.complete).toBe(false)
  })

  it('상담·수신거부 조회 모두 인증이 확정한 workspace 로만 필터한다', async () => {
    const { result, workspaceFilters } = await read({ customer_conversations: [conv(), conv({ id: 'x', workspace_id: B })], customer_opt_outs: [] }, {}, B)
    expect(workspaceFilters.customer_conversations).toBe(B)
    expect(workspaceFilters.customer_opt_outs).toBe(B)
    expect(result.snapshot.workspaceId).toBe(B)
    expect(result.snapshot.customers.map(c => c.id)).toEqual(['x'])
  })

  it('다른 사업장 고객만 있으면 이 사업장 목록은 0건이지, 남의 고객이 새지 않는다', async () => {
    const { result } = await read({ customer_conversations: [conv({ workspace_id: B }), conv({ id: 'x', workspace_id: B })], customer_opt_outs: [] }, {}, A)
    expect(result.snapshot.customers).toEqual([])
    expect(result.snapshot.loadState).toBe('ready')
  })
})

describe('실패·상태', () => {
  it('상담 조회 실패도 원장 조회 실패도 빈 목록이 아니라 error', async () => {
    for (const failOn of ['customer_conversations', 'customer_opt_outs']) {
      const { result } = await read({ customer_conversations: [conv()], customer_opt_outs: [] }, { failOn })
      expect(result.ok).toBe(false)
      expect(result.snapshot.loadState).toBe('error')
      expect(result.snapshot.customers).toEqual([])
    }
  })

  it('ACTUAL 이 아닌 데이터셋은 통째로 거부', async () => {
    const r = await readMobileCustomers({ workspaceId: A, userId: 'u' }, { now, datasetMode: 'DEMO', readCustomers: async () => { throw new Error('호출되면 안 됨') } })
    expect(r.ok).toBe(false)
  })

  it('페이지 한도에 닿으면 complete=false, 읽은 시각이 오래되면 stale', async () => {
    const many = Array.from({ length: 100 }, (_, i) => conv({ id: `c${i}` }))
    const { result } = await read({ customer_conversations: many, customer_opt_outs: [] })
    expect(result.snapshot.complete).toBe(false)
    const stale = await readMobileCustomers({ workspaceId: A, userId: 'u' }, {
      now, datasetMode: 'ACTUAL', readCustomers: async () => ({ rows: [], keys: [], complete: true, observedAt: '2026-10-24T08:00:00.000Z' }),
    })
    expect(stale.snapshot.loadState).toBe('stale')
  })
})
