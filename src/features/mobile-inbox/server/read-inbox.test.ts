import { describe, expect, it } from 'vitest'
import { readMobileInbox, type InboxReadDeps, type InboxSourceResult } from './read-inbox'

const CTX = { workspaceId: 'ws', userId: 'u' }
const NOW = '2026-10-23T09:00:00.000Z'
const row = (o: Record<string, unknown> = {}) => ({
  id: 't1', workspaceId: 'ws', channel: 'instagram_dm', customerName: '김민지', consent: 'granted', status: 'draft_ready', unread: true,
  lastMessage: { text: '예약 되나요', receivedAt: '2026-10-23T08:50:00.000Z', fromCustomer: true },
  draft: { text: '가능해요', sources: ['예약표'] }, sendBlockers: [], ...o,
})
const src = (o: Partial<InboxSourceResult> = {}): InboxSourceResult => ({
  rows: [row()], complete: true, observedAt: '2026-10-23T08:58:00.000Z', datasetMode: 'ACTUAL', ...o,
})
const deps = (read: InboxReadDeps['readThreads']): InboxReadDeps => ({ now: () => NOW, readThreads: read })

describe('readMobileInbox', () => {
  it('정상 읽기는 ready 이고 원문을 그대로 넘긴다', async () => {
    const r = await readMobileInbox(CTX, deps(async () => src()))
    expect(r.ok && r.snapshot.loadState).toBe('ready')
    expect(r.snapshot.threads[0].lastMessage?.text).toBe('예약 되나요')
    expect(r.snapshot.complete).toBe(true)
  })
  it('조회 실패는 빈 목록이 아니라 error 다', async () => {
    const r = await readMobileInbox(CTX, deps(async () => { throw new Error('db') }))
    expect(r.ok).toBe(false)
    expect(r.snapshot.loadState).toBe('error')
    expect(r.snapshot.threads).toHaveLength(0)
  })
  it('읽은 시각이 오래되면 stale, 시각이 이상하면 stale + 확인 시각 없음', async () => {
    expect((await readMobileInbox(CTX, deps(async () => src({ observedAt: '2026-10-23T08:00:00.000Z' })))).snapshot.loadState).toBe('stale')
    const bad = await readMobileInbox(CTX, deps(async () => src({ observedAt: 'x' })))
    expect(bad.snapshot.loadState).toBe('stale')
    expect(bad.snapshot.checkedAt).toBeNull()
  })
  it('진짜 빈 목록은 complete 일 때만 확인된 빈 상태로 갈 수 있다', async () => {
    const full = await readMobileInbox(CTX, deps(async () => src({ rows: [] })))
    expect(full.snapshot.threads).toHaveLength(0)
    expect(full.snapshot.complete).toBe(true)
    const part = await readMobileInbox(CTX, deps(async () => src({ rows: [], complete: false })))
    expect(part.snapshot.complete).toBe(false)
  })
  it('다른 가게 줄·스키마 위반 줄은 버리고 partial 로 알린다', async () => {
    const r = await readMobileInbox(CTX, deps(async () => src({ rows: [row(), row({ id: 'x', workspaceId: 'other' }), row({ id: 'y', channel: 'sms' }), row({ id: 'z', extra: 1 })] })))
    expect(r.snapshot.threads.map(t => t.id)).toEqual(['t1'])
    expect(r.ok && r.rejectedRows).toBe(3)
    expect(r.snapshot.complete).toBe(false)
  })
  it('모든 줄이 다른 가게 것이면 확인된 빈 상태가 아니라 partial 로 남긴다', async () => {
    const r = await readMobileInbox(CTX, deps(async () => src({ rows: [row({ id: 'x', workspaceId: 'other' }), row({ id: 'y', workspaceId: 'other-2' })] })))
    expect(r.snapshot.threads).toEqual([])
    expect(r.ok && r.rejectedRows).toBe(2)
    expect(r.snapshot.complete).toBe(false)
  })
  it('서버 시계를 해석할 수 없으면 stale 이다(최신으로 단정하지 않는다)', async () => {
    const r = await readMobileInbox(CTX, { now: () => 'not-a-time', readThreads: async () => src() })
    expect(r.snapshot.loadState).toBe('stale')
    // 원문은 그대로 남긴다. 시계 문제로 문의를 지우지 않는다.
    expect(r.snapshot.threads).toHaveLength(1)
  })

  it('stale 임계값이 숫자가 아니면 기본 10분을 쓴다', async () => {
    const read = async () => src({ observedAt: '2026-10-23T08:30:00.000Z' }) // 30분 전
    const r = await readMobileInbox(CTX, { now: () => NOW, readThreads: read, staleAfterMinutes: Number.NaN })
    expect(r.snapshot.loadState).toBe('stale')
  })

  it('stale 임계값이 음수면 기본 10분을 쓴다', async () => {
    const read = async () => src({ observedAt: '2026-10-23T08:55:00.000Z' }) // 5분 전
    const r = await readMobileInbox(CTX, { now: () => NOW, readThreads: read, staleAfterMinutes: -5 })
    expect(r.snapshot.loadState).toBe('ready')
  })

  it('stale 임계값 0 은 그대로 지킨다(모든 과거 읽기는 stale)', async () => {
    const read = async () => src({ observedAt: '2026-10-23T08:59:59.000Z' })
    const r = await readMobileInbox(CTX, { now: () => NOW, readThreads: read, staleAfterMinutes: 0 })
    expect(r.snapshot.loadState).toBe('stale')
  })

  it('ACTUAL 이 아닌 데이터는 통째로 거부한다', async () => {
    for (const mode of ['DEMO', 'TEST', 'UNKNOWN'] as const) {
      const r = await readMobileInbox(CTX, deps(async () => src({ datasetMode: mode })))
      expect(r.ok).toBe(false)
      expect(r.snapshot.threads).toHaveLength(0)
    }
  })
})
