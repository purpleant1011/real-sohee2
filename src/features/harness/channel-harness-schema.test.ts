import { describe, expect, it } from 'vitest'
import { channelHarnessSchema } from './channel-harness-schema'

const completeHarness = {
  businessFacts: [{ factId: '10000000-0000-4000-8000-000000000001', statement: '청라동에서 예약 상담을 운영합니다.' }],
  persuasion: { audience: '청라동에서 자연스러운 눈썹 상담을 찾는 고객', promise: '상담 전 기준을 차분히 확인합니다.', objections: ['가격이 궁금해요'] },
  textByChannel: { instagram: { purpose: '상담 기준 안내', hook: '상담 전 이것부터 확인해요', structure: ['문제', '기준', '행동'], tone: '차분한 안내', cta: '상담을 예약해 주세요.', prohibitedPhrases: ['최고'] } },
  imageByChannel: { instagram: { aspectRatio: '4:5', subject: '상담 준비 장면', composition: '가까운 손과 도구', avoid: ['고객 얼굴', '로고 복제'] } },
  continuity: { series: '상담 전 확인', recentTopics: ['예약 준비'], nextTopic: '상담 뒤 관리', repetitionRisk: 'low' },
  performanceLearning: { observedSignals: ['저장 반응'], hypothesis: '체크리스트형 첫 문장이 저장을 높인다.' },
  sourceFactIds: ['10000000-0000-4000-8000-000000000001'],
  limitations: ['공개 정보만 사용했어요.'],
}

describe('channelHarnessSchema', () => {
  it('requires all six layers and source evidence', () => {
    expect(channelHarnessSchema.safeParse({ ...completeHarness, imageByChannel: undefined }).success).toBe(false)
  })

  it('rejects a harness without approved source fact IDs', () => {
    expect(channelHarnessSchema.safeParse({ ...completeHarness, sourceFactIds: [] }).success).toBe(false)
  })
})
