/**
 * Sohee V0.8.8 Learning Governance Engine
 * [ANI-206] Post-Mission Review + Learning Governance
 */

export interface MissionExecutionSummary {
  missionId: string
  title: string
  targetChannel: string
  targetInquiries: number
  actualInquiries: number
  targetRevenueWon: number
  realizedRevenueWon: number
  bestPerformingKeyword?: string
  identifiedBlocker?: string
}

export interface PlaybookImprovementProposal {
  proposalId: string
  missionId: string
  type: 'pattern_success' | 'bottleneck_fix' | 'playbook_rule_update'
  recommendation: string
  confidenceScore: number
}

export class LearningGovernanceEngine {
  /**
   * Analyzes completed mission outcome and generates structured playbook learning
   */
  static reviewMission(summary: MissionExecutionSummary): PlaybookImprovementProposal[] {
    const proposals: PlaybookImprovementProposal[] = []

    // 1. Success Pattern Detection
    if (summary.realizedRevenueWon >= summary.targetRevenueWon) {
      proposals.push({
        proposalId: `prop-${Date.now()}-1`,
        missionId: summary.missionId,
        type: 'pattern_success',
        recommendation: `미션 목표 초과 달성 (${summary.realizedRevenueWon.toLocaleString()}원). ${summary.bestPerformingKeyword ? `[${summary.bestPerformingKeyword}] 키워드 조합을` : '해당 전략 템플릿을'} 표준 고효율 플레이북으로 승격합니다.`,
        confidenceScore: 0.9
      })
    }

    // 2. Bottleneck / Failure Remediation
    if (summary.actualInquiries < summary.targetInquiries) {
      proposals.push({
        proposalId: `prop-${Date.now()}-2`,
        missionId: summary.missionId,
        type: 'bottleneck_fix',
        recommendation: `문의 전환율 미달 (${summary.actualInquiries}/${summary.targetInquiries}건). ${summary.identifiedBlocker || '게시 시간대 및 CTA 문구'}를 개선하도록 다음 주간 캠페인에 반영합니다.`,
        confidenceScore: 0.8
      })
    }

    return proposals
  }
}
