import { getSoheeReadiness, type ReadinessEvaluationOptions } from '@/features/sohee-ready/read-model'
import { CHANNEL_CONNECTION_MESSAGE } from '@/features/readiness'
import { SoheeNotReadyError, type SoheeReadinessSnapshot } from '@/features/sohee-ready/types'
import { evaluateFirstPostReadiness } from './first-post-readiness-rules'

export { evaluateFirstPostReadiness }

export async function getFirstPostReadiness(
  workspaceId: string,
  options?: ReadinessEvaluationOptions,
): Promise<SoheeReadinessSnapshot> {
  return evaluateFirstPostReadiness(await getSoheeReadiness(workspaceId, options))
}

export async function requireFirstPostReady(
  workspaceId: string,
  options?: ReadinessEvaluationOptions & { action?: string },
): Promise<SoheeReadinessSnapshot> {
  const readiness = await getFirstPostReadiness(workspaceId, options)
  if (!readiness.ready) {
    const error = new SoheeNotReadyError(readiness, options?.action ?? 'FIRST_POST')
    if (!readiness.facts.INSTAGRAM_VERIFIED.verified && !readiness.facts.THREADS_VERIFIED.verified) {
      error.message = CHANNEL_CONNECTION_MESSAGE
    }
    throw error
  }
  return readiness
}
