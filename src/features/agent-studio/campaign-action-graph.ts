/**
 * Campaign ActionGraph Engine (ANI-860)
 * 
 * 9단계 엔드투엔드 사이클:
 * Research -> Strategy -> Plan -> Creative -> Approval -> Execute -> Verify -> Attribute -> Learn
 */

export type CampaignStage =
  | 'RESEARCH'
  | 'STRATEGY'
  | 'PLAN'
  | 'CREATIVE'
  | 'APPROVAL'
  | 'EXECUTE'
  | 'VERIFY'
  | 'ATTRIBUTE'
  | 'LEARN';

export interface CampaignNode {
  stage: CampaignStage;
  isCompleted: boolean;
  outputSummary?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
}

export interface CampaignGraph {
  campaignId: string;
  workspaceId: string;
  name: string;
  currentStage: CampaignStage;
  nodes: Record<CampaignStage, CampaignNode>;
  isFullyCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export const CAMPAIGN_STAGES_ORDER: CampaignStage[] = [
  'RESEARCH',
  'STRATEGY',
  'PLAN',
  'CREATIVE',
  'APPROVAL',
  'EXECUTE',
  'VERIFY',
  'ATTRIBUTE',
  'LEARN',
];

export class CampaignActionGraphEngine {
  private campaigns: Map<string, CampaignGraph> = new Map();

  /**
   * 신규 9단계 캠페인 액션 그래프 생성 (ANI-860)
   */
  createCampaign(workspaceId: string, name: string): CampaignGraph {
    const campaignId = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const nodes: Record<CampaignStage, CampaignNode> = {
      RESEARCH: { stage: 'RESEARCH', isCompleted: false, metadata: {} },
      STRATEGY: { stage: 'STRATEGY', isCompleted: false, metadata: {} },
      PLAN: { stage: 'PLAN', isCompleted: false, metadata: {} },
      CREATIVE: { stage: 'CREATIVE', isCompleted: false, metadata: {} },
      APPROVAL: { stage: 'APPROVAL', isCompleted: false, metadata: {} },
      EXECUTE: { stage: 'EXECUTE', isCompleted: false, metadata: {} },
      VERIFY: { stage: 'VERIFY', isCompleted: false, metadata: {} },
      ATTRIBUTE: { stage: 'ATTRIBUTE', isCompleted: false, metadata: {} },
      LEARN: { stage: 'LEARN', isCompleted: false, metadata: {} },
    };

    const campaign: CampaignGraph = {
      campaignId,
      workspaceId,
      name,
      currentStage: 'RESEARCH',
      nodes,
      isFullyCompleted: false,
      createdAt: now,
      updatedAt: now,
    };

    this.campaigns.set(campaignId, campaign);
    return campaign;
  }

  /**
   * 단계 완료 및 다음 단계 전이
   */
  completeStage(
    campaignId: string,
    stage: CampaignStage,
    outputSummary: string,
    metadata: Record<string, unknown> = {}
  ): CampaignGraph {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const node = campaign.nodes[stage];
    node.isCompleted = true;
    node.outputSummary = outputSummary;
    node.completedAt = new Date().toISOString();
    node.metadata = metadata;

    const currentIndex = CAMPAIGN_STAGES_ORDER.indexOf(stage);
    if (currentIndex < CAMPAIGN_STAGES_ORDER.length - 1) {
      campaign.currentStage = CAMPAIGN_STAGES_ORDER[currentIndex + 1];
    } else {
      campaign.isFullyCompleted = true;
    }

    campaign.updatedAt = new Date().toISOString();
    return campaign;
  }

  getCampaign(campaignId: string): CampaignGraph | undefined {
    return this.campaigns.get(campaignId);
  }
}
