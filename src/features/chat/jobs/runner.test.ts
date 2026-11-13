import { describe, expect, it, vi } from 'vitest'
import { runConversationJob, UnknownProviderOutcomeError } from './runner'
import { createConversationJobRepository } from './repository'
import type { ConversationJobDependencies } from './types'

const job = Object.freeze({
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  threadId: '30000000-0000-4000-8000-000000000001',
  userMessageId: '40000000-0000-4000-8000-000000000001',
  assistantMessageId: '50000000-0000-4000-8000-000000000001',
  reservationId: '60000000-0000-4000-8000-000000000001',
  status: 'running' as const,
  kind: 'chat' as const,
  sequenceNumber: 1,
  workerId: '70000000-0000-4000-8000-000000000001',
})

function dependencies(overrides: Partial<ConversationJobDependencies> = {}): ConversationJobDependencies {
  return {
    repository: {
      claim: vi.fn(async () => ({ state: 'claimed' as const, job })),
      complete: vi.fn(async () => undefined),
      recordUsage: vi.fn(async () => undefined),
    },
    executor: {
      execute: vi.fn(async () => ({
        status: 'succeeded' as const,
        safeErrorCode: null,
        billingDisposition: 'settle_usage' as const,
        usage: [{
          providerCallKey: 'job:text:1',
          event: {
            provider: 'openai' as const,
            providerRequestId: 'resp_1',
            model: 'gpt-5.6-luna',
            operation: 'text_response' as const,
            usageSource: 'actual' as const,
            usage: {
              textInputTokens: 1000,
              cachedTextInputTokens: 0,
              textOutputTokens: 500,
              imageInputTokens: 0,
              imageOutputTokens: 0,
              providerTotalTokens: 1500,
            },
          },
        }],
      })),
    },
    credits: {
      settle: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    },
    ...overrides,
  }
}

describe('runConversationJob', () => {
  it('repairs the committed-terminal/reconciliation-failure window on redelivery without executing again', async () => {
    let terminal = false
    let reconciliationAttempts = 0
    let resolved = false
    const row = { id: job.id, workspace_id: job.workspaceId, thread_id: job.threadId, user_message_id: job.userMessageId,
      assistant_message_id: job.assistantMessageId, reservation_id: job.reservationId, kind: job.kind, sequence_number: 1,
      worker_id: job.workerId }
    const repository = createConversationJobRepository({ rpc: async (name, args) => {
      if (name === 'claim_conversation_job') return { data: { state: terminal ? 'terminal' : 'claimed', job: {
        ...row, status: terminal ? 'needs_attention' : 'running', safe_error_code: terminal ? 'CONVERSATION_CONTEXT_UNAVAILABLE' : null,
      } }, error: null }
      if (name === 'complete_conversation_job_v2') {
        if (terminal && args.p_safe_error_code !== 'CONVERSATION_CONTEXT_UNAVAILABLE') return { data: null, error: { code: '23505' } }
        terminal = true
        return { data: { job: { ...row, status: 'needs_attention', safe_error_code: 'CONVERSATION_CONTEXT_UNAVAILABLE' } }, error: null }
      }
      if (name === 'resolve_unstarted_conversation_job_attention') {
        reconciliationAttempts += 1
        if (reconciliationAttempts === 1) return { data: null, error: { message: 'transport failed after commit' } }
        resolved = true
        return { data: true, error: null }
      }
      throw new Error('unexpected RPC')
    } })
    const execute = vi.fn(async () => ({ status: 'needs_attention' as const, safeErrorCode: 'CONVERSATION_CONTEXT_UNAVAILABLE', billingDisposition: 'release' as const, usage: [] }))
    const deps = dependencies({ repository, executor: { execute } })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).rejects.toThrow('CONVERSATION_JOB_COMPLETE_FAILED')
    expect(terminal).toBe(true)
    expect(resolved).toBe(false)
    expect(await runConversationJob(job.id, crypto.randomUUID(), deps)).toEqual({ state: 'terminal' })
    expect(resolved).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(deps.credits.release).toHaveBeenCalledTimes(1)
  })
  it('records actual usage before settling and completing', async () => {
    const order: string[] = []
    const deps = dependencies({
      repository: {
        claim: vi.fn(async () => ({ state: 'claimed' as const, job })),
        recordUsage: vi.fn(async () => { order.push('usage') }),
        complete: vi.fn(async () => { order.push('complete') }),
      },
      credits: { settle: vi.fn(async () => { order.push('settle') }), release: vi.fn() },
    })

    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'succeeded' })
    expect(order).toEqual(['usage', 'settle', 'complete'])
    expect(deps.credits.settle).toHaveBeenCalledWith(job, 1)
  })

  it('does not execute a job blocked by an earlier same-thread job', async () => {
    const deps = dependencies({
      repository: {
        claim: vi.fn(async () => ({ state: 'blocked_by_predecessor' as const })),
        recordUsage: vi.fn(),
        complete: vi.fn(),
      },
    })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'blocked' })
    expect(deps.executor.execute).not.toHaveBeenCalled()
  })

  it('does not execute duplicate delivery for a terminal job', async () => {
    const deps = dependencies({
      repository: {
        claim: vi.fn(async () => ({ state: 'terminal' as const, job: { ...job, status: 'succeeded' as const } })),
        recordUsage: vi.fn(),
        complete: vi.fn(),
      },
    })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'terminal' })
    expect(deps.executor.execute).not.toHaveBeenCalled()
  })

  it('marks an uncertain provider result for attention without settlement or retry', async () => {
    const deps = dependencies({ executor: { execute: vi.fn(async () => { throw new UnknownProviderOutcomeError() }) } })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'needs_attention' })
    expect(deps.credits.settle).not.toHaveBeenCalled()
    expect(deps.repository.complete).toHaveBeenCalledWith(job, 'needs_attention', 'PROVIDER_RESULT_UNKNOWN')
  })

  it('moves an unexpected execution failure out of 작업 중 for explicit review', async () => {
    const deps = dependencies({ executor: { execute: vi.fn(async () => { throw new Error('provider failed') }) } })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'needs_attention' })
    expect(deps.credits.settle).not.toHaveBeenCalled()
    expect(deps.repository.complete).toHaveBeenCalledWith(job, 'needs_attention', 'JOB_EXECUTION_FAILED')
  })

  it('releases the full reservation when execution fails before any provider call', async () => {
    const deps = dependencies({
      executor: { execute: vi.fn(async () => ({
        status: 'needs_attention' as const,
        safeErrorCode: 'CHAT_UNAVAILABLE',
        billingDisposition: 'release' as const,
        usage: [],
      })) },
    })
    await expect(runConversationJob(job.id, crypto.randomUUID(), deps)).resolves.toEqual({ state: 'needs_attention' })
    expect(deps.credits.release).toHaveBeenCalledWith(job, 'CHAT_UNAVAILABLE')
    expect(deps.credits.settle).not.toHaveBeenCalled()
    expect(deps.repository.recordUsage).not.toHaveBeenCalled()
  })
})
