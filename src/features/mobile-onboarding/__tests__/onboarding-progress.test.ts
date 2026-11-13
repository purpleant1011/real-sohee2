// ANI-1781 (M03): 서버 값만으로 온보딩 진행을 복원한다. 단계 모델은 위저드와 같다(가게→말투→계정→첫 글).
import { describe, expect, it } from 'vitest'
import { deriveOnboardingStep } from '../onboarding-progress'

const SHOP = { business_name: '봄날', industry: '카페·디저트', summary: '동네 카페' }
const NO_FACTS = { TEXT_HARNESS_CONFIRMED: false, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: false }

describe('deriveOnboardingStep (서버 값만으로 복원)', () => {
  it('프로필이 없으면 1단계 가게', () => {
    expect(deriveOnboardingStep({ profile: null, facts: NO_FACTS })).toEqual({ step: 'shop', index: 1, total: 4 })
  })

  it('가게 정보가 다 차면 2단계 말투', () => {
    expect(deriveOnboardingStep({ profile: SHOP, facts: NO_FACTS })).toMatchObject({ step: 'tone', index: 2 })
  })

  it('한 줄 소개가 비어 있으면 아직 1단계다 — 위저드의 shopValid 와 같은 기준', () => {
    const input = { profile: { business_name: '봄날', industry: '카페·디저트', summary: '   ' }, facts: NO_FACTS }
    expect(deriveOnboardingStep(input).step).toBe('shop')
  })

  it('말투(글 쓰기 기준)가 서버에 확정되면 3단계 계정', () => {
    const facts = { ...NO_FACTS, TEXT_HARNESS_CONFIRMED: true }
    expect(deriveOnboardingStep({ profile: SHOP, facts })).toMatchObject({ step: 'channels', index: 3 })
  })

  it('채널 하나만 검증되어도 4단계 첫 글 — 두 채널 동시 인증은 요구하지 않는다(ANI-1524)', () => {
    const facts = { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: true, THREADS_VERIFIED: false }
    const result = deriveOnboardingStep({ profile: SHOP, facts })
    expect(result).toEqual({ step: 'preview', index: 4, total: 4, blockedByChannel: false })
  })

  it('스레드만 연결되어도 4단계다', () => {
    const facts = { TEXT_HARNESS_CONFIRMED: true, INSTAGRAM_VERIFIED: false, THREADS_VERIFIED: true }
    expect(deriveOnboardingStep({ profile: SHOP, facts }).step).toBe('preview')
  })

  it('확인되지 않은 값(true 가 아닌 값)은 완료로 올리지 않는다', () => {
    // 서버 응답이 boolean 이 아니게 깨진 경우까지 막는다.
    const facts = {
      TEXT_HARNESS_CONFIRMED: 'true',
      INSTAGRAM_VERIFIED: 1,
      THREADS_VERIFIED: null,
    } as unknown as Partial<import('../onboarding-progress').OnboardingFacts>
    expect(deriveOnboardingStep({ profile: SHOP, facts }).step).toBe('tone')
  })

  it('조회 실패는 빈 상태가 아니라 error 로 구분한다', () => {
    expect(deriveOnboardingStep({ error: true })).toEqual({ step: 'error', index: 0, total: 4 })
  })
})
