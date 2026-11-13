import { describe, expect, it } from 'vitest'
import { computeDmApprovalFingerprint } from '@/features/engagement/dm/options-generator'
import { readConversationDetail } from './read-detail'
import type { InboxClient, QueryBuilder } from './inbox-source'
import { reviewGate } from '../detail-model'

const WS = 'ws'
const ID = '11111111-1111-4111-8111-111111111111'
const CTX = { workspaceId: WS, userId: 'u' }
const NOW = () => '2026-10-23T09:00:00.000Z'
type Tables = Record<string, { data?: unknown; error?: unknown }>
type Order = [table: string, column: string, ascending: boolean]
type Filter =
  | { type: 'eq'; column: string; value: unknown }
  | { type: 'in'; column: string; values: unknown[] }

/**
 * 조회 빌더 mock. `.order()` 호출을 순서대로 기록하고, `.eq()` / `.in()` 조건을 누적한 뒤,
 * `.limit(n)` 이 필터링과 정렬을 **실제 적용한 뒤** n건으로 자른다.
 * 필터나 정렬을 no-op 으로 두면 workspace/thread 격리 누락이나 경계 비결정성 회귀를 잡을 수 없다.
 */
function client(tables: Tables, log: Array<[string, string, string]> = [], orders: Order[] = []): InboxClient {
  return {
    from(table) {
      const appliedOrders: Order[] = []
      const appliedFilters: Filter[] = []
      const compare = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
        for (const [, column, ascending] of appliedOrders) {
          const x = String(a[column] ?? '')
          const y = String(b[column] ?? '')
          if (x === y) continue
          const d = x < y ? -1 : 1
          return ascending ? d : -d
        }
        return 0
      }
      const qb: QueryBuilder = {
        select: () => qb,
        eq: (c, v) => {
          log.push([table, c, String(v)])
          appliedFilters.push({ type: 'eq', column: c, value: v })
          return qb
        },
        in: (c, vs) => {
          appliedFilters.push({ type: 'in', column: c, values: vs })
          return qb
        },
        order: (c, o) => { const entry: Order = [table, c, o.ascending]; orders.push(entry); appliedOrders.push(entry); return qb },
        limit: async n => {
          let rows = [...((tables[table]?.data ?? []) as Array<Record<string, unknown>>)]
          for (const f of appliedFilters) {
            if (f.type === 'eq') {
              rows = rows.filter(r => String(r[f.column] ?? '') === String(f.value ?? ''))
            } else if (f.type === 'in') {
              const set = new Set(f.values.map(v => String(v ?? '')))
              rows = rows.filter(r => set.has(String(r[f.column] ?? '')))
            }
          }
          rows.sort(compare)
          return { data: (typeof n === 'number' ? rows.slice(0, n) : rows) as never, error: (tables[table]?.error ?? null) as never }
        },
      }
      return qb
    },
  }
}
const thread = (o: Record<string, unknown> = {}) => ({
  id: ID, workspace_id: WS, customer_handle: 'minji', customer_name: '김민지', last_message_at: '2026-10-23T08:50:00+00:00',
  expires_at: '2026-10-24T08:50:00+00:00', status: 'NEEDS_REPLY', last_message_text: '마지막', ...o,
})
const base = (o: Tables = {}): Tables => ({
  instagram_dm_threads: { data: [thread()] },
  instagram_dm_messages: { data: [
    { id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '목요일 예약 되나요', sent_at: '2026-10-23T08:49:00Z' },
    { id: 'm2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '확인할게요', sent_at: '2026-10-23T08:50:00Z' },
  ] },
  instagram_dm_drafts: { data: [{ workspace_id: WS, thread_id: ID, draft_text: '가능해요', selected_option_id: 'o1', options: [{ id: 'o1', sources: ['예약표'] }], updated_at: '2026-10-23T08:55:00Z' }] },
  ...o,
})

describe('readConversationDetail', () => {
  it('쿼리 경계가 깨져 타 가게 메시지가 반환되어도 원문을 노출하지 않는다', async () => {
    const tables = base({ instagram_dm_messages: { data: [{ id: 'foreign', workspace_id: 'other', thread_id: ID, sender_type: 'customer', text: 'private foreign message', sent_at: NOW() }] } })
    const leaky = { from(table: string) { const chain: any = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: tables[table]?.data ?? [], error: null }) }; return chain } } as InboxClient
    const result = await readConversationDetail(leaky, CTX, `dm:${ID}`, { now: NOW })
    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('private foreign message')
  })
  it('원문 전체·답안·근거·서버 재계산 지문을 내려준다', async () => {
    const log: Array<[string, string, string]> = []
    const r = await readConversationDetail(client(base(), log), CTX, `dm:${ID}`, { now: NOW })
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.detail.messages.map(m => m.text)).toEqual(['목요일 예약 되나요', '확인할게요'])
    expect(r.detail.messages[1].fromCustomer).toBe(false)
    expect(r.detail.thread.draft?.sources).toEqual(['예약표'])
    expect(r.detail.fingerprint).toBe(computeDmApprovalFingerprint(WS, ID, '가능해요'))
    expect(r.detail.targetLabel).toBe('인스타그램 DM → 김민지')
    expect(r.detail.thread.consent).toBe('unknown')
    expect(r.detail.thread.sendBlockers).toContain('NO_SEND_SCOPE')
    expect(r.detail.complete).toBe(true)
    expect(log.every(([, c, v]) => (c === 'workspace_id' && v === WS) || c === 'id' || c === 'thread_id')).toBe(true)
  })
  it('발송 권한이 없으므로 검토 게이트는 막힌다(실발송 경로 없음)', async () => {
    const r = await readConversationDetail(client(base()), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    const g = reviewGate(r.detail, r.detail.fingerprint)
    expect(g.canProceed).toBe(false)
    expect(g.block).toBe('SEND_BLOCKED')
  })
  it('근거가 저장돼 있지 않으면 빈 배열이고 지문은 그대로', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_drafts: { data: [{ workspace_id: WS, thread_id: ID, draft_text: '가능해요', options: [], updated_at: null }] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.thread.draft?.sources).toEqual([])
    expect(r.detail.version).toBe(0)
  })
  it('답안이 없으면 지문도 없다', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_drafts: { data: [] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect([r.detail.fingerprint, r.detail.thread.draft]).toEqual([null, null])
  })
  it('글자 없는 메시지는 "null" 말풍선을 만들지 않고 건너뛴다', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_messages: { data: [
      { id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '목요일 예약 되나요', sent_at: '2026-10-23T08:49:00Z' },
      { id: 'm2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: null, sent_at: '2026-10-23T08:50:00Z' },
      { id: 'm3', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '   ', sent_at: '2026-10-23T08:51:00Z' },
    ] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.messages.map(m => m.id)).toEqual(['m1'])
    expect(r.detail.messages.some(m => m.text === 'null')).toBe(false)
    // 건너뛴 행이 있으면 '완전히 읽은 대화'가 아니다.
    expect(r.detail.complete).toBe(false)
  })
  it('최신 201건을 내림차순으로 읽어 최신 200건만 남기고 가장 오래된 1건을 버린다', async () => {
    // DB 가 sent_at 내림차순으로 돌려주는 모양(i=0 이 최신, i=200 이 가장 오래됨).
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `m${String(i).padStart(3, '0')}`, workspace_id: WS, thread_id: ID, sender_type: 'customer', text: `글 ${i}`,
      sent_at: new Date(Date.UTC(2026, 9, 22, 0, 200 - i, 0)).toISOString(),
    }))
    const orders: Order[] = []
    const r = await readConversationDetail(client(base({ instagram_dm_messages: { data: rows } }), [], orders), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    const texts = r.detail.messages.map(m => m.text)
    expect(r.detail.messages).toHaveLength(200)
    // 가장 오래된 1건(글 200)은 잘리고, 첫 항목은 두 번째로 오래된 것이며 마지막은 최신이다.
    expect(texts[0]).toBe('글 199')
    expect(texts[texts.length - 1]).toBe('글 0')
    expect(texts).not.toContain('글 200')
    // 절단 판정을 위해 최신 것부터 읽어야 한다(오름차순 limit 이면 오래된 200건만 남는다).
    expect(orders).toEqual([
      ['instagram_dm_messages', 'sent_at', false],
      ['instagram_dm_messages', 'id', false],
    ])
    expect(r.detail.complete).toBe(false)
  })
  it('동일 sent_at 201건이면 id 보조 정렬이 경계 행을 고정해 입력 순서와 무관하게 같은 200건을 남긴다', async () => {
    // 모든 sent_at 이 같아 sent_at 만으로는 200/201번째 경계를 정할 수 없다.
    const rows = Array.from({ length: 201 }, (_, i) => ({
      id: `m${String(i).padStart(3, '0')}`, workspace_id: WS, thread_id: ID, sender_type: 'customer', text: `글 ${i}`,
      sent_at: '2026-10-23T08:50:00Z',
    }))
    const shuffled = [...rows.filter((_, i) => i % 2 === 1), ...rows.filter((_, i) => i % 2 === 0)]
    const first = await readConversationDetail(client(base({ instagram_dm_messages: { data: rows } })), CTX, `dm:${ID}`, { now: NOW })
    const second = await readConversationDetail(client(base({ instagram_dm_messages: { data: shuffled } })), CTX, `dm:${ID}`, { now: NOW })
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('x')
    const a = first.detail.messages.map(m => m.id)
    const b = second.detail.messages.map(m => m.id)
    expect(a).toHaveLength(200)
    // 집합과 순서가 완전히 같아야 한다(경계에서 어느 행이 남는지 고정됨).
    expect(b).toEqual(a)
    expect(new Set(b)).toEqual(new Set(a))
    // (sent_at desc, id desc) 로 최신 200건을 고르고 화면은 id 오름차순이므로 m000 이 잘린다.
    expect(a[0]).toBe('m001')
    expect(a[a.length - 1]).toBe('m200')
    expect(a).not.toContain('m000')
    expect(first.detail.complete).toBe(false)
  })
  it('메시지 조회 정렬키는 sent_at 다음 id 순서로 붙는다', async () => {
    const orders: Order[] = []
    await readConversationDetail(client(base(), [], orders), CTX, `dm:${ID}`, { now: NOW })
    expect(orders).toEqual([
      ['instagram_dm_messages', 'sent_at', false],
      ['instagram_dm_messages', 'id', false],
    ])
  })
  it('200건 이하 대화는 전부 담고 시간 오름차순으로 보여준다(입력 순서 무관)', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_messages: { data: [
      { id: 'm3', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '셋째', sent_at: '2026-10-23T08:51:00Z' },
      { id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '첫째', sent_at: '2026-10-23T08:49:00Z' },
      { id: 'm2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '둘째', sent_at: '2026-10-23T08:50:00Z' },
    ] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.messages.map(m => m.text)).toEqual(['첫째', '둘째', '셋째'])
    expect(r.detail.complete).toBe(true)
  })
  it('같은 시각 메시지는 id 오름차순으로 결정적이고 두 번 호출해도 같다', async () => {
    const same = [
      { id: 'm2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '둘', sent_at: '2026-10-23T08:50:00Z' },
      { id: 'm3', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '셋', sent_at: '2026-10-23T08:50:00Z' },
      { id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '하나', sent_at: '2026-10-23T08:50:00Z' },
    ]
    const first = await readConversationDetail(client(base({ instagram_dm_messages: { data: same } })), CTX, `dm:${ID}`, { now: NOW })
    const second = await readConversationDetail(client(base({ instagram_dm_messages: { data: same } })), CTX, `dm:${ID}`, { now: NOW })
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('x')
    expect(first.detail.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(second.detail.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })
  it('글자 없는 행은 말풍선 없이 omitted 로 세고 complete=false, 글자 있는 행은 남긴다', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_messages: { data: [
      { id: 'm3', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '   ', sent_at: '2026-10-23T08:51:00Z' },
      { id: 'm2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '확인할게요', sent_at: '2026-10-23T08:50:00Z' },
      { id: 'm1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '', sent_at: '2026-10-23T08:49:00Z' },
      { id: 'm0', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: null, sent_at: '2026-10-23T08:48:00Z' },
    ] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.messages.map(m => m.id)).toEqual(['m2'])
    expect(r.detail.messages.some(m => m.text === 'null')).toBe(false)
    expect(r.detail.complete).toBe(false)
  })
  it('원문이 없는 댓글은 빈 대화가 아니라 부분 상태로 내려간다', async () => {
    const r = await readConversationDetail(client({
      social_comments: { data: [{ id: ID, workspace_id: WS, channel: 'instagram', author_handle: 'sy', comment_text: null, comment_created_at: '2026-10-23T08:00:00Z', status: 'DRAFTED' }] },
      comment_reply_drafts: { data: [{ workspace_id: WS, comment_id: ID, draft_text: '안내드려요', updated_at: '2026-10-23T08:30:00Z' }] },
    }), CTX, `comment:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.messages).toEqual([])
    expect(r.detail.complete).toBe(false)
  })
  it('공백뿐인 답안은 답안도 지문도 아니다(fail-closed)', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_drafts: { data: [{ workspace_id: WS, thread_id: ID, draft_text: '   ', options: [{ id: 'o1', sources: ['예약표'] }], updated_at: '2026-10-23T08:55:00Z' }] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect([r.detail.thread.draft, r.detail.fingerprint]).toEqual([null, null])
    expect(reviewGate(r.detail, null).block).toBe('NO_DRAFT')
  })
  it('잘못된 키·종류는 거부, 없는 id/타 가게는 not_found, 읽기 오류는 error', async () => {
    for (const k of ['proposal:' + ID, 'dm:abc', `DM2:${ID}`, '']) {
      expect((await readConversationDetail(client(base()), CTX, k, { now: NOW })).status).toBe('bad_key')
    }
    expect((await readConversationDetail(client(base({ instagram_dm_threads: { data: [] } })), CTX, `dm:${ID}`, { now: NOW })).status).toBe('not_found')
    expect((await readConversationDetail(client(base({ instagram_dm_threads: { data: [thread({ workspace_id: 'other' })] } })), CTX, `dm:${ID}`, { now: NOW })).status).toBe('not_found')
    expect((await readConversationDetail(client(base({ instagram_dm_messages: { data: null, error: { message: 'x' } } })), CTX, `dm:${ID}`, { now: NOW })).status).toBe('error')
  })
  it('SENT 는 전달 확인이 아니라 접수(accepted)로만 표시한다', async () => {
    const r = await readConversationDetail(client(base({ instagram_dm_threads: { data: [thread({ status: 'SENT' })] } })), CTX, `dm:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.delivery).toBe('accepted')
  })
  it('댓글 상세도 같은 규칙(지문 재계산, 발송 막힘)', async () => {
    const r = await readConversationDetail(client({
      social_comments: { data: [{ id: ID, workspace_id: WS, channel: 'instagram', author_handle: 'sy', comment_text: '가격이요?', comment_created_at: '2026-10-23T08:00:00Z', status: 'DRAFTED' }] },
      comment_reply_drafts: { data: [{ workspace_id: WS, comment_id: ID, draft_text: '안내드려요', updated_at: '2026-10-23T08:30:00Z' }] },
    }), CTX, `comment:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(r.detail.thread.channel).toBe('instagram_comment')
    expect(r.detail.targetLabel).toBe('인스타그램 댓글 → sy')
    expect(r.detail.thread.sendBlockers).toEqual(['NO_SEND_SCOPE'])
    expect(r.detail.complete).toBe(true)
  })
  it('댓글 상세도 다른 workspace/comment 데이터가 섞여 있어도 eq 필터링으로 대상 댓글만 격리한다', async () => {
    const OTHER_WS = 'other-workspace'
    const OTHER_COMMENT = '33333333-3333-4333-8333-333333333333'
    const r = await readConversationDetail(client({
      social_comments: { data: [
        { id: ID, workspace_id: OTHER_WS, channel: 'instagram', author_handle: 'other', comment_text: '남의댓글', comment_created_at: '2026-10-23T07:59:00Z', status: 'DRAFTED' },
        { id: OTHER_COMMENT, workspace_id: WS, channel: 'instagram', author_handle: 'other_c', comment_text: '다른댓글', comment_created_at: '2026-10-23T07:59:30Z', status: 'DRAFTED' },
        { id: ID, workspace_id: WS, channel: 'instagram', author_handle: 'sy', comment_text: '가격이요?', comment_created_at: '2026-10-23T08:00:00Z', status: 'DRAFTED' },
      ] },
      comment_reply_drafts: { data: [
        { workspace_id: OTHER_WS, comment_id: ID, draft_text: '남의초안', updated_at: '2026-10-23T08:29:00Z' },
        { workspace_id: WS, comment_id: OTHER_COMMENT, draft_text: '다른댓글초안', updated_at: '2026-10-23T08:29:30Z' },
        { workspace_id: WS, comment_id: ID, draft_text: '안내드려요', updated_at: '2026-10-23T08:30:00Z' },
      ] },
    }), CTX, `comment:${ID}`, { now: NOW })
    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.thread.id).toBe(`comment:${ID}`)
    expect(r.detail.thread.customerName).toBe('sy')
    expect(r.detail.thread.draft?.text).toBe('안내드려요')
    expect(r.detail.messages.map(m => m.text)).toEqual(['가격이요?'])
  })
  it('다른 workspace 와 다른 thread 의 행이 섞여 있어도 eq 필터링으로 대상 대화의 행만 격리한다', async () => {
    const OTHER_WS = 'other-workspace'
    const OTHER_THREAD = '22222222-2222-4222-8222-222222222222'
    const r = await readConversationDetail(client({
      instagram_dm_threads: { data: [
        thread({ workspace_id: OTHER_WS, id: ID }),
        thread({ workspace_id: WS, id: OTHER_THREAD }),
        thread({ workspace_id: WS, id: ID }),
      ] },
      instagram_dm_messages: { data: [
        { id: 'm-other-ws', workspace_id: OTHER_WS, thread_id: ID, sender_type: 'customer', text: '남의 가게 글', sent_at: '2026-10-23T08:48:00Z' },
        { id: 'm-other-th', workspace_id: WS, thread_id: OTHER_THREAD, sender_type: 'customer', text: '내 가게 다른 대화 글', sent_at: '2026-10-23T08:48:30Z' },
        { id: 'm-target-1', workspace_id: WS, thread_id: ID, sender_type: 'customer', text: '정상 글 1', sent_at: '2026-10-23T08:49:00Z' },
        { id: 'm-target-2', workspace_id: WS, thread_id: ID, sender_type: 'business', text: '정상 글 2', sent_at: '2026-10-23T08:50:00Z' },
      ] },
      instagram_dm_drafts: { data: [
        { workspace_id: OTHER_WS, thread_id: ID, draft_text: '남의 초안', updated_at: '2026-10-23T08:54:00Z' },
        { workspace_id: WS, thread_id: OTHER_THREAD, draft_text: '다른 대화 초안', updated_at: '2026-10-23T08:54:30Z' },
        { workspace_id: WS, thread_id: ID, draft_text: '정상 초안', selected_option_id: 'o1', options: [{ id: 'o1', sources: ['예약표'] }], updated_at: '2026-10-23T08:55:00Z' },
      ] },
    }), CTX, `dm:${ID}`, { now: NOW })

    if (r.status !== 'ok') throw new Error('x')
    expect(r.detail.thread.id).toBe(`dm:${ID}`)
    expect(r.detail.thread.workspaceId).toBe(WS)
    expect(r.detail.messages.map(m => m.id)).toEqual(['m-target-1', 'm-target-2'])
    expect(r.detail.messages.map(m => m.text)).toEqual(['정상 글 1', '정상 글 2'])
    expect(r.detail.thread.draft?.text).toBe('정상 초안')
  })
})
