export type CreditGovernorState = 'HEALTHY' | 'CONSERVE' | 'CRITICAL' | 'DEPLETED'

export interface CreditGovernorStatus {
  state: CreditGovernorState
  availableCredits: number
  totalCapacity: number
  burnRatePercentage: number
  recommendation: string
  canInitiateNewBillableAction: boolean
}

/**
 * 3차 수정 Credit Governor 정책
 */
export function evaluateCreditGovernor(availableCredits: number, totalCapacity = 6000): CreditGovernorStatus {
  if (availableCredits <= 0) {
    return {
      state: 'DEPLETED',
      availableCredits: 0,
      totalCapacity,
      burnRatePercentage: 100,
      recommendation: '무료체험 크레딧이 모두 소진되었습니다. 정식 플랜 구독 시 마케팅 루틴이 계속 유지됩니다.',
      canInitiateNewBillableAction: false,
    }
  }

  const ratio = (availableCredits / totalCapacity) * 100

  if (ratio < 10) {
    return {
      state: 'CRITICAL',
      availableCredits,
      totalCapacity,
      burnRatePercentage: 100 - ratio,
      recommendation: '크레딧이 거의 소진되었습니다 (10% 미만). 남은 잔액 내에서 완료 가능한 필수 업무만 추천합니다.',
      canInitiateNewBillableAction: true,
    }
  }

  if (ratio < 30) {
    return {
      state: 'CONSERVE',
      availableCredits,
      totalCapacity,
      burnRatePercentage: 100 - ratio,
      recommendation: '크레딧 절약 모드입니다. 대형 이미지 생성보다 검증된 핵심 채널 실게시 위주로 업무를 배분합니다.',
      canInitiateNewBillableAction: true,
    }
  }

  return {
    state: 'HEALTHY',
    availableCredits,
    totalCapacity,
    burnRatePercentage: 100 - ratio,
    recommendation: '크레딧이 충분합니다. 소희의 마케팅 루틴이 정상 가동 중입니다.',
    canInitiateNewBillableAction: true,
  }
}
