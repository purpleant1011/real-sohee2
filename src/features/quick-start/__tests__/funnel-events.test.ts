import { describe, expect, it, vi } from 'vitest'
import { computeTimeToFirstPost, recordFunnelEvent, summarizeFunnel, type FunnelEvent } from '../funnel-events'

const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 0, minute)).toISOString()
const event = (name: FunnelEvent['event'], minute: number, user_id = 'user-a'): FunnelEvent => ({ event: name, occurred_at: at(minute), user_id })

describe('computeTimeToFirstPost', () => {
  it('uses the earliest verified post following the first signup irrespective of input order', () => {
    expect(computeTimeToFirstPost([event('publish_verified', 9), event('signup_completed', 0), event('publish_verified', 12)])).toBe(540_000)
  })
  it('never combines signup and publish events from different users', () => {
    expect(computeTimeToFirstPost([event('signup_completed', 0), event('publish_verified', 5, 'user-b')])).toBeNull()
  })
  it('excludes negative intervals and incomplete signups', () => {
    expect(computeTimeToFirstPost([event('publish_verified', 1), event('signup_completed', 2)])).toBeNull()
    expect(computeTimeToFirstPost([event('signup_completed', 2), event('publish_failed', 4)])).toBeNull()
    expect(computeTimeToFirstPost([event('publish_verified', 2)])).toBeNull()
  })
})

describe('summarizeFunnel', () => {
  it('lets a user publish without requesting an optional revision', () => {
    const events = [
      'signup_completed', 'quickstart_shop_saved', 'quickstart_tone_saved', 'channel_connected',
      'draft_requested', 'draft_ready', 'preview_viewed', 'publish_confirmed', 'publish_verified',
    ].map((name, index) => event(name as FunnelEvent['event'], index))
    const summary = summarizeFunnel(events)
    expect(summary.stages[7]).toMatchObject({ event: 'revise_requested', reached: 0, dropped: 0 })
    expect(summary.stages[8]).toMatchObject({ event: 'publish_confirmed', reached: 1, dropped: 0 })
    expect(summary.stages[9]).toMatchObject({ event: 'publish_verified', reached: 1 })
  })

  it('deduplicates retries, tracks sequential drop-off and medians per signed-up user', () => {
    const events = [
      event('signup_completed', 0), event('quickstart_shop_saved', 1), event('quickstart_shop_saved', 2),
      event('quickstart_tone_saved', 3), event('channel_connected', 4), event('draft_requested', 5),
      event('draft_ready', 6), event('preview_viewed', 7), event('revise_requested', 8),
      event('publish_confirmed', 9), event('publish_verified', 10),
      event('signup_completed', 0, 'user-b'), event('quickstart_shop_saved', 3, 'user-b'),
      event('publish_verified', 4, 'user-b'), event('publish_failed', 5, 'user-b'),
      event('signup_completed', 0, 'user-c'), event('quickstart_shop_saved', 5, 'user-c'),
      event('quickstart_tone_saved', 2, 'user-c'), // wrong order, must not count
      event('preview_viewed', 1, 'no-signup'),
    ]
    const summary = summarizeFunnel(events)
    expect(summary.cohortSize).toBe(3)
    expect(summary.stages[0]).toMatchObject({ reached: 3, dropped: 0, medianFromPreviousMs: null })
    expect(summary.stages[1]).toMatchObject({ reached: 3, dropped: 2, medianFromPreviousMs: 180_000 })
    expect(summary.stages[2]).toMatchObject({ reached: 1, dropped: 0 })
    expect(summary.stages[9]).toMatchObject({ reached: 1, dropped: 0 })
    expect(summary.publishFailed).toBe(1)
    expect(summary.medianTimeToFirstPostMs).toBe(420_000)
    expect(summary.withinTenMinutes).toBe(2)
    expect(summarizeFunnel([...events].reverse())).toEqual(summary)
  })
})

describe('recordFunnelEvent', () => {
  it('sends stable per-user/mission dedupe keys and ignores duplicates without changing the first timestamp', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const admin = { from: vi.fn().mockReturnValue({ upsert }) }
    const args = { admin, workspaceId: 'workspace', userId: 'owner', event: 'draft_ready' as const, properties: { missionId: 'mission-1' } }
    await recordFunnelEvent(args)
    await recordFunnelEvent(args)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[0]).toEqual(upsert.mock.calls[1])
    expect(upsert.mock.calls[0][0].dedupe_key).toBe('draft_ready:owner:mission-1')
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'workspace_id,event,dedupe_key', ignoreDuplicates: true })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('occurred_at')
  })
  it('swallows DB errors and thrown exceptions without logging personal data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const upsert = vi.fn().mockResolvedValueOnce({ error: { message: 'secret' } }).mockRejectedValueOnce(new Error('secret'))
    const admin = { from: () => ({ upsert }) }
    const args = { admin, workspaceId: 'w', userId: 'u', event: 'preview_viewed' as const }
    await expect(recordFunnelEvent(args)).resolves.toBeUndefined()
    await expect(recordFunnelEvent(args)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret')
    warn.mockRestore()
  })
})
