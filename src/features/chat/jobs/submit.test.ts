import { describe, expect, it, vi } from 'vitest'
import { submitConversationJob } from './submit'

const input = {
  workspaceId: '10000000-0000-4000-8000-000000000001',
  threadId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  request: {
    content: '인스타그램 이미지 3장 포스팅을 만들어줘',
    displayContent: '인스타그램 이미지 3장 포스팅을 만들어줘',
    clientMessageId: '40000000-0000-4000-8000-000000000001',
    attachmentIds: [],
  },
}

const stored = {
  job: {
    id: '50000000-0000-4000-8000-000000000001',
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    status: 'queued',
    kind: 'content_generation',
    queueDispatchedAt: null,
  },
  userMessage: { id: '60000000-0000-4000-8000-000000000001' },
  assistantMessage: { id: '70000000-0000-4000-8000-000000000001' },
  reservation: { id: '80000000-0000-4000-8000-000000000001', requestedCredits: 165 },
} as const

describe('submitConversationJob', () => {
  it('rejects a selected work reference before enqueue rather than dropping it from the metadata RPC', async () => {
    const enqueue = vi.fn(async () => stored)
    await expect(submitConversationJob({ ...input, request: { ...input.request, workRef: input.workspaceId } }, {
      enqueue, persistRequestMetadata: vi.fn(), markDispatched: vi.fn(), failDispatch: vi.fn(), queue: { send: vi.fn() },
    })).rejects.toThrow('CONVERSATION_WORK_REVIEW_REQUIRES_FOREGROUND')
    expect(enqueue).not.toHaveBeenCalled()
  })
  it('persists before Queue send and returns an accepted job', async () => {
    const order: string[] = []
    const queue = { send: vi.fn(async () => { order.push('queue') }) }
    const result = await submitConversationJob(input, {
      enqueue: vi.fn(async () => { order.push('enqueue'); return stored }),
      persistRequestMetadata: vi.fn(async () => { order.push('metadata') }),
      markDispatched: vi.fn(async () => { order.push('dispatched') }),
      failDispatch: vi.fn(),
      queue,
    })
    expect(order).toEqual(['enqueue', 'metadata', 'queue', 'dispatched'])
    expect(queue.send).toHaveBeenCalledWith({ schemaVersion: 1, jobId: stored.job.id, workspaceId: input.workspaceId })
    expect(result).toEqual(expect.objectContaining({ job: expect.objectContaining({ status: 'queued' }) }))
  })

  it('does not send a duplicate Queue message after dispatch was recorded', async () => {
    const queue = { send: vi.fn() }
    await submitConversationJob(input, {
      enqueue: vi.fn(async () => ({ ...stored, job: { ...stored.job, queueDispatchedAt: '2026-08-22T14:00:00.000Z' } })),
      persistRequestMetadata: vi.fn(),
      markDispatched: vi.fn(),
      failDispatch: vi.fn(),
      queue,
    })
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('marks the job for attention and releases credit when Queue send fails', async () => {
    const failDispatch = vi.fn(async () => undefined)
    await expect(submitConversationJob(input, {
      enqueue: vi.fn(async () => stored),
      persistRequestMetadata: vi.fn(),
      markDispatched: vi.fn(),
      failDispatch,
      queue: { send: vi.fn(async () => { throw new Error('queue unavailable') }) },
    })).rejects.toThrow('CONVERSATION_JOB_DISPATCH_FAILED')
    expect(failDispatch).toHaveBeenCalledWith(stored.job.id, input.workspaceId)
  })

  it('does not release reserved credit when Queue accepted the message but dispatch recording fails', async () => {
    const failDispatch = vi.fn(async () => undefined)
    await expect(submitConversationJob(input, {
      enqueue: vi.fn(async () => stored),
      persistRequestMetadata: vi.fn(),
      markDispatched: vi.fn(async () => { throw new Error('database unavailable') }),
      failDispatch,
      queue: { send: vi.fn(async () => undefined) },
    })).rejects.toThrow('database unavailable')
    expect(failDispatch).not.toHaveBeenCalled()
  })
})
