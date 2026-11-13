import type {
  ParsedOnboardingAction,
  ActionAdmissionContext,
  AdmittedOnboardingAction,
  OnboardingActionType,
} from './types'
import { isForbiddenEducationAction } from './action-parser'

export class OnboardingActionAdmissionError extends Error {
  public readonly code:
    | 'CROSS_TENANT_ACCESS_DENIED'
    | 'CONFIRM_BOUNDARY_BLOCKED'
    | 'READINESS_PREREQUISITE_MISSING'
    | 'INVALID_ACTION'
  public readonly remediationHref?: string

  constructor(
    code:
      | 'CROSS_TENANT_ACCESS_DENIED'
      | 'CONFIRM_BOUNDARY_BLOCKED'
      | 'READINESS_PREREQUISITE_MISSING'
      | 'INVALID_ACTION',
    message: string,
    remediationHref?: string
  ) {
    super(message)
    this.name = 'OnboardingActionAdmissionError'
    this.code = code
    this.remediationHref = remediationHref
  }
}

export function admitOnboardingAction(
  action: ParsedOnboardingAction,
  context: ActionAdmissionContext
): AdmittedOnboardingAction {
  // 1. Tenant Isolation Guard: Reject cross-tenant access without revealing raw IDs
  if (context.workspaceId !== context.callerTenantId) {
    throw new OnboardingActionAdmissionError(
      'CROSS_TENANT_ACCESS_DENIED',
      '해당 매장의 접근 권한이 확인되지 않았습니다. 현재 로그인한 매장 계정으로 다시 접속해 주세요.'
    )
  }

  // 2. Confirm Boundary Guard: Strictly block irreversible writes/publishing in Education Mode
  if (action.isForbidden || isForbiddenEducationAction(action.actionType)) {
    // Determine remediation path from readiness snapshot
    let remediationHref = '/start'
    if (context.readinessSnapshot?.facts) {
      if (!context.readinessSnapshot.facts.BUSINESS_VERIFIED?.verified) {
        remediationHref = '/start'
      } else if (
        !context.readinessSnapshot.facts.INSTAGRAM_VERIFIED?.verified &&
        !context.readinessSnapshot.facts.THREADS_VERIFIED?.verified
      ) {
        remediationHref = '/start?step=channels'
      } else if (!context.readinessSnapshot.facts.BUSINESS_KNOWLEDGE_CONFIRMED?.verified) {
        remediationHref = '/app/sohee?tab=training'
      } else if (!context.readinessSnapshot.facts.TEXT_HARNESS_CONFIRMED?.verified) {
        remediationHref = '/app/sohee?tab=training'
      } else if (!context.readinessSnapshot.facts.IMAGE_HARNESS_CONFIRMED?.verified) {
        remediationHref = '/app/sohee?tab=training'
      } else if (!context.readinessSnapshot.facts.OPERATING_POLICY_CONFIRMED?.verified) {
        remediationHref = '/app/sohee?tab=command'
      }
    }

    throw new OnboardingActionAdmissionError(
      'CONFIRM_BOUNDARY_BLOCKED',
      '소희는 사장님의 사전 승인 없이 마음대로 게시물을 발행하지 않아요. 안전한 발행을 위해 남은 준비 단계를 먼저 확인해 볼까요?',
      remediationHref
    )
  }

  // 3. Admission Succeeded: Return frozen admitted action record
  return Object.freeze({
    admitted: true,
    actionType: action.actionType as OnboardingActionType,
    workspaceId: context.workspaceId,
    extractedCandidate: action.extractedCandidate,
    humanTranslation: action.humanTranslation,
    lineage: action.lineage,
    admittedAt: new Date().toISOString(),
  })
}
