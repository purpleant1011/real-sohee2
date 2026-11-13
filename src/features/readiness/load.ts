import { getSoheeReadiness, type ReadinessEvaluationOptions } from '@/features/sohee-ready/read-model'
import { evaluateReadiness } from './index'

/** One server read model feeds onboarding, progress, and API policy. Never cache publication decisions. */
export async function loadReadiness(workspaceId: string, options?: ReadinessEvaluationOptions) {
  const snapshot = await getSoheeReadiness(workspaceId, options)
  return { ...evaluateReadiness(snapshot), facts: snapshot.facts, blockers: snapshot.blockers }
}
