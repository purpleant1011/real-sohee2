import { describe, expect, it, vi } from 'vitest'
import { pollInstagramDms } from './poll'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const iso = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

function repoWith(existing: string[] = [], watermark: string | null = null) {
  const ingested: string[] = []
  return {
    ingested,
    repo: {
      latestThreadActivityAt: vi.fn().mockResolvedValue(watermark),
      findExistingProviderMessageIds: vi.fn(async (_ws: string, ids: readonly string[]) => new Set(ids.filter((i) => existing.includes(i)))),
    } as any,
  }
}

describe('pollInstagramDms', () => {
  it('ingests only unseen messages, oldest first, and counts duplicates separately', async () => {
    const { repo } = repoWith(['m-old'])
    const order: string[] = []
    const out = await pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      deps: {
        listConversations: vi.fn().mockResolvedValue([{ id: 'c1', updatedTime: iso(-1) }]),
        listMessageIds: vi.fn().mockResolvedValue([
          { id: 'm-new2', createdAt: iso(-1) }, { id: 'm-new1', createdAt: iso(-2) }, { id: 'm-old', createdAt: iso(-3) },
        ]),
        getMessage: vi.fn(async ({ messageId }: any) => ({ id: messageId, createdAt: iso(-1), text: messageId, fromId: 'cust', toId: 'biz' })),
        ingest: vi.fn(async (input: any) => { order.push(input.mid); return { status: 'ingested' as const, threadId: 't' } }),
      },
    })
    expect(order).toEqual(['m-new1', 'm-new2'])
    expect(out).toMatchObject({ conversations: 1, ingested: 2, duplicates: 0, failures: 0 })
  })

  it('skips conversations older than the cutoff (watermark minus 1h, floored at 48h ago)', async () => {
    const { repo } = repoWith([], iso(-10))
    const listMessageIds = vi.fn().mockResolvedValue([])
    await pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      deps: {
        listConversations: vi.fn().mockResolvedValue([
          { id: 'fresh', updatedTime: iso(-9.5) }, { id: 'stale', updatedTime: iso(-12) },
        ]),
        listMessageIds, getMessage: vi.fn(), ingest: vi.fn(),
      },
    })
    expect(listMessageIds.mock.calls.map((c: any) => c[0].conversationId)).toEqual(['fresh'])
  })

  it('uses a 48h floor when there is no watermark', async () => {
    const { repo } = repoWith([], null)
    const listMessageIds = vi.fn().mockResolvedValue([])
    await pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      deps: {
        listConversations: vi.fn().mockResolvedValue([
          { id: 'recent', updatedTime: iso(-47) }, { id: 'ancient', updatedTime: iso(-100) },
        ]),
        listMessageIds, getMessage: vi.fn(), ingest: vi.fn(),
      },
    })
    expect(listMessageIds.mock.calls.map((c: any) => c[0].conversationId)).toEqual(['recent'])
  })

  it('caps conversations per run and survives per-message and per-conversation failures', async () => {
    const { repo } = repoWith()
    const listMessageIds = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ id: 'bad', createdAt: iso(-1) }, { id: 'good', createdAt: iso(-1) }])
    const getMessage = vi.fn(async ({ messageId }: any) => {
      if (messageId === 'bad') throw new Error('rejected id')
      return { id: messageId, createdAt: iso(-1), text: 'x', fromId: 'cust', toId: 'biz' }
    })
    const ingest = vi.fn().mockResolvedValue({ status: 'ingested', threadId: 't' })
    const out = await pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      maxConversations: 2,
      deps: {
        listConversations: vi.fn().mockResolvedValue([
          { id: 'c1', updatedTime: iso(-1) }, { id: 'c2', updatedTime: iso(-1) }, { id: 'c3', updatedTime: iso(-1) },
        ]),
        listMessageIds, getMessage, ingest,
      },
    })
    expect(listMessageIds).toHaveBeenCalledTimes(2)
    expect(out.ingested).toBe(1)
    expect(out.failures).toBe(2) // one conversation, one message
  })

  it('treats a null message detail (older than the latest 20) as skipped, not a failure', async () => {
    const { repo } = repoWith()
    const out = await pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      deps: {
        listConversations: vi.fn().mockResolvedValue([{ id: 'c1', updatedTime: iso(-1) }]),
        listMessageIds: vi.fn().mockResolvedValue([{ id: 'gone', createdAt: iso(-1) }]),
        getMessage: vi.fn().mockResolvedValue(null), ingest: vi.fn(),
      },
    })
    expect(out).toMatchObject({ ingested: 0, failures: 0, skipped: 1 })
  })

  it('propagates rate-limit and token errors from the conversation listing so the caller can back off', async () => {
    const { repo } = repoWith()
    await expect(pollInstagramDms({
      workspaceId: 'ws', channelConnectionId: 'conn', businessIgId: 'biz', accessToken: 'token-1234567890', repo, now: NOW,
      deps: { listConversations: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'RATE_LIMITED' })), listMessageIds: vi.fn(), getMessage: vi.fn(), ingest: vi.fn() },
    })).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
})
