import { calculateTokenCredits } from '@/features/credits/token-credit-policy'
import type { ConversationJobDependencies } from './types'

export class UnknownProviderOutcomeError extends Error {
  constructor() {
    super('PROVIDER_RESULT_UNKNOWN')
    this.name = 'UnknownProviderOutcomeError'
  }
}

export type ConversationJobRunResult = Readonly<{
  state: 'succeeded' | 'needs_attention' | 'cancelled' | 'blocked' | 'terminal' | 'missing'
}>

export async function runConversationJob(
  jobId: string,
  workerId: string,
  dependencies: ConversationJobDependencies,
): Promise<ConversationJobRunResult> {
  const claim = await dependencies.repository.claim(jobId, workerId)
  if (claim.state === 'blocked_by_predecessor' || claim.state === 'not_claimed') return { state: 'blocked' }
  if (claim.state === 'missing') return { state: 'missing' }
  if (claim.state === 'terminal') return { state: 'terminal' }

  const { job } = claim
  try {
    const execution = await dependencies.executor.execute(job)
    if (execution.billingDisposition === 'release') {
      if (execution.usage.length > 0) throw new Error('PRE_PROVIDER_USAGE_INVALID')
      const reason = execution.safeErrorCode ?? 'JOB_PRE_PROVIDER_FAILED'
      await dependencies.credits.release(job, reason)
      await dependencies.repository.complete(job, execution.status, execution.safeErrorCode)
      return { state: execution.status }
    }
    let actualCredits = 0
    for (const usage of execution.usage) {
      const credits = calculateTokenCredits(usage.event.usage)
      await dependencies.repository.recordUsage(job, usage, credits)
      actualCredits += credits
      if (!Number.isSafeInteger(actualCredits)) throw new Error('TOKEN_USAGE_INVALID')
    }
    if (actualCredits <= 0) throw new Error('PROVIDER_USAGE_MISSING')
    await dependencies.credits.settle(job, actualCredits)
    await dependencies.repository.complete(job, execution.status, execution.safeErrorCode)
    return { state: execution.status }
  } catch (error) {
    if (error instanceof UnknownProviderOutcomeError) {
      await dependencies.repository.complete(job, 'needs_attention', 'PROVIDER_RESULT_UNKNOWN')
      return { state: 'needs_attention' }
    }
    await dependencies.repository.complete(job, 'needs_attention', 'JOB_EXECUTION_FAILED')
    return { state: 'needs_attention' }
  }
}
