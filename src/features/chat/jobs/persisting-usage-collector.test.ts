import { describe, expect, it, vi } from 'vitest'
import { createPersistingUsageCollector } from './persisting-usage-collector'
import type { ConversationJob, RecordedJobUsage } from './types'

const job: ConversationJob = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  threadId: '30000000-0000-4000-8000-000000000001',
  userMessageId: '40000000-0000-4000-8000-000000000001',
  assistantMessageId: '50000000-0000-4000-8000-000000000001',
  reservationId: '60000000-0000-4000-8000-000000000001',
  status: 'running',
  kind: 'content_generation',
  sequenceNumber: 1,
  workerId: '70000000-0000-4000-8000-000000000001',
}

const usage: RecordedJobUsage = {
  providerCallKey: 'job:image:1',
  event: {
    provider: 'openai', providerRequestId: 'img_1', model: 'gpt-image-2',
    operation: 'image_generation', usageSource: 'actual',
    usage: {
      textInputTokens: 100, cachedTextInputTokens: 0, textOutputTokens: 0,
      imageInputTokens: 0, imageOutputTokens: 4160, providerTotalTokens: 4260,
    },
  },
}

describe('persisting usage collector', () => {
  it('starts an idempotent usage write as soon as the provider callback arrives', async () => {
    let resolveWrite: (() => void) | undefined
    const record = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve }))
    const collector = createPersistingUsageCollector({ job, record })

    collector.capture(usage)

    expect(record).toHaveBeenCalledWith(job, usage, 27)
    expect(collector.snapshot()).toEqual([usage])
    resolveWrite?.()
    await collector.flush()
  })

  it('rejects duplicate callback keys before they can double count credits', () => {
    const collector = createPersistingUsageCollector({ job, record: vi.fn(async () => undefined) })
    collector.capture(usage)

    expect(() => collector.capture(usage)).toThrow('PROVIDER_USAGE_DUPLICATE')
  })
})
