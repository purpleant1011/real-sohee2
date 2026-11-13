import { describe, expect, it, vi } from 'vitest'
import { consumeConversationJobs, parseConversationQueueMessage } from './cloudflare-conversation-queue'

describe('conversation Queue adapter', () => {
  it('accepts only an opaque versioned job envelope', () => {
    expect(parseConversationQueueMessage({
      schemaVersion: 1,
      jobId: '10000000-0000-4000-8000-000000000001',
      workspaceId: '20000000-0000-4000-8000-000000000001',
    })).toEqual({
      schemaVersion: 1,
      jobId: '10000000-0000-4000-8000-000000000001',
      workspaceId: '20000000-0000-4000-8000-000000000001',
    })
    expect(() => parseConversationQueueMessage({ schemaVersion: 1, jobId: 'bad', prompt: 'secret' }))
      .toThrow('CONVERSATION_QUEUE_MESSAGE_INVALID')
  })

  it('acknowledges terminal work and delays a same-thread predecessor block', async () => {
    const terminal = { body: { schemaVersion: 1, jobId: '10000000-0000-4000-8000-000000000001', workspaceId: '20000000-0000-4000-8000-000000000001' }, ack: vi.fn(), retry: vi.fn() }
    const blocked = { body: { schemaVersion: 1, jobId: '10000000-0000-4000-8000-000000000002', workspaceId: '20000000-0000-4000-8000-000000000001' }, ack: vi.fn(), retry: vi.fn() }
    const run = vi.fn()
      .mockResolvedValueOnce({ state: 'terminal' })
      .mockResolvedValueOnce({ state: 'blocked' })

    await consumeConversationJobs({ messages: [terminal, blocked] }, { run, workerId: () => '30000000-0000-4000-8000-000000000001' })

    expect(terminal.ack).toHaveBeenCalledTimes(1)
    expect(blocked.retry).toHaveBeenCalledWith({ delaySeconds: 60 })
  })
})
