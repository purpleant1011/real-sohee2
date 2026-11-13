import type { CreditBalance } from '@/features/credits/types'
import type { AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { CreditViewSnapshot } from '../credit-view'

export interface CreditSnapshotInput {
  /** getCreditBalance 결과. 조회에 실패했으면 null. */
  balance: CreditBalance | null
  /** get_workspace_authoritative_credit_balance 의 사용 가능 크레딧. 확인 못 했으면 null. */
  authoritativeAvailable: number | null
  /** 서버가 값을 읽은 시각(ISO). */
  checkedAt: string
}

/**
 * M25 요금·크레딧 스냅샷 — 기존 서버 읽기(`getCreditBalance`,
 * `get_workspace_authoritative_credit_balance`)만 옮겨 담는다. 새 API·쓰기 경로를 만들지 않는다.
 *
 * 원천이 하나도 없으면 0 이 아니라 error 로 닫는다. 조회 실패를 '잔액 0' 으로 보여주면
 * 사장님이 충전이 필요하다고 오해한다.
 */
export function buildCreditSnapshot(input: CreditSnapshotInput): CreditViewSnapshot {
  const anyOk = input.balance !== null || input.authoritativeAvailable !== null

  return {
    loadState: anyOk ? 'ready' : 'error',
    credit: {
      // 실행 가능 판정에 쓰이는 값과 같은 원천(authoritative)만 쓴다. 없으면 null 이지 0 이 아니다.
      available: input.authoritativeAvailable,
      reserved: input.balance?.reserved ?? null,
      consumed: input.balance?.consumed ?? null,
      // 기존 화면의 '반환' 과 같은 값(balance.released). 원장 종류를 다시 해석하지 않는다.
      refunded: input.balance?.released ?? null,
      observedAt: anyOk ? input.checkedAt : null,
    },
    // 예약금 원장은 이 화면이 읽지 않는다. 읽지 않은 값을 0 으로 채우지 않는다.
    customerDeposit: null,
    // 이 화면에는 실행할 작업이 없다. 예상 비용을 지어내지 않는다.
    estimate: null,
    checkedAt: anyOk ? input.checkedAt : null,
  }
}

/**
 * 인증(401)·권한(403) 거부로 원장을 아예 읽지 못한 스냅샷(ANI-1714).
 * 이때는 '잔액 0'도 '조회 실패(다시 확인)'도 아니다 — 다시 로그인하거나 권한을 받아야 한다.
 * 원장 값은 null 로 두고 0 을 지어내지 않는다.
 */
export function buildAuthFailureCreditSnapshot(authFailure: AuthFailure): CreditViewSnapshot {
  return {
    loadState: 'error',
    credit: { available: null, reserved: null, consumed: null, refunded: null, observedAt: null },
    customerDeposit: null,
    estimate: null,
    checkedAt: null,
    authFailure,
  }
}
