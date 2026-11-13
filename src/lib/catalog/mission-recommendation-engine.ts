/**
 * Sohee Mission Recommendation Engine (ANI-315)
 * 
 * 1. Multi-Factor Contextual Scoring:
 *    - Idle slot urgency
 *    - Unanswered lead inquiries
 *    - Channel freshness
 *    - Available SC balance
 * 2. Real-time Top 3 Ranked Missions
 * 3. "남은 크레딧 가치 업무 제안" (Remaining Credit Value Proposal)
 */

import { GROWTH_MISSION_LIBRARY, type GrowthMissionTemplate } from './growth-mission-library'

export interface WorkspaceContextForRecommendation {
  idleSlotsCount: number
  unansweredInquiriesCount: number
  daysSinceLastPost: number
  availableSC: number
  currentSeason?: string
}

export interface RankedMission {
  mission: GrowthMissionTemplate
  score: number
  urgencyLabel: '긴급' | '추천' | '기회'
  recommendationReason: string
}

export interface CreditValueProposal {
  availableSC: number
  headline: string
  suggestedMissions: GrowthMissionTemplate[]
  estimatedBusinessValue: string
}

export class MissionRecommendationEngine {
  /**
   * 1. Multi-factor Scoring and Top 3 Mission Ranking
   */
  public static rankMissions(
    context: WorkspaceContextForRecommendation
  ): RankedMission[] {
    const scored: RankedMission[] = GROWTH_MISSION_LIBRARY.map(m => {
      let score = 50
      let reason = '매장 인지도 및 지속 성장을 위한 정기 업무'
      let urgency: RankedMission['urgencyLabel'] = '추천'

      if (context.idleSlotsCount >= 3 && m.category === 'SLOT_FILLING') {
        score += 45
        urgency = '긴급'
        reason = `현재 평일/주말 공실 슬롯이 ${context.idleSlotsCount}개 남아있어 긴급 소진이 필요합니다.`
      } else if (context.unansweredInquiriesCount > 0 && m.category === 'RETENTION_REPEAT') {
        score += 35
        urgency = '긴급'
        reason = `미응답 문의 및 리텐션 관리 대상 고객이 있어 즉시 응대가 유리합니다.`
      } else if (context.daysSinceLastPost >= 3 && (m.category === 'INSTA_THREADS_VIRAL' || m.category === 'NAVER_SEARCH_COLUMN')) {
        score += 30
        urgency = '추천'
        reason = `마지막 포스팅 후 ${context.daysSinceLastPost}일이 경과하여 상권 노출도 유지가 필요합니다.`
      }

      // Budget affordability filter
      if (context.availableSC < m.estimatedSC) {
        score -= 40
      }

      return {
        mission: m,
        score,
        urgencyLabel: urgency,
        recommendationReason: reason
      }
    })

    return scored.sort((a, b) => b.score - a.score).slice(0, 3)
  }

  /**
   * 2. Generate "남은 크레딧 가치 업무 제안" (Credit Value Proposal)
   */
  public static generateCreditValueProposal(
    availableSC: number
  ): CreditValueProposal {
    // Find highest impact missions that fit inside availableSC
    const affordable = GROWTH_MISSION_LIBRARY
      .filter(m => m.estimatedSC <= availableSC)
      .slice(0, 2)

    if (affordable.length === 0) {
      return {
        availableSC,
        headline: `현재 ${availableSC.toLocaleString()} SC가 남아있습니다.`,
        suggestedMissions: [],
        estimatedBusinessValue: '다음 주 월요일 00:00(KST)에 주간 한도가 자동 충전됩니다.'
      }
    }

    const totalCost = affordable.reduce((sum, m) => sum + m.estimatedSC, 0)

    return {
      availableSC,
      headline: `이번 주 남은 ${availableSC.toLocaleString()} SC로 지금 즉시 실행할 수 있는 고가치 업무예요!`,
      suggestedMissions: affordable,
      estimatedBusinessValue: `약 ${totalCost} SC를 활용하여 '${affordable.map(a => a.title.slice(0, 15)).join(', ')}' 업무를 완료하고 공실 방어 및 신규 유입을 창출할 수 있어요.`
    }
  }
}

