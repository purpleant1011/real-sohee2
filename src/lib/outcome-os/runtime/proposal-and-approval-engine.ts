import type {
  WorkProposal,
  ApprovalEnvelope,
  ApprovalSurface,
  ActionRiskTier,
} from '@/types/autonomous-outcome-os';

export interface CreateProposalParams {
  workspaceId: string;
  goalId: string;
  title: string;
  rationale: string;
  allowedChannels: string[];
  estimatedAgentEnergy: number;
  maxDiscountPercentAllowed?: number;
  maxPostsPerDay?: number;
  riskCeiling?: ActionRiskTier;
}

export interface EvaluateAutonomyParams {
  channel: string;
  dailyPostCountSoFar: number;
  requestedDiscountPercent: number;
  actionRiskTier: ActionRiskTier;
}

export function createWorkProposal(params: CreateProposalParams): WorkProposal {
  const {
    workspaceId,
    goalId,
    title,
    rationale,
    allowedChannels,
    estimatedAgentEnergy,
    maxDiscountPercentAllowed = 10,
    maxPostsPerDay = 2,
    riskCeiling = 'R1_MODERATE',
  } = params;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    proposalId: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    goalId,
    title,
    rationale,
    evidenceContext: ['과거 유사 시간대 전환율 +24%', '인스타그램 최근 댓글 참여 증가'],
    expectedOutcome: {
      metricType: 'BOOKING_COUNT',
      estimatedMin: 3,
      estimatedMax: 8,
    },
    executionPlanSummary: [
      '1일차: 주중 특가 혜택 릴스 & 카드뉴스 발행',
      '2일차: 댓글 유입 고객 대상 예약 링크 DM 응대 (초안)',
      '3일차: 마감 임박 스토리 리마인드 및 성과 분석',
    ],
    requiredCapabilities: ['mcp_publish_live', 'mcp_reply_comment', 'mcp_verify_post'],
    estimatedAgentEnergy,
    proposedEnvelope: {
      workspaceId,
      title: `${title} - 승인 범위`,
      autonomyLevel: 'A3_ENVELOPE_AUTONOMY',
      validFrom: now.toISOString(),
      validUntil: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      allowedChannels,
      maxPostsPerDay,
      maxDiscountPercentAllowed,
      dmPolicy: 'AUTONOMOUS',
      maxAgentEnergyCap: estimatedAgentEnergy * 2,
      riskCeiling,
      prohibitedActions: ['ACCOUNT_DELETE', 'OVERSPEND_BUDGET'],
    },
    status: 'PROPOSED',
    createdAt: now.toISOString(),
    expiresAt,
  };
}

export function resolveUnifiedApproval(params: {
  proposal: WorkProposal;
  approvedByUserId: string;
  surface: ApprovalSurface;
}): ApprovalEnvelope {
  const { proposal, approvedByUserId, surface } = params;
  const now = new Date().toISOString();

  return {
    envelopeId: `env_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ...proposal.proposedEnvelope,
    approvedByUserId,
    approvedVia: surface,
    approvedAt: now,
  };
}

export function evaluateAutonomyLevel(
  envelope: ApprovalEnvelope,
  action: EvaluateAutonomyParams
): {
  allowed: boolean;
  requiresOwnerTouch: boolean;
  reason?: string;
} {
  if (envelope.autonomyLevel === 'A0_DISABLED') {
    return { allowed: false, requiresOwnerTouch: true, reason: '자율 실행이 비활성화(A0)되어 있습니다.' };
  }

  if (envelope.autonomyLevel === 'A1_RECOMMEND' || envelope.autonomyLevel === 'A2_ACTION_APPROVAL') {
    return { allowed: true, requiresOwnerTouch: true, reason: '해당 레벨(A1/A2)은 작업 단위 승인이 필요합니다.' };
  }

  // A3 Envelope Autonomy check
  if (!envelope.allowedChannels.includes(action.channel)) {
    return { allowed: false, requiresOwnerTouch: true, reason: `허용되지 않은 채널입니다: ${action.channel}` };
  }

  if (action.dailyPostCountSoFar >= envelope.maxPostsPerDay) {
    return {
      allowed: false,
      requiresOwnerTouch: true,
      reason: `일일 발행 한도(${envelope.maxPostsPerDay}회)를 초과했습니다.`,
    };
  }

  if (action.requestedDiscountPercent > envelope.maxDiscountPercentAllowed) {
    return {
      allowed: false,
      requiresOwnerTouch: true,
      reason: `할인율 상한(${envelope.maxDiscountPercentAllowed}%)을 초과했습니다: ${action.requestedDiscountPercent}%`,
    };
  }

  return { allowed: true, requiresOwnerTouch: false };
}
