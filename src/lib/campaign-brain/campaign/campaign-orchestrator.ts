import type { ActionRiskTier } from '@/types/autonomous-outcome-os';

export type CampaignGoalKpi =
  | 'BOOKING_COUNT'
  | 'NEW_INQUIRIES'
  | 'INSTAGRAM_FOLLOWERS'
  | 'REVENUE_TARGET'
  | 'BRAND_AWARENESS';

export type CampaignAutonomyLevel = 'L0_ADVISORY' | 'L1_DRAFT' | 'L2_APPROVE_TO_RUN' | 'L3_GUARDRAILED_AUTOPILOT';

export interface CampaignGoalSpec {
  goalId: string;
  workspaceId: string;
  naturalPrompt: string;
  primaryKpi: CampaignGoalKpi;
  targetValue: number;
  timeframeDays: number;
  budgetCeilingKrw: number;
  allowedChannels: string[];
  autonomyLevel: CampaignAutonomyLevel;
}

export interface CampaignActionNode {
  nodeId: string;
  stepNumber: number;
  title: string;
  capabilityId: string;
  channel: string;
  riskTier: ActionRiskTier;
  riskClass: 'READ' | 'DRAFT' | 'WRITE' | 'SPEND';
  requiresApproval: boolean;
  estimatedCreditCost: number;
  dependencies: string[];
}

export interface CompiledCampaignPlan {
  campaignId: string;
  goal: CampaignGoalSpec;
  hypothesis: string;
  actionGraph: CampaignActionNode[];
  totalEstimatedCredits: number;
  mandatoryApprovalCount: number;
  status: 'COMPILED' | 'APPROVED' | 'IN_EXECUTION' | 'COMPLETED';
}

export class CampaignOrchestrator {
  /**
   * Compiles natural language marketing goal into an executable Campaign Action Graph (ANI-766)
   */
  compileCampaignPlan(goal: CampaignGoalSpec): CompiledCampaignPlan {
    const campaignId = `cmp_${goal.workspaceId}_${Date.now()}`;
    const actionGraph: CampaignActionNode[] = [];

    // Step 1: Research Node (R0, READ)
    const researchNodeId = `node_${campaignId}_1_research`;
    actionGraph.push({
      nodeId: researchNodeId,
      stepNumber: 1,
      title: '상권 및 경쟁사 검색 신호 조사',
      capabilityId: 'research.analyze_market',
      channel: 'web_search',
      riskTier: 'R0_LOW',
      riskClass: 'READ',
      requiresApproval: false,
      estimatedCreditCost: 5,
      dependencies: [],
    });

    // Step 2: Creative Generation Node (R0, DRAFT)
    const creativeNodeId = `node_${campaignId}_2_creative`;
    actionGraph.push({
      nodeId: creativeNodeId,
      stepNumber: 2,
      title: '채널별 맞춤 콘텐츠 및 카피 제작',
      capabilityId: 'creative.generate_variants',
      channel: goal.allowedChannels[0] || 'instagram',
      riskTier: 'R0_LOW',
      riskClass: 'DRAFT',
      requiresApproval: false,
      estimatedCreditCost: 15,
      dependencies: [researchNodeId],
    });

    // Step 3: Execution Node (R1/R2, WRITE/SPEND)
    const isSpend = goal.budgetCeilingKrw > 0;
    const execNodeId = `node_${campaignId}_3_execution`;
    const requiresExplicitApproval =
      goal.autonomyLevel !== 'L3_GUARDRAILED_AUTOPILOT' || isSpend;

    actionGraph.push({
      nodeId: execNodeId,
      stepNumber: 3,
      title: isSpend ? '광고 캠페인 세팅 및 예산 집행' : '소셜 콘텐츠 발행 및 반응 응대',
      capabilityId: isSpend ? 'naver_ads.update_bid' : 'instagram.publish',
      channel: goal.allowedChannels[0] || 'instagram',
      riskTier: isSpend ? 'R2_CRITICAL' : 'R1_MODERATE',
      riskClass: isSpend ? 'SPEND' : 'WRITE',
      requiresApproval: requiresExplicitApproval,
      estimatedCreditCost: 30,
      dependencies: [creativeNodeId],
    });

    // Step 4: Verification & Attribution Node (R0, READ)
    actionGraph.push({
      nodeId: `node_${campaignId}_4_verify`,
      stepNumber: 4,
      title: '외부 영수증 검증 및 성과 기여도 측정',
      capabilityId: 'attribution.measure_lineage',
      channel: 'analytics',
      riskTier: 'R0_LOW',
      riskClass: 'READ',
      requiresApproval: false,
      estimatedCreditCost: 5,
      dependencies: [execNodeId],
    });

    const totalEstimatedCredits = actionGraph.reduce((sum, n) => sum + n.estimatedCreditCost, 0);
    const mandatoryApprovalCount = actionGraph.filter((n) => n.requiresApproval).length;

    return {
      campaignId,
      goal,
      hypothesis: `[${goal.allowedChannels.join(', ')}] 채널을 통해 ${goal.timeframeDays}일간 ${goal.primaryKpi} 지표를 ${goal.targetValue} 달성한다.`,
      actionGraph,
      totalEstimatedCredits,
      mandatoryApprovalCount,
      status: 'COMPILED',
    };
  }
}
