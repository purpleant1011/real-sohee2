import { describe, expect, it } from 'vitest'
import { resolveStartPageRedirect } from '../entry-gate'

describe('resolveStartPageRedirect', () => {
  it('신청을 마치고 준비된 로그인 사용자는 /start 대신 /app 으로 보낸다 (호스트와 무관)', () => {
    expect(resolveStartPageRedirect({ applicationSubmitted: true, prepared: true, educationShell: false })).toBe('/app')
    expect(resolveStartPageRedirect({ applicationSubmitted: true, prepared: false, educationShell: false })).toBe('/app')
  })
  it('신청 전이거나 교육 셸 준비 전이면 /start 에 머문다', () => {
    expect(resolveStartPageRedirect({ applicationSubmitted: false, prepared: false, educationShell: false })).toBeNull()
    expect(resolveStartPageRedirect({ applicationSubmitted: true, prepared: false, educationShell: true })).toBeNull()
  })
  it('심사 전용 계정(reviewAccount=true)은 /start 대신 항상 /app 으로 보낸다', () => {
    expect(resolveStartPageRedirect({ applicationSubmitted: false, prepared: false, educationShell: false, reviewAccount: true })).toBe('/app')
    expect(resolveStartPageRedirect({ applicationSubmitted: false, prepared: false, educationShell: true, reviewAccount: true })).toBe('/app')
    expect(resolveStartPageRedirect({ applicationSubmitted: true, prepared: false, educationShell: true, reviewAccount: true })).toBe('/app')
  })
  it('reviewAccount가 false이거나 미지정일 때는 기존 규칙 유지', () => {
    expect(resolveStartPageRedirect({ applicationSubmitted: false, prepared: false, educationShell: false, reviewAccount: false })).toBeNull()
  })
})
