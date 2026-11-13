import { calculateTokenCredits } from '@/features/credits/token-credit-policy'
import type { ConversationJob, RecordedJobUsage } from './types'

export function createPersistingUsageCollector(input: Readonly<{
  job: ConversationJob
  record(job: ConversationJob, usage: RecordedJobUsage, credits: number): Promise<void>
}>) {
  const values: RecordedJobUsage[] = []
  const keys = new Set<string>()
  const writes: Promise<unknown | null>[] = []

  return Object.freeze({
    capture(usage: RecordedJobUsage) {
      if (keys.has(usage.providerCallKey)) throw new Error('PROVIDER_USAGE_DUPLICATE')
      keys.add(usage.providerCallKey)
      values.push(usage)
      const credits = calculateTokenCredits(usage.event.usage)
      writes.push(input.record(input.job, usage, credits).then(
        () => null,
        (error: unknown) => error,
      ))
    },
    snapshot(): readonly RecordedJobUsage[] {
      return Object.freeze([...values])
    },
    async flush(): Promise<void> {
      const results = await Promise.all(writes)
      const error = results.find((result) => result !== null)
      if (error !== undefined) throw error
    },
  })
}
