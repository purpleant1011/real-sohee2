/**
 * Sohee V0.8.8 Decision Budget & Escalation Engine
 * [ANI-182] Decision Budget & Escalation — 사장님 판단 피로 최소화
 */

export interface RawDecisionInput {
  id: string
  title: string
  category: 'public_publish' | 'price_discount' | 'customer_reply' | 'spend' | 'policy_change'
  businessImpact: 1 | 2 | 3 | 4 | 5
  urgency: 1 | 2 | 3 | 4 | 5
  irreversibility: 1 | 2 | 3 | 4 | 5
  risk: 1 | 2 | 3 | 4 | 5
  description: string
}

export type EscalationTier = 'L1_NOTIFY' | 'L2_BATCH_QUEUE' | 'L3_IMMEDIATE_ESCALATION' | 'L4_SAFETY_HALT'

export interface PrioritizedDecision {
  id: string
  title: string
  category: RawDecisionInput['category']
  score: number // Impact * Urgency * Irreversibility * Risk (Max 625)
  tier: EscalationTier
  canAutoPromote: boolean
  recommendedAction: 'approve' | 'review' | 'reject'
}

export class DecisionBudgetEngine {
  /**
   * Score formula: Impact * Urgency * Irreversibility * Risk
   * Tiering rules:
   * - Score >= 200: L3_IMMEDIATE_ESCALATION (Immediate push)
   * - Score >= 50: L2_BATCH_QUEUE (Decision Queue)
   * - Score < 50: L1_NOTIFY (Notification only, Sohee executes if autonomy permits)
   */
  static evaluate(input: RawDecisionInput): PrioritizedDecision {
    const score = input.businessImpact * input.urgency * input.irreversibility * input.risk

    let tier: EscalationTier = 'L1_NOTIFY'
    if (score >= 200) {
      tier = 'L3_IMMEDIATE_ESCALATION'
    } else if (score >= 50) {
      tier = 'L2_BATCH_QUEUE'
    } else {
      tier = 'L1_NOTIFY'
    }

    // Auto-promotion is allowed only for low-irreversibility content posts (Irreversibility <= 2)
    const canAutoPromote = input.irreversibility <= 2 && input.risk <= 2

    return {
      id: input.id,
      title: input.title,
      category: input.category,
      score,
      tier,
      canAutoPromote,
      recommendedAction: input.risk >= 4 ? 'review' : 'approve'
    }
  }
}
