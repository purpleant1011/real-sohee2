import { reviewProposalPolicy } from './approval'
import { ctaPreflight, type CtaWarning } from './cta-preflight'

export type MissionSalesGate = Readonly<{
  status: 'NOT_APPLICABLE' | 'PASS' | 'WARN' | 'BLOCK'
  code: string
  ownerMessage: string
  alternative: string
  warnings: readonly CtaWarning[]
}>

/**
 * Product-path guard for a mission carrying an offer and/or a CTA destination.
 * `NOT_APPLICABLE` is reported honestly when the mission carries no such evidence, so a skipped
 * check is never displayed as a passed check.
 */
export function evaluateMissionSalesGate(metadata: unknown, options: { workspaceId: string; now: string }): MissionSalesGate {
  const raw = (metadata as { salesGate?: unknown } | null | undefined)?.salesGate as
    | { policyInput?: unknown; policyApproval?: unknown; cta?: { destination?: unknown; presence?: unknown } }
    | undefined
  if (!raw || typeof raw !== 'object') {
    return { status: 'NOT_APPLICABLE', code: 'SALES_GATE_NOT_APPLICABLE', ownerMessage: '', alternative: '', warnings: [] }
  }
  const warnings: CtaWarning[] = []
  if (raw.policyInput) {
    const review = reviewProposalPolicy(raw.policyInput, options.now, raw.policyApproval)
    if (review.status === 'BLOCKED') {
      return { status: 'BLOCK', code: 'SERVICE_POLICY_BLOCKED', ownerMessage: review.ownerMessage, alternative: review.alternative, warnings }
    }
    if (review.status === 'REAPPROVAL_REQUIRED') {
      return { status: 'BLOCK', code: 'SERVICE_POLICY_REAPPROVAL_REQUIRED', ownerMessage: review.ownerMessage, alternative: review.alternative, warnings }
    }
  }
  if (raw.cta) {
    const preflight = ctaPreflight({
      workspaceId: options.workspaceId,
      destination: (raw.cta.destination ?? null) as never,
      presence: (raw.cta.presence ?? null) as never,
      now: options.now,
    })
    if (preflight.status === 'BLOCK') {
      return { status: 'BLOCK', code: 'CTA_DESTINATION_BLOCKED', ownerMessage: preflight.ownerMessage, alternative: '문의·예약 주소를 확인한 뒤 다시 시도해 주세요.', warnings }
    }
    warnings.push(...preflight.warnings)
  }
  if (warnings.length) {
    return { status: 'WARN', code: 'SALES_GATE_WARN', ownerMessage: warnings[0].message, alternative: '', warnings }
  }
  return { status: 'PASS', code: 'SALES_GATE_PASSED', ownerMessage: '', alternative: '', warnings: [] }
}
