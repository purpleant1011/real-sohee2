import { describe, expect, it, vi } from 'vitest'
import { createPreparedMessageExecutor } from './prepared-message-executor'

const job = {
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
}

describe('prepared message executor', () => {
  it('executes the persisted request without a browser signal and collects sanitized usage', async () => {
    const execute = vi.fn(async (input: { onUsage(value: unknown): void }) => {
      input.onUsage({
        providerCallKey: 'job:text:1',
        event: {
          provider: 'openai', providerRequestId: 'resp_1', model: 'gpt-5.6-luna', operation: 'text_response', usageSource: 'actual',
          usage: { textInputTokens: 1000, cachedTextInputTokens: 0, textOutputTokens: 500, imageInputTokens: 0, imageOutputTokens: 0, providerTotalTokens: 1500 },
        },
      })
      return { status: 'completed' as const, safeErrorCode: null, billingDisposition: 'settle_usage' as const }
    })
    const executor = createPreparedMessageExecutor({
      load: vi.fn(async () => ({
        userId: '80000000-0000-4000-8000-000000000001',
        clientMessageId: '90000000-0000-4000-8000-000000000001',
        displayContent: '표시 지시',
        executionContent: '실행 지시',
        attachmentIds: [],
      })),
      execute,
    })

    await expect(executor.execute(job)).resolves.toEqual({
      status: 'succeeded',
      safeErrorCode: null,
      billingDisposition: 'settle_usage',
      usage: [expect.objectContaining({ providerCallKey: 'job:text:1' })],
    })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      job,
      request: expect.objectContaining({ executionContent: '실행 지시' }),
      onUsage: expect.any(Function),
    }))
  })

  it('preserves a pre-provider failure as a full credit release without invented usage', async () => {
    const executor = createPreparedMessageExecutor({
      load: vi.fn(async () => ({
        userId: '80000000-0000-4000-8000-000000000001',
        clientMessageId: '90000000-0000-4000-8000-000000000001',
        displayContent: '표시 지시', executionContent: '실행 지시', attachmentIds: [],
      })),
      execute: vi.fn(async () => ({
        status: 'failed' as const,
        safeErrorCode: 'CHAT_UNAVAILABLE',
        billingDisposition: 'release' as const,
      })),
    })

    await expect(executor.execute(job)).resolves.toEqual({
      status: 'needs_attention',
      safeErrorCode: 'CHAT_UNAVAILABLE',
      billingDisposition: 'release',
      usage: [],
    })
  })
})
