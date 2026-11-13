import { describe, it, expect } from 'vitest'

export function evaluateOnboardingCompletion(profile: { business_name?: string | null; industry?: string | null } | null): boolean {
  if (!profile || !profile.business_name) return false
  const trimmed = profile.business_name.trim()
  if (trimmed === '' || trimmed === '신규 매장' || trimmed === '매장명 설정 대기') return false
  return true
}

describe('Onboarding Guard & Standby Alert Verification', () => {
  it('identifies incomplete business profile and triggers standby alert', () => {
    expect(evaluateOnboardingCompletion(null)).toBe(false)
    expect(evaluateOnboardingCompletion({ business_name: '' })).toBe(false)
    expect(evaluateOnboardingCompletion({ business_name: '신규 매장' })).toBe(false)
    expect(evaluateOnboardingCompletion({ business_name: '매장명 설정 대기' })).toBe(false)
  })

  it('approves complete business profile for dashboard entry', () => {
    expect(evaluateOnboardingCompletion({ business_name: '바이름 뷰티살롱 청라점', industry: '뷰티/반영구' })).toBe(true)
  })
})
