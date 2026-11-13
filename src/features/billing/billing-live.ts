/**
 * 실결제 라이브 가드
 *
 * 실결제가 일어날 수 있는 경로를 원천 차단한다.
 * NEXT_PUBLIC_BILLING_LIVE === '1' 일 때만 실결제 흐름을 활성화하고,
 * 기본(false) 상태에서는 모든 결제 CTA 비활성화 및 안내 문구를 노출한다.
 */

export function isBillingLive(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_LIVE === '1'
}

export const BILLING_NOT_LIVE_NOTICE = '결제 기능을 곧 열어요'
