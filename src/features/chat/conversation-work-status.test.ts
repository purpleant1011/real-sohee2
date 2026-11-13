import { describe, expect, it } from 'vitest'
import { nextWorkStatusPollMs, parseConversationWorkStatus } from './conversation-work-status'

const status = {
  activeJobCount: 2,
  attentionThreadCount: 0,
  threads: [{
    threadId: '10000000-0000-4000-8000-000000000001',
    displayStatus: 'working',
    activeJobCount: 2,
    latestJobUpdatedAt: '2026-08-22T14:00:00.000Z',
  }],
  creditBalance: {
    available: 1253,
    weeklyLimit: 2000,
    consumed: 700,
    reserved: 47,
    policyVersion: 'v08-test-2000-1',
  },
  observedAt: '2026-08-22T14:00:00.000Z',
}

describe('conversation work status', () => {
  it('accepts the API contract and preserves the weekly credit ratio', () => {
    expect(parseConversationWorkStatus(status).creditBalance).toEqual(expect.objectContaining({
      available: 1253,
      weeklyLimit: 2000,
    }))
  })

  it('polls quickly only while API work is active', () => {
    expect(nextWorkStatusPollMs(parseConversationWorkStatus(status), true)).toBe(5_000)
    expect(nextWorkStatusPollMs({
      ...parseConversationWorkStatus(status),
      activeJobCount: 0,
      attentionThreadCount: 1,
    }, true)).toBe(30_000)
    expect(nextWorkStatusPollMs({
      ...parseConversationWorkStatus(status),
      activeJobCount: 0,
      attentionThreadCount: 0,
    }, true)).toBe(120_000)
    expect(nextWorkStatusPollMs(parseConversationWorkStatus(status), false)).toBeNull()
  })
})
