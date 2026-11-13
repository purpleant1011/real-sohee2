/**
 * Action-Specific Delegation Envelope (ANI-1252, ANI-1254)
 * 
 * 4-Tier Autonomy Policy:
 * 1. AUTO: Internal drafting, classification, low-risk analytics. Zero external side-effects.
 * 2. CONDITIONAL_AUTO: Repeated actions within pre-approved channel/budget/quiet-hours/brand boundary.
 * 3. ALWAYS_APPROVE: New public publish, external ad spend, bulk messaging, sensitive customer handoff.
 * 4. FORBIDDEN_HANDOFF: Policy boundaries, medical/legal advice, high-risk privacy/disputes.
 */

import crypto from 'crypto';

export type DelegationPolicyTier =
  | 'AUTO'
  | 'CONDITIONAL_AUTO'
  | 'ALWAYS_APPROVE'
  | 'FORBIDDEN_HANDOFF';

export type DelegationDecision =
  | 'AUTO_EXECUTE'
  | 'REQUIRE_APPROVAL'
  | 'REJECT_FORBIDDEN';

export interface ActionExecutionCandidate {
  actionKind: string;
  channel: string;
  estimatedCredits: number;
  confidence?: number;
  spendKrw?: number;
  payload?: Record<string, unknown>;
}

export interface DelegationPolicyRule {
  tier: DelegationPolicyTier;
  allowedChannels?: string[];
  maxCredits?: number;
  maxSpendKrw?: number;
  minConfidence?: number;
  requiresHumanReviewIfConfidenceBelow?: number;
}

export interface DelegationPolicyEnvelope {
  envelopeId: string;
  workspaceId: string;
  version: number;
  fingerprint: string;
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED';
  quietHours?: {
    startHour: number; // e.g. 22 (22:00)
    endHour: number;   // e.g. 8 (08:00)
  };
  rules: Record<string, DelegationPolicyRule>;
}

export interface DelegationEvaluationResult {
  decision: DelegationDecision;
  tier: DelegationPolicyTier;
  requiresApproval: boolean;
  reason?: string;
  envelopeFingerprint: string;
}

export class DelegationEnvelopeManager {
  private envelope: DelegationPolicyEnvelope;

  constructor(envelope: DelegationPolicyEnvelope) {
    this.envelope = envelope;
  }

  getEnvelope(): DelegationPolicyEnvelope {
    return this.envelope;
  }

  evaluate(candidate: ActionExecutionCandidate, currentHour?: number): DelegationEvaluationResult {
    const { actionKind, channel, estimatedCredits, confidence } = candidate;
    const rule = this.envelope.rules[actionKind];
    const fingerprint = this.envelope.fingerprint;

    // Fail-Closed: Unregistered action kinds require explicit approval
    if (!rule) {
      return {
        decision: 'REQUIRE_APPROVAL',
        tier: 'ALWAYS_APPROVE',
        requiresApproval: true,
        reason: `등록되지 않은 작업 유형(${actionKind})으로 사전 승인이 필요합니다.`,
        envelopeFingerprint: fingerprint,
      };
    }

    // 1. AUTO: Internal low-risk actions
    if (rule.tier === 'AUTO') {
      return {
        decision: 'AUTO_EXECUTE',
        tier: 'AUTO',
        requiresApproval: false,
        reason: '내부 안전 작업으로 자동 실행 승인됨',
        envelopeFingerprint: fingerprint,
      };
    }

    // 2. FORBIDDEN_HANDOFF: Policy boundary violation
    if (rule.tier === 'FORBIDDEN_HANDOFF') {
      return {
        decision: 'REJECT_FORBIDDEN',
        tier: 'FORBIDDEN_HANDOFF',
        requiresApproval: true,
        reason: '고위험 또는 정책 금지 행동으로 사람의 직접 검토(Human Review Handoff)가 필요합니다.',
        envelopeFingerprint: fingerprint,
      };
    }

    // 3. ALWAYS_APPROVE: Public feed / Paid spend
    if (rule.tier === 'ALWAYS_APPROVE') {
      return {
        decision: 'REQUIRE_APPROVAL',
        tier: 'ALWAYS_APPROVE',
        requiresApproval: true,
        reason: '공개 채널 발행 또는 유료 집행으로 사장님 승인이 필요합니다.',
        envelopeFingerprint: fingerprint,
      };
    }

    // 4. CONDITIONAL_AUTO: Conditional automatic execution
    if (rule.tier === 'CONDITIONAL_AUTO') {
      const hour = currentHour !== undefined ? currentHour : new Date().getHours();

      // Check Quiet Hours
      if (this.envelope.quietHours) {
        const { startHour, endHour } = this.envelope.quietHours;
        const isQuietTime = startHour > endHour
          ? hour >= startHour || hour < endHour
          : hour >= startHour && hour < endHour;

        if (isQuietTime) {
          return {
            decision: 'REQUIRE_APPROVAL',
            tier: 'CONDITIONAL_AUTO',
            requiresApproval: true,
            reason: `심야 시간대(Quiet Hours) 제한으로 승인이 필요합니다. (${startHour}시~${endHour}시)`,
            envelopeFingerprint: fingerprint,
          };
        }
      }

      // Check Allowed Channels
      if (rule.allowedChannels && !rule.allowedChannels.includes(channel)) {
        return {
          decision: 'REQUIRE_APPROVAL',
          tier: 'CONDITIONAL_AUTO',
          requiresApproval: true,
          reason: `허용되지 않은 채널(${channel})로 승인이 필요합니다.`,
          envelopeFingerprint: fingerprint,
        };
      }

      // Check Max Credits
      if (rule.maxCredits !== undefined && estimatedCredits > rule.maxCredits) {
        return {
          decision: 'REQUIRE_APPROVAL',
          tier: 'CONDITIONAL_AUTO',
          requiresApproval: true,
          reason: `크레딧 한도 초과(요청: ${estimatedCredits}, 한도: ${rule.maxCredits})로 승인이 필요합니다.`,
          envelopeFingerprint: fingerprint,
        };
      }

      // Check Confidence
      if (rule.minConfidence !== undefined && (confidence ?? 0) < rule.minConfidence) {
        return {
          decision: 'REQUIRE_APPROVAL',
          tier: 'CONDITIONAL_AUTO',
          requiresApproval: true,
          reason: `신뢰도 기준 미달(현재: ${confidence ?? 0}, 기준: ${rule.minConfidence})로 승인이 필요합니다.`,
          envelopeFingerprint: fingerprint,
        };
      }

      return {
        decision: 'AUTO_EXECUTE',
        tier: 'CONDITIONAL_AUTO',
        requiresApproval: false,
        reason: '위임 조건(채널, 시간, 예산, 확신도) 충족으로 자동 실행 승인됨',
        envelopeFingerprint: fingerprint,
      };
    }

    return {
      decision: 'REQUIRE_APPROVAL',
      tier: 'ALWAYS_APPROVE',
      requiresApproval: true,
      reason: '알 수 없는 정책 상태로 fail-closed 승인 요구',
      envelopeFingerprint: fingerprint,
    };
  }
}

export interface ReusableDelegationProposal {
  workspaceId: string;
  targetActionKind: string;
  proposedTier: 'CONDITIONAL_AUTO';
  allowedChannel: string;
  maxCredits: number;
  humanReadableSummary: string;
  auditEntry: {
    proposedAt: string;
    proposedBy: string;
    workspaceId: string;
    ruleFingerprint: string;
  };
}

/**
 * Generates a minimal-scope delegation proposal when the owner selects
 * "이 조건은 다음부터 소희에게 맡기기" (ANI-1254).
 */
export function generateMinimalEnvelopeProposal(
  workspaceId: string,
  candidate: ActionExecutionCandidate,
  proposedBy: string
): ReusableDelegationProposal {
  const channelNameMap: Record<string, string> = {
    'INSTAGRAM_DM': '인스타그램 DM',
    'NAVER_TALK': '네이버 톡톡',
    'KAKAO_TALK': '카카오톡',
    'INSTAGRAM_FEED': '인스타그램 피드',
    'NAVER_PLACE': '네이버 플레이스',
    'INTERNAL': '내부 작업',
  };

  const channelLabel = channelNameMap[candidate.channel] || candidate.channel;
  const maxCredits = candidate.estimatedCredits || 10;
  const ruleFingerprint = crypto
    .createHash('sha256')
    .update(`${workspaceId}:${candidate.actionKind}:${candidate.channel}:${maxCredits}`)
    .digest('hex')
    .slice(0, 16);

  const humanReadableSummary = `${channelLabel} 단순 문의 답변 초안 준비 (최대 ${maxCredits} 크레딧, 영업 시간 내)`;

  return {
    workspaceId,
    targetActionKind: candidate.actionKind,
    proposedTier: 'CONDITIONAL_AUTO',
    allowedChannel: candidate.channel,
    maxCredits,
    humanReadableSummary,
    auditEntry: {
      proposedAt: new Date().toISOString(),
      proposedBy,
      workspaceId,
      ruleFingerprint,
    },
  };
}
