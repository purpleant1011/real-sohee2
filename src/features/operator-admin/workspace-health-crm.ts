/**
 * [ANI-471][ANI-740] Operator Lifecycle CRM & Workspace Health Engine
 * Analyzes workspace health scores, energy/credit burn rates, channel activity, and churn risks.
 */

export type ChurnRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface WorkspaceHealthMetrics {
  workspaceId: string
  businessName: string
  healthScore: number // 0 ~ 100
  energyBurnRatePercent: number // weekly energy usage %
  creditBurnRatePercent?: number // backwards-compatible alias
  connectedChannelsCount: number
  daysSinceLastActivity: number
  churnRiskTier: ChurnRiskTier
  recommendedOperatorAction: string
}

export class WorkspaceHealthCrmService {
  public static calculateHealth(params: {
    workspaceId: string
    businessName: string
    energyCapacity?: number
    energyUsed?: number
    creditCapacitySC?: number
    creditsUsedSC?: number
    connectedChannelsCount: number
    daysSinceLastActivity: number
  }): WorkspaceHealthMetrics {
    const { workspaceId, businessName, connectedChannelsCount, daysSinceLastActivity } = params

    const capacity = params.energyCapacity ?? params.creditCapacitySC ?? 0
    const used = params.energyUsed ?? params.creditsUsedSC ?? 0

    const burnRate = capacity > 0 ? (used / capacity) * 100 : 0
    let score = 100

    // Deduct points for inactivity
    if (daysSinceLastActivity > 7) score -= 40
    else if (daysSinceLastActivity > 3) score -= 20

    // Deduct points for disconnected channels
    if (connectedChannelsCount === 0) score -= 30
    else if (connectedChannelsCount === 1) score -= 10

    // Deduct points for low usage
    if (burnRate < 10) score -= 20

    score = Math.max(0, Math.min(100, score))

    let churnRiskTier: ChurnRiskTier = 'LOW'
    let action = '정상 운영 상태 유지'

    if (score < 40) {
      churnRiskTier = 'CRITICAL'
      action = '즉각적인 전담 매니저 1:1 유선 상담 및 온보딩 지원'
    } else if (score < 60) {
      churnRiskTier = 'HIGH'
      action = '미발행 채널 연결 안내 알림톡 및 Agent Energy 추가 충전 안내'
    } else if (score < 80) {
      churnRiskTier = 'MEDIUM'
      action = '주간 성과 리포트 및 맞춤 마케팅 가이드 알림'
    }

    const roundedBurn = Math.round(burnRate)

    return {
      workspaceId,
      businessName,
      healthScore: score,
      energyBurnRatePercent: roundedBurn,
      creditBurnRatePercent: roundedBurn,
      connectedChannelsCount,
      daysSinceLastActivity,
      churnRiskTier,
      recommendedOperatorAction: action
    }
  }
}
