/**
 * Sohee V0.8.8 Agent Studio & Governance Engines
 * [ANI-190, ANI-191, ANI-192, ANI-193, ANI-194, ANI-196]
 */

// 1. [ANI-190] AgentConfigVersion & Goals
export interface AgentGoal {
  id: string
  type: 'revenue' | 'inquiries' | 'bookings' | 'retention'
  targetValue: number
  currentValue: number
  unit: string
  priority: 1 | 2 | 3
  stopCondition: string
}

export interface AgentConfigVersion {
  version: string
  createdAt: Date
  status: 'active' | 'draft' | 'superseded'
  goals: AgentGoal[]
  primaryMissionTheme: string
}

// 2. [ANI-191] Authority Matrix
export type AutonomyMode = 'SUGGEST' | 'ASSIST' | 'AUTONOMOUS' | 'RESTRICTED'

export interface AuthorityPolicy {
  actionType: string
  desiredMode: AutonomyMode
  actualMode: AutonomyMode
  riskTier: 'R0' | 'R1' | 'R2' | 'R3'
  requiresApproval: boolean
}

// 3. [ANI-192] Playbook Engine
export interface PlaybookStep {
  stepNumber: number
  title: string
  executor: string
  actionType: string
  riskTier: 'R0' | 'R1' | 'R2' | 'R3'
}

export interface Playbook {
  id: string
  title: string
  trigger: string
  version: number
  steps: PlaybookStep[]
  cooldownHours: number
}

// 4. [ANI-193] Knowledge & Marketing Memory
export interface KnowledgeItem {
  id: string
  type: 'brand_tone' | 'service_price' | 'prohibited_claim' | 'learned_pattern'
  content: string
  epistemicTier: 'FACT' | 'INFERENCE' | 'PROVENANCE_VERIFIED'
  confidenceScore: number
  lastVerifiedAt: Date
}

// 5. [ANI-194] Channel Capability Registry
export interface ChannelCapability {
  channel: 'instagram' | 'threads' | 'naver_blog' | 'daangn'
  supportedActions: ('publish_post' | 'read_inquiry' | 'reply_inquiry' | 'schedule_post' | 'send_coupon')[]
  isHealthy: boolean
  lastSyncAt: Date
}

// 6. [ANI-196] Budget & Model Routing
export interface ModelRoutingPolicy {
  taskType: 'fast_chat' | 'complex_strategy' | 'image_prompt' | 'quality_audit'
  model: 'gemini-3.8-flash' | 'gemini-3.5-flash-lite' | 'gemini-2.5-flash' | 'claude-3-5-sonnet'
  maxCostPerCallWon: number
}

export class AgentStudioGovernanceEngine {
  /**
   * Evaluates if an action can be executed without owner approval based on Authority Matrix
   */
  static canExecuteAutonomously(policy: AuthorityPolicy): boolean {
    return policy.actualMode === 'AUTONOMOUS' && !policy.requiresApproval && policy.riskTier !== 'R3'
  }

  /**
   * Routes task to optimal model based on budget policy
   */
  static routeModel(taskType: ModelRoutingPolicy['taskType']): ModelRoutingPolicy {
    switch (taskType) {
      case 'complex_strategy':
        return { taskType, model: 'gemini-3.8-flash', maxCostPerCallWon: 40 }
      case 'quality_audit':
        return { taskType, model: 'gemini-3.8-flash', maxCostPerCallWon: 10 }
      case 'image_prompt':
        return { taskType, model: 'gemini-3.8-flash', maxCostPerCallWon: 10 }
      case 'fast_chat':
      default:
        return { taskType, model: 'gemini-3.5-flash-lite', maxCostPerCallWon: 5 }
    }
  }

  /**
   * Filters and verifies knowledge items: only FACT and verified items are trusted for claims
   */
  static getTrustedFacts(items: KnowledgeItem[]): KnowledgeItem[] {
    return items.filter(k => k.epistemicTier === 'FACT' || k.epistemicTier === 'PROVENANCE_VERIFIED')
  }
}
