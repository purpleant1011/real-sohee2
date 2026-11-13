import { LANDING_EXAMPLES } from '@/features/mobile-landing/landing-model'

/**
 * ANI-1781 (partial): 랜딩 CTA 가 싣는 `industry` 쿼리를 온보딩 첫 단계 프리필로만 쓴다.
 *
 * 값은 읽기만 한다 — 저장 계약은 그대로고, 서버에 이미 업종이 있으면 화면은 서버 값을 쓴다.
 * 알려진 예시 키만 화면 문구로 바꾼다(URL 임의 문자열을 폼 값으로 쓰지 않는다).
 */
export function resolveIndustryPrefill(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (!key) return null
  const example = LANDING_EXAMPLES.find(item => item.key === key)
  return example ? example.industry : null
}
