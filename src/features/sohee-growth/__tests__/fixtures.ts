import type { GrowthEvidence } from '../types'

export const EMPTY: GrowthEvidence = {
  profile: {
    nameValid: false,
    industryValid: false,
    locationValid: false,
    summaryValid: false,
    voiceValid: false,
    keywordCount: 0,
    prohibitedTermCount: 0,
  },
  factCounts: {},
  harness: { text: false, image: false, approvalPolicy: false },
  sourceCount: 0,
  channels: { instagram: false, threads: false },
  tier: 'TRIAL',
}

export const FULL: GrowthEvidence = {
  profile: {
    nameValid: true,
    industryValid: true,
    locationValid: true,
    summaryValid: true,
    voiceValid: true,
    keywordCount: 3,
    prohibitedTermCount: 3,
  },
  factCounts: { MENU: 2, PRICE: 2, DIFFERENTIATOR: 1, HOURS: 1, FAQ: 5, PARKING: 1, PROHIBITED: 1 },
  harness: { text: true, image: true, approvalPolicy: true },
  sourceCount: 3,
  channels: { instagram: true, threads: true },
  tier: 'FORMAL',
}

/** 부분적으로만 가르친 예시 (계산 근거는 계획 문서의 점수표) */
export const PARTIAL: GrowthEvidence = {
  profile: {
    nameValid: true,
    industryValid: true,
    locationValid: true,
    summaryValid: true,
    voiceValid: true,
    keywordCount: 2,
    prohibitedTermCount: 2,
  },
  factCounts: { MENU: 1, PRICE: 1, FAQ: 1 },
  harness: { text: true, image: false, approvalPolicy: false },
  sourceCount: 0,
  channels: { instagram: true, threads: false },
  tier: 'FORMAL',
}
