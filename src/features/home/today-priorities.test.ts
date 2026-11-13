import { describe, expect, it } from 'vitest'
import { buildTodayPriorities, type TodayPriorityInput } from './today-priorities'
import type { QuickPostItem } from '@/components/quick-post/types'

const item = (status: string, createdAt: string, overrides: Partial<QuickPostItem> = {}): QuickPostItem => ({
  missionId: `post-${createdAt}-${status}`,
  status,
  topic: '이번 주 이야기',
  createdAt,
  copies: { instagram: { caption: '새 소식' }, threads: { content: '새 소식' } },
  imageIds: [], imageUrl: null, channels: [], approvalFingerprint: '', businessName: '', revision: 1, receipts: {},
  ...overrides,
})

const now = new Date('2026-10-07T12:00:00.000Z')
const base: TodayPriorityInput = { channelsConnected: true, posts: [], recentActionsCount: 0, now }

describe('buildTodayPriorities', () => {
  it('prioritizes missing channels, waiting approvals, and overdue posts in that order', () => {
    const result = buildTodayPriorities({
      ...base,
      channelsConnected: false,
      posts: [item('AWAITING_APPROVAL', '2026-09-20T12:00:00.000Z'), item('AWAITING_APPROVAL', '2026-09-21T12:00:00.000Z')],
    })
    expect(result.map((card) => card.kind)).toEqual(['connect', 'approve', 'compose'])
    expect(result.map((card) => card.href)).toEqual(['/app/channels', '/app/content', '/app/content?compose=%EC%9D%B4%EB%B2%88%20%EC%A3%BC%20%EC%86%8C%EC%8B%9D'])
    expect(result[1].title).toBe('확인할 게시물 2개 보기')
  })

  it('does not count approved or publishing posts as approval requests', () => {
    const result = buildTodayPriorities({ ...base, posts: [item('APPROVED', '2026-10-06T12:00:00.000Z'), item('EXECUTING', '2026-10-06T12:00:00.000Z')] })
    expect(result.some((card) => card.kind === 'approve' && !card.complete)).toBe(false)
    expect(result.some((card) => card.kind === 'compose' && !card.complete)).toBe(false)
  })

  it('uses the most recent publication receipt rather than an old draft date', () => {
    const result = buildTodayPriorities({ ...base, posts: [
      item('PUBLISHED_VERIFIED', '2026-09-25T12:00:00.000Z', { receipts: { instagram: { stage: 'PUBLISHED', permalink: 'https://example.com/post' } } }),
      item('AWAITING_APPROVAL', '2026-10-07T10:00:00.000Z'),
    ] })
    expect(result.some((card) => card.kind === 'compose' && !card.complete)).toBe(true)
  })

  it('offers the summary as a third card when some work remains', () => {
    const result = buildTodayPriorities({ ...base, channelsConnected: false, posts: [item('AWAITING_APPROVAL', '2026-10-06T12:00:00.000Z'), item('PUBLISHED_VERIFIED', '2026-10-06T12:00:00.000Z')], recentActionsCount: 3 })
    expect(result.map((card) => card.kind)).toEqual(['connect', 'approve', 'summary'])
    const connected = buildTodayPriorities({ ...base, posts: [item('AWAITING_APPROVAL', '2026-10-06T12:00:00.000Z'), item('PUBLISHED_VERIFIED', '2026-10-06T12:00:00.000Z')], recentActionsCount: 3 })
    expect(connected.map((card) => card.kind)).toEqual(['approve', 'summary', 'connected'])
  })

  it('shows a summary when connected and recent publishing and approvals are complete', () => {
    const result = buildTodayPriorities({ ...base, posts: [item('PUBLISHED_VERIFIED', '2026-10-06T12:00:00.000Z')], recentActionsCount: 3 })
    expect(result).toHaveLength(3)
    expect(result[0].kind).toBe('summary')
    expect(result[0].description).toContain('3건')
    expect(result.every((card) => card.complete)).toBe(true)
  })

  it('does not mistake an unknown data source for an empty list', () => {
    const result = buildTodayPriorities({ ...base, channelsConnected: null, posts: null })
    expect(result).toHaveLength(3)
    expect(result.some((card) => card.kind === 'connect' || card.kind === 'compose')).toBe(false)
    expect(result.every((card) => card.complete === false)).toBe(true)
  })

  it('keeps the reminder quiet while an approved post is publishing', () => {
    const result = buildTodayPriorities({ ...base, posts: [item('APPROVED', '2026-10-01T12:00:00.000Z')] })
    expect(result.some((card) => card.kind === 'compose')).toBe(false)
  })

  it('does not claim that a missing or future timestamp is overdue', () => {
    for (const createdAt of ['', '2026-11-01T12:00:00.000Z']) {
      const result = buildTodayPriorities({ ...base, posts: [item('PUBLISHED_VERIFIED', createdAt)] })
      expect(result.some((card) => card.kind === 'compose' && !card.complete)).toBe(false)
    }
  })
})
