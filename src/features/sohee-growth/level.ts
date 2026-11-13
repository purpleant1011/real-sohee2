import { FINAL_LEVEL_NAME, LEVEL_NAMES } from './constants'
import type { LadderStep, LevelInfo, RequirementKey, RequirementResult } from './types'

/** 단계 n 의 요건(1~4). 5단계 상담원은 아직 평가하지 않는다. */
export const TIER_REQUIREMENTS: ReadonlyArray<readonly RequirementKey[]> = [
  ['shop_basic', 'voice'],
  ['caution', 'image_style', 'channel'],
  ['faq'],
  ['manual', 'booking_rules', 'products'],
]

export function computeLevel(requirements: RequirementResult[]): LevelInfo {
  const done = new Set(requirements.filter((r) => r.done).map((r) => r.key))
  let level = 0
  for (const tier of TIER_REQUIREMENTS) {
    if (tier.every((key) => done.has(key))) level += 1
    else break
  }
  const lv = level as 0 | 1 | 2 | 3 | 4

  const ladder: LadderStep[] = [1, 2, 3, 4].map((n) => ({
    level: n,
    name: LEVEL_NAMES[n],
    state: lv >= n ? (lv === n ? 'current' : 'done') : 'upcoming',
  }))
  ladder.push({ level: 5, name: FINAL_LEVEL_NAME, state: 'upcoming', soon: true })

  return {
    level: lv,
    name: LEVEL_NAMES[lv],
    nextName: lv < 4 ? LEVEL_NAMES[lv + 1] : FINAL_LEVEL_NAME,
    ladder,
  }
}
