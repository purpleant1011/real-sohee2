import { describe, expect, it } from 'vitest'
import { INBOX_PAGE_LIMIT, readInboxSource, type InboxClient, type QueryBuilder } from './inbox-source'
import { readMobileInbox } from './read-inbox'

const CTX = { workspaceId: 'ws', userId: 'u' }
const NOW = () => '2026-10-23T09:00:00.000Z'
type Tables = Record<string, { data: unknown; error?: unknown }>

function client(tables: Tables, log: Array<[string, string, string]> = []): InboxClient {
  return {
    from(table) {
      const qb: QueryBuilder = {
        select: () => qb,
        eq: (c, v) => { log.push([table, c, v]); return qb },
        in: () => qb,
        order: () => qb,
        limit: async () => ({ data: (tables[table]?.data ?? []) as never, error: (tables[table]?.error ?? null) as never }),
      }
      return qb
    },
  }
}
const thread = (o: Record<string, unknown> = {}) => ({
  id: 't1', workspace_id: 'ws', customer_handle: 'minji', customer_name: null, last_message_at: '2026-10-23T08:50:00+00:00',
  expires_at: '2026-10-24T08:50:00+00:00', status: 'NEEDS_REPLY', last_message_text: '예약 되나요', ...o,
})
const comment = (o: Record<string, unknown> = {}) => ({
  id: 'c1', workspace_id: 'ws', channel: 'instagram', author_handle: 'sy', comment_text: '가격이요?', comment_created_at: '2026-10-23T08:00:00Z', status: 'RECEIVED', ...o,
})
const run = (tables: Tables, log?: Array<[string, string, string]>) =>
  readMobileInbox(CTX, { now: NOW, readThreads: c => readInboxSource(client(tables, log), c, { now: NOW, datasetMode: 'ACTUAL' }) })

describe('readInboxSource', () => {
  it('DM 원문·답안과 댓글을 실 테이블에서 읽어 가게 id 로 걸러 내려준다', async () => {
    const log: Array<[string, string, string]> = []
    const r = await run({
      instagram_dm_threads: { data: [thread()] }, instagram_dm_drafts: { data: [{ thread_id: 't1', draft_text: '가능해요' }] },
      social_comments: { data: [comment()] }, comment_reply_drafts: { data: [] },
    }, log)
    expect(r.ok && r.snapshot.loadState).toBe('ready')
    const dm = r.snapshot.threads.find(t => t.id === 'dm:t1')!
    expect(dm.lastMessage?.text).toBe('예약 되나요')
    expect(dm.draft?.text).toBe('가능해요')
    expect(dm.status).toBe('draft_ready')
    expect(dm.channel).toBe('instagram_dm')
    expect(r.snapshot.threads.find(t => t.id === 'comment:c1')?.channel).toBe('instagram_comment')
    expect(log.every(([, c, v]) => c === 'workspace_id' && v === 'ws')).toBe(true)
    expect(new Set(log.map(l => l[0]))).toEqual(new Set(['instagram_dm_threads', 'social_comments', 'instagram_dm_drafts', 'comment_reply_drafts']))
  })
  it('발송은 항상 막고, 24시간 창이 지난 DM 은 WINDOW_EXPIRED 도 단다', async () => {
    const r = await run({ instagram_dm_threads: { data: [thread({ expires_at: '2026-10-22T00:00:00+00:00' })] } })
    expect(r.snapshot.threads[0].sendBlockers).toEqual(['NO_SEND_SCOPE', 'WINDOW_EXPIRED'])
    expect(r.snapshot.threads[0].consent).toBe('unknown')
  })
  it('어느 테이블이든 읽기 오류면 error 상태(일부만 성공한 목록을 주지 않는다)', async () => {
    const r = await run({ instagram_dm_threads: { data: [thread()] }, social_comments: { data: null, error: { message: 'x' } } })
    expect(r.ok).toBe(false)
    expect(r.snapshot.loadState).toBe('error')
    expect(r.snapshot.threads).toHaveLength(0)
  })
  it('둘 다 비어 있으면 확인된 빈 목록, 한도에 닿으면 complete=false', async () => {
    expect((await run({})).snapshot.complete).toBe(true)
    const many = Array.from({ length: INBOX_PAGE_LIMIT }, (_, i) => thread({ id: `t${i}` }))
    expect((await run({ instagram_dm_threads: { data: many } })).snapshot.complete).toBe(false)
  })
  it('원문·답안이 비면 지어내지 않고 "없음"으로 내린다(fail-closed)', async () => {
    const r = await run({
      instagram_dm_threads: { data: [thread({ last_message_text: null })] },
      // 초안 행은 있는데 글이 null — String(null) 이 "null" 답안이 되면 안 된다.
      instagram_dm_drafts: { data: [{ thread_id: 't1', draft_text: null }] },
      social_comments: { data: [comment({ comment_text: '   ' })] },
      comment_reply_drafts: { data: [{ comment_id: 'c1', draft_text: null }] },
    })
    expect(r.ok).toBe(true)
    const dm = r.snapshot.threads.find(t => t.id === 'dm:t1')!
    expect(dm.lastMessage).toBeNull()
    expect(dm.draft).toBeNull()
    expect(dm.status).toBe('needs_reply')
    const c = r.snapshot.threads.find(t => t.id === 'comment:c1')!
    expect(c.lastMessage).toBeNull()
    expect(c.draft).toBeNull()
    // 줄 자체는 남는다: 원문이 없다고 손님 문의를 목록에서 지우지 않는다.
    expect(r.snapshot.threads).toHaveLength(2)
    expect(r.snapshot.complete).toBe(true)
  })
  it('draft_text 가 null 인 초안 행은 "null" 답안이 아니라 답안 없음', async () => {
    const r = await run({
      instagram_dm_threads: { data: [thread()] },
      instagram_dm_drafts: { data: [{ thread_id: 't1', draft_text: null }] },
    })
    const dm = r.snapshot.threads.find(t => t.id === 'dm:t1')!
    expect(dm.lastMessage?.text).toBe('예약 되나요')
    expect(dm.draft).toBeNull()
    // 초안이 없으므로 '답안 준비됨'도 아니다.
    expect(dm.status).toBe('needs_reply')
  })
  it('댓글 상태·threads 채널을 매핑하고 모르는 상태는 unknown', async () => {
    const r = await run({ social_comments: { data: [comment({ status: 'FAILED' }), comment({ id: 'c2', channel: 'threads', status: 'SENT' })] } })
    expect(r.snapshot.threads.find(t => t.id === 'comment:c1')?.status).toBe('unknown')
    const c2 = r.snapshot.threads.find(t => t.id === 'comment:c2')!
    expect([c2.channel, c2.status]).toEqual(['threads', 'handled'])
  })
})
