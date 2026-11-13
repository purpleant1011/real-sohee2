/** 폐기된 `/onboarding/**` 사용자 화면의 새 위치. 단일 정의 — next.config.ts 와 테스트가 함께 쓴다. */
export const ONBOARDING_REDIRECTS = [
  ['/onboarding', '/start'],
  ['/onboarding/business', '/start'],
  ['/onboarding/profile', '/start'],
  ['/onboarding/channels', '/start?step=channels'],
  ['/onboarding/channels/instagram', '/start?step=channels'],
  ['/onboarding/channels/threads', '/start?step=channels'],
  ['/onboarding/first-post', '/start/preview'],
  ['/onboarding/knowledge', '/app/sohee?tab=training'],
  ['/onboarding/brand', '/app/sohee?tab=training'],
  ['/onboarding/text-harness', '/app/sohee?tab=training'],
  ['/onboarding/image-harness', '/app/sohee?tab=training'],
  ['/onboarding/policy', '/app/sohee?tab=command'],
  ['/onboarding/operating-policy', '/app/sohee?tab=command'],
] as const

export interface NextRedirectRule {
  source: string
  destination: string
  permanent: false
}

/** Phase 5(페이지 삭제·참조 교체)가 끝나기 전까지는 임시(307)로 둔다. */
export function toNextRedirects(): NextRedirectRule[] {
  return [
    ...ONBOARDING_REDIRECTS.map(([source, destination]) => ({ source, destination, permanent: false as const })),
    { source: '/onboarding/:path*', destination: '/start', permanent: false as const },
  ]
}
