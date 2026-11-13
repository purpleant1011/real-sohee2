import {
  CreditReservation,
  CreditTransactionState,
  ActionCostQuote,
  OFFICIAL_CREDIT_UNIT,
} from './types';

export interface CreditAccountBalance {
  workspaceId: string;
  baseCredits: number;
  bonusCredits: number;
  reservedCredits: number;
  settledCredits: number;
}

export interface ReserveCreditParams {
  workspaceId: string;
  quote: ActionCostQuote;
  actionRunId: string;
  idempotencyKey: string;
  balance: CreditAccountBalance;
}

export interface SettleCreditParams {
  reservationId: string;
  actualCost?: number; // quote 대비 실비 정산 가능 (기본값은 quote 금액)
}

export interface ReleaseCreditParams {
  reservationId: string;
  reason: string;
}

export class CreditTransactionStateMachine {
  private reservations: Map<string, CreditReservation> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> reservationId

  /**
   * 가용 크레딧 계산
   */
  getAvailableCredits(balance: CreditAccountBalance): number {
    return Math.max(0, balance.baseCredits + balance.bonusCredits - balance.reservedCredits);
  }

  /**
   * 1. RESERVE: 사전 차감 예약 (ANI-821, ANI-824, ANI-825)
   */
  reserve(params: {
    workspaceId: string;
    quote: ActionCostQuote;
    actionRunId: string;
    idempotencyKey: string;
    balance: CreditAccountBalance;
  }): {
    success: boolean;
    reservation?: CreditReservation;
    updatedBalance: CreditAccountBalance;
    errorCode?: 'IDEMPOTENT_HIT' | 'INSUFFICIENT_CREDITS' | 'QUOTE_EXPIRED' | 'ZERO_CREDITS';
    errorMessage?: string;
  } {
    const { workspaceId, quote, actionRunId, idempotencyKey, balance } = params;

    // 멱등성 검사: 동일 멱등키가 이미 존재하면 해당 예약 반환
    const existingReservationId = this.idempotencyIndex.get(idempotencyKey);
    if (existingReservationId) {
      const existing = this.reservations.get(existingReservationId);
      if (existing) {
        return {
          success: true,
          reservation: existing,
          updatedBalance: balance,
          errorCode: 'IDEMPOTENT_HIT',
        };
      }
    }

    // Quote TTL 만료 검사 (ANI-824)
    if (new Date(quote.expiresAt).getTime() <= Date.now()) {
      return {
        success: false,
        updatedBalance: balance,
        errorCode: 'QUOTE_EXPIRED',
        errorMessage: `견적 유효시간이 만료되었습니다. (quoteId: ${quote.quoteId})`,
      };
    }

    // 잔액 검사 (ANI-825 Zero Credit Semantics)
    const available = this.getAvailableCredits(balance);
    if (available <= 0) {
      return {
        success: false,
        updatedBalance: balance,
        errorCode: 'ZERO_CREDITS',
        errorMessage: `사용 가능한 소희 크레딧이 0입니다. 크레딧을 충전하거나 플랜을 업그레이드해주세요.`,
      };
    }

    if (available < quote.requiredCredits) {
      return {
        success: false,
        updatedBalance: balance,
        errorCode: 'INSUFFICIENT_CREDITS',
        errorMessage: `소희 크레딧 잔액이 부족합니다. (필요: ${quote.requiredCredits}, 보유 가용: ${available})`,
      };
    }

    // 신규 예약 생성
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const reservation: CreditReservation = {
      reservationId,
      workspaceId,
      quoteId: quote.quoteId,
      actionRunId,
      amount: quote.requiredCredits,
      state: 'RESERVED',
      reservedAt: new Date().toISOString(),
      idempotencyKey,
    };

    this.reservations.set(reservationId, reservation);
    this.idempotencyIndex.set(idempotencyKey, reservationId);

    const updatedBalance: CreditAccountBalance = {
      ...balance,
      reservedCredits: balance.reservedCredits + quote.requiredCredits,
    };

    return {
      success: true,
      reservation,
      updatedBalance,
    };
  }

  /**
   * 2. START_EXECUTION: 실행 상태 전이
   */
  startExecution(reservationId: string): CreditReservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }
    if (reservation.state !== 'RESERVED') {
      throw new Error(`Invalid state transition: Cannot execute from ${reservation.state}`);
    }

    reservation.state = 'EXECUTING';
    return reservation;
  }

  /**
   * 3. SETTLE: 성공 시 확정 차감 (ANI-821)
   */
  settle(
    reservationId: string,
    balance: CreditAccountBalance,
    actualCost?: number
  ): {
    reservation: CreditReservation;
    updatedBalance: CreditAccountBalance;
    deductedAmount: number;
  } {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }

    if (reservation.state !== 'RESERVED' && reservation.state !== 'EXECUTING') {
      throw new Error(`Cannot settle reservation in state: ${reservation.state}`);
    }

    const finalAmount = actualCost !== undefined ? actualCost : reservation.amount;
    reservation.state = 'SETTLED';
    reservation.settledAt = new Date().toISOString();
    reservation.amount = finalAmount;

    // base -> bonus 순서로 소진 차감
    const reservedToFree = reservation.amount;
    let remainingToDeduct = finalAmount;
    let newBase = balance.baseCredits;
    let newBonus = balance.bonusCredits;

    if (newBase >= remainingToDeduct) {
      newBase -= remainingToDeduct;
      remainingToDeduct = 0;
    } else {
      remainingToDeduct -= newBase;
      newBase = 0;
      newBonus = Math.max(0, newBonus - remainingToDeduct);
    }

    const updatedBalance: CreditAccountBalance = {
      workspaceId: balance.workspaceId,
      baseCredits: newBase,
      bonusCredits: newBonus,
      reservedCredits: Math.max(0, balance.reservedCredits - reservedToFree),
      settledCredits: balance.settledCredits + finalAmount,
    };

    return {
      reservation,
      updatedBalance,
      deductedAmount: finalAmount,
    };
  }

  /**
   * 4. RELEASE: 실패 또는 취소 시 가용 잔액 환원 (ANI-821)
   */
  release(
    reservationId: string,
    balance: CreditAccountBalance,
    reason: string
  ): {
    reservation: CreditReservation;
    updatedBalance: CreditAccountBalance;
    releasedAmount: number;
  } {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation not found: ${reservationId}`);
    }

    if (reservation.state === 'SETTLED') {
      throw new Error(`Cannot release already SETTLED reservation: ${reservationId}`);
    }
    if (reservation.state === 'RELEASED') {
      // 이미 릴리즈됨
      return {
        reservation,
        updatedBalance: balance,
        releasedAmount: 0,
      };
    }

    const amountToRelease = reservation.amount;
    reservation.state = 'RELEASED';
    reservation.releasedAt = new Date().toISOString();

    const updatedBalance: CreditAccountBalance = {
      ...balance,
      reservedCredits: Math.max(0, balance.reservedCredits - amountToRelease),
    };

    return {
      reservation,
      updatedBalance,
      releasedAmount: amountToRelease,
    };
  }

  /**
   * 특정 예약 조회
   */
  getReservation(reservationId: string): CreditReservation | undefined {
    return this.reservations.get(reservationId);
  }
}
