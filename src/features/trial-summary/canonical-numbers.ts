/**
 * 가격/크레딧/체험 일수의 단일 출처 (ANI-1523 정본 확정 전까지 모두 null).
 * 이 파일 밖에서 이런 숫자를 쓰지 않는다. 값이 null이면 화면은 숫자 섹션을 그리지 않는다.
 */
export interface CanonicalNumbers {
  monthlyPriceWon: number | null
  includedCredits: number | null
  trialDays: number | null
}

export const CANONICAL_NUMBERS: CanonicalNumbers = {
  monthlyPriceWon: null,
  includedCredits: null,
  trialDays: null,
}

export function hasCanonicalNumbers(n: CanonicalNumbers = CANONICAL_NUMBERS): boolean {
  return n.monthlyPriceWon !== null && n.includedCredits !== null && n.trialDays !== null
}
