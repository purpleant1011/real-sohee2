import { computeCategoryScores, computeCompleteness } from './categories'
import { evaluateJobs } from './jobs'
import { computeLevel } from './level'
import { evaluateRequirements, pickNextStep } from './requirements'
import type { GrowthEvidence, GrowthSnapshot } from './types'

export function buildGrowthSnapshot(evidence: GrowthEvidence, now: Date = new Date()): GrowthSnapshot {
  const categories = computeCategoryScores(evidence)
  const requirements = evaluateRequirements(evidence)
  return {
    completenessPercent: computeCompleteness(categories),
    level: computeLevel(requirements),
    categories,
    requirements,
    jobs: evaluateJobs(requirements, evidence.tier),
    nextStep: pickNextStep(requirements),
    counts: {
      facts: Object.values(evidence.factCounts).reduce((sum, n) => sum + n, 0),
      sources: evidence.sourceCount,
    },
    tier: evidence.tier,
    generatedAt: now.toISOString(),
  }
}
