import { describe, expect, it } from 'vitest'
import { ONBOARDING_REDIRECTS, toNextRedirects } from './onboarding-redirects'

describe('ONBOARDING_REDIRECTS', () => {
  const byFrom = new Map(ONBOARDING_REDIRECTS.map(([from, to]) => [from, to]))

  it('사업자 인증과 준비센터는 /start로 모인다', () => {
    expect(byFrom.get('/onboarding')).toBe('/start')
    expect(byFrom.get('/onboarding/business')).toBe('/start')
    expect(byFrom.get('/onboarding/profile')).toBe('/start')
  })

  it('채널 연결은 /start 채널 단계, 첫 게시물은 미리보기로 간다', () => {
    expect(byFrom.get('/onboarding/channels')).toBe('/start?step=channels')
    expect(byFrom.get('/onboarding/channels/instagram')).toBe('/start?step=channels')
    expect(byFrom.get('/onboarding/first-post')).toBe('/start/preview')
  })

  it('교육·규칙 화면은 소희 메뉴로 간다', () => {
    expect(byFrom.get('/onboarding/knowledge')).toBe('/app/sohee?tab=training')
    expect(byFrom.get('/onboarding/text-harness')).toBe('/app/sohee?tab=training')
    expect(byFrom.get('/onboarding/image-harness')).toBe('/app/sohee?tab=training')
    expect(byFrom.get('/onboarding/policy')).toBe('/app/sohee?tab=command')
  })

  it('목적지가 다시 /onboarding을 가리키는 연쇄 리다이렉트가 없다', () => {
    for (const [, to] of ONBOARDING_REDIRECTS) expect(to.startsWith('/onboarding')).toBe(false)
  })

  it('알 수 없는 하위 경로도 /start로 받는 마지막 규칙이 있다', () => {
    const rules = toNextRedirects()
    expect(rules.at(-1)).toEqual({ source: '/onboarding/:path*', destination: '/start', permanent: false })
  })

  it('Next 규칙은 모두 임시(307) 리다이렉트다 (삭제 전까지 되돌릴 수 있게)', () => {
    expect(toNextRedirects().every((r) => r.permanent === false)).toBe(true)
  })
})
