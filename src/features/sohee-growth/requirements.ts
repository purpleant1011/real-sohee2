import { FAQ_TARGET } from './constants'
import type { GrowthEvidence, NextStep, RequirementKey, RequirementResult, TeachDestination } from './types'

interface Def {
  key: RequirementKey
  label: string
  destination: TeachDestination
  check: (e: GrowthEvidence) => { done: boolean; remaining?: string }
}

const count = (e: GrowthEvidence, key: string) => e.factCounts[key] ?? 0

const DEFS: Def[] = [
  {
    key: 'shop_basic',
    label: '가게 이름·업종·소개 알려주기',
    destination: 'teach',
    check: (e) => ({ done: e.profile.nameValid && e.profile.industryValid && e.profile.summaryValid }),
  },
  {
    key: 'voice',
    label: '말투 정하기',
    destination: 'work',
    check: (e) => ({ done: e.profile.voiceValid || e.harness.text }),
  },
  {
    key: 'caution',
    label: '조심할 표현 알려주기',
    destination: 'work',
    check: (e) => ({ done: e.profile.prohibitedTermCount >= 1 || count(e, 'PROHIBITED') >= 1 }),
  },
  {
    key: 'image_style',
    label: '이미지 스타일 정하기',
    destination: 'work',
    check: (e) => ({ done: e.harness.image }),
  },
  {
    key: 'channel',
    label: '인스타·스레드 연결하기',
    destination: 'tools',
    check: (e) => ({ done: e.channels.instagram || e.channels.threads }),
  },
  {
    key: 'products',
    label: '상품·가격 알려주기',
    destination: 'teach',
    check: (e) => ({ done: count(e, 'MENU') + count(e, 'PRICE') >= 1 }),
  },
  {
    key: 'faq',
    label: '자주 묻는 질문 알려주기',
    destination: 'teach',
    check: (e) => {
      const n = count(e, 'FAQ')
      return n >= FAQ_TARGET ? { done: true } : { done: false, remaining: `${FAQ_TARGET - n}개 더` }
    },
  },
  {
    key: 'booking_rules',
    label: '가격·영업시간 알려주기',
    destination: 'teach',
    check: (e) => ({ done: count(e, 'PRICE') >= 1 && count(e, 'HOURS') >= 1 }),
  },
  {
    key: 'manual',
    label: '운영 규칙과 매뉴얼 올리기',
    destination: 'teach',
    check: (e) => ({ done: e.harness.approvalPolicy && e.sourceCount >= 1 }),
  },
]

/** 다음 할 일을 고르는 우선순위 (DEFS 순서와 같다). */
export function evaluateRequirements(e: GrowthEvidence): RequirementResult[] {
  return DEFS.map((def) => {
    const { done, remaining } = def.check(e)
    return { key: def.key, label: def.label, done, destination: def.destination, ...(remaining ? { remaining } : {}) }
  })
}

export function pickNextStep(requirements: RequirementResult[]): NextStep | null {
  const first = requirements.find((r) => !r.done)
  return first ? { requirementKey: first.key, title: first.label, destination: first.destination } : null
}
