import type { LedgerPort } from '@/features/kakao/notify/ledger-port'

/**
 * 솔라피 웹훅이 사용할 원장 주입 지점.
 * Next.js 라우트 파일은 HTTP 메서드 외의 export 를 가질 수 없어 별도 모듈로 둔다.
 * 원장 마이그레이션 적용 전에는 null(미구성)이며, 이때 웹훅은 수신만 확인한다.
 */
let activeLedger: LedgerPort | null = null

export function getLedger(): LedgerPort | null {
  return activeLedger
}

export function setLedger(ledger: LedgerPort | null): void {
  activeLedger = ledger
}
