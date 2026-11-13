import { CATEGORY_LABELS, CATEGORY_WEIGHTS } from './constants'
import type { CategoryKey, CategoryScore, GrowthEvidence } from './types'

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const has = (e: GrowthEvidence, key: string) => (e.factCounts[key] ?? 0) > 0

function rawScores(e: GrowthEvidence): Record<CategoryKey, number> {
  const { profile, harness } = e
  const shopFacts = (['MENU', 'PRICE', 'DIFFERENTIATOR', 'HOURS'] as const).filter((k) => has(e, k)).length
  return {
    shop:
      (profile.nameValid ? 15 : 0) +
      (profile.industryValid ? 15 : 0) +
      (profile.summaryValid ? 15 : 0) +
      (profile.keywordCount > 0 ? 15 : 0) +
      shopFacts * 10,
    customer:
      (profile.locationValid ? 30 : 0) + Math.min(e.factCounts.FAQ ?? 0, 4) * 15 + (has(e, 'PARKING') ? 10 : 0),
    style: (profile.voiceValid ? 30 : 0) + (harness.text ? 30 : 0) + (harness.image ? 40 : 0),
    caution:
      (profile.prohibitedTermCount >= 3 ? 60 : profile.prohibitedTermCount >= 1 ? 40 : 0) +
      (has(e, 'PROHIBITED') ? 40 : 0),
    materials: (Math.min(e.sourceCount, 3) * 100) / 3,
    manual: (harness.approvalPolicy ? 60 : 0) + Math.min(e.sourceCount, 2) * 20,
  }
}

const ORDER: CategoryKey[] = ['shop', 'customer', 'style', 'caution', 'materials', 'manual']

export function computeCategoryScores(e: GrowthEvidence): CategoryScore[] {
  const raw = rawScores(e)
  return ORDER.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    percent: clamp(raw[key]),
    weight: CATEGORY_WEIGHTS[key],
  }))
}

export function computeCompleteness(scores: CategoryScore[]): number {
  const total = scores.reduce((sum, s) => sum + s.percent * s.weight, 0)
  return clamp(total / 100)
}
