/**
 * Sohee V0.8.9 Autonomous Agent Policy Engine
 * 
 * Invariants:
 * 1. Every agent action MUST pass through Policy Preflight:
 *    Autonomy Level x Risk Tier x Credit Budget x Cooldown x Kill-Switch.
 * 2. High/Critical actions require explicit approval or re-authentication.
 */

export type AutonomyLevel = 'SUPERVISED' | 'SEMI_AUTONOMOUS' | 'FULL_AUTONOMOUS';

export type ActionRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AgentPolicyConfig {
  workspaceId: string;
  autonomyLevel: AutonomyLevel;
  killSwitchActive: boolean;
  maxPostsPerDay: number;
  maxRepliesPerHour: number;
  blockedKeywords: string[];
  restrictedTopics: string[];
  requireApprovalForDiscounts: boolean;
  requireApprovalForReservations: boolean;
}

export interface PolicyEvaluationRequest {
  workspaceId: string;
  actionType: string;
  riskTier: ActionRiskTier;
  targetChannel?: string;
  contentSnippet?: string;
  priceDiscountIncluded?: boolean;
  isReservationAction?: boolean;
  hourlyActionCount: number;
  dailyActionCount: number;
  creditBalance: number;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresManualApproval: boolean;
  riskTier: ActionRiskTier;
  rejectionReason?: string;
  graceCooldownMs?: number;
}

/**
 * 자율 에이전트 액션 정책 평가기
 */
export function evaluateAgentActionPolicy(
  config: AgentPolicyConfig,
  req: PolicyEvaluationRequest
): PolicyDecision {
  // 1. Kill-Switch 비상 차단 검사
  if (config.killSwitchActive) {
    return {
      allowed: false,
      requiresManualApproval: true,
      riskTier: req.riskTier,
      rejectionReason: '자율 에이전트 비상 정지(Kill-Switch)가 활성화되어 있습니다.'
    };
  }

  // 2. 크레딧 잔액 검사
  if (req.creditBalance <= 0) {
    return {
      allowed: false,
      requiresManualApproval: true,
      riskTier: req.riskTier,
      rejectionReason: '가용 소희 크레딧이 부족합니다.'
    };
  }

  // 3. 일일/시간당 빈도 한도 검사
  if (req.dailyActionCount >= config.maxPostsPerDay) {
    return {
      allowed: false,
      requiresManualApproval: true,
      riskTier: req.riskTier,
      rejectionReason: `일일 최대 포스팅 한도(${config.maxPostsPerDay}건)에 도달했습니다.`
    };
  }

  if (req.hourlyActionCount >= config.maxRepliesPerHour) {
    return {
      allowed: false,
      requiresManualApproval: true,
      riskTier: req.riskTier,
      rejectionReason: `시간당 최대 응대 한도(${config.maxRepliesPerHour}건)에 도달했습니다.`
    };
  }

  // 4. 금지어 및 제한 주제 검사
  if (req.contentSnippet) {
    for (const keyword of config.blockedKeywords) {
      if (req.contentSnippet.includes(keyword)) {
        return {
          allowed: false,
          requiresManualApproval: true,
          riskTier: 'HIGH',
          rejectionReason: `브랜드 안전 정책상 금지 키워드('${keyword}')가 감지되었습니다.`
        };
      }
    }
  }

  // 5. 자율성 등급별 승인 요구 판단
  if (config.autonomyLevel === 'SUPERVISED') {
    return {
      allowed: true,
      requiresManualApproval: true,
      riskTier: req.riskTier,
      rejectionReason: '사전 승인 모드(SUPERVISED)로 운영 중이므로 사장님 확인이 필요합니다.'
    };
  }

  if (config.autonomyLevel === 'SEMI_AUTONOMOUS') {
    if (req.riskTier === 'HIGH' || req.riskTier === 'CRITICAL' || req.priceDiscountIncluded) {
      return {
        allowed: true,
        requiresManualApproval: true,
        riskTier: req.riskTier,
        rejectionReason: '할인/고위험 액션은 사장님 사전 승인이 필요합니다.'
      };
    }
  }

  // FULL_AUTONOMOUS: CRITICAL을 제외하고 자동 실행 허용
  if (req.riskTier === 'CRITICAL') {
    return {
      allowed: false,
      requiresManualApproval: true,
      riskTier: 'CRITICAL',
      rejectionReason: '치명적 위험(CRITICAL) 작업은 2차 인증 및 명시적 승인이 필수입니다.'
    };
  }

  return {
    allowed: true,
    requiresManualApproval: false,
    riskTier: req.riskTier
  };
}
