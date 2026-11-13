import type { SoheeReadinessSnapshot } from '@/features/sohee-ready/types'

/**
 * The 9 canonical allowed actions within the Onboarding Conversation Action Contract (ANI-1427).
 */
export const ALLOWED_ONBOARDING_ACTIONS = [
  'save_business_fact_draft',
  'save_channel_intent',
  'start_provider_oauth',
  'save_text_harness_draft',
  'generate_text_harness_test',
  'save_image_rule_draft',
  'generate_image_harness_test',
  'save_operating_policy_draft',
  'navigate_to_required_step',
] as const

export type OnboardingActionType = (typeof ALLOWED_ONBOARDING_ACTIONS)[number]

/**
 * Forbidden actions that must NEVER be executed automatically in Education Mode.
 */
export const FORBIDDEN_EDUCATION_ACTIONS = [
  'publish_post',
  'confirm_readiness_fact',
  'execute_paid_cost',
  'irreversible_write',
] as const

export type ForbiddenEducationAction = (typeof FORBIDDEN_EDUCATION_ACTIONS)[number]

export interface StructuredLineage {
  sourceUtterance: string
  extractedCandidate: Record<string, unknown>
  confidence: number
  validationResult: 'VALID' | 'INVALID' | 'WARNING'
  lastUserCorrection?: string | null
}

export interface HumanTranslation {
  humanSummaryPreview: string
  editPath: string
  reassurance: string
}

export interface ParsedOnboardingAction {
  actionType: OnboardingActionType | ForbiddenEducationAction
  isForbidden: boolean
  forbiddenReason?: string
  extractedCandidate: Record<string, unknown>
  humanTranslation: HumanTranslation
  lineage: StructuredLineage
}

export interface ActionAdmissionContext {
  workspaceId: string
  callerTenantId: string
  mode: 'EDUCATION' | 'PRODUCTION'
  readinessSnapshot?: SoheeReadinessSnapshot | null
  sourceUtterance?: string
}

export interface AdmittedOnboardingAction {
  admitted: boolean
  actionType: OnboardingActionType
  workspaceId: string
  extractedCandidate: Record<string, unknown>
  humanTranslation: HumanTranslation
  lineage: StructuredLineage
  admittedAt: string
}
