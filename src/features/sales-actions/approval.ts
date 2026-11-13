import { createHash } from 'node:crypto'
import { evaluatePolicyGate, type PolicyGateResult } from '@/features/policy-gate/service-policy'
import type { CtaPreflightResult, CtaWarning } from './cta-preflight'
import { ownerPolicyCopy } from './owner-copy'

export type ProposalReview = Readonly<{
  status: PolicyGateResult['status']; reasonCode: string; ownerMessage: string; alternative: string
  gate: PolicyGateResult; executionAllowed: false
}>

/** Evaluates a discount/offer proposal with the service policy gate and translates the result for the owner. */
export function reviewProposalPolicy(gateInput: unknown, now: string, approval?: unknown): ProposalReview {
  const input = approval === undefined ? gateInput : { ...(gateInput as object), approval }
  const gate = evaluatePolicyGate(input, now)
  const copy = ownerPolicyCopy(gate.reason)
  return Object.freeze({ status: gate.status, reasonCode: gate.reason, ownerMessage: copy.message, alternative: copy.alternative, gate, executionAllowed: false as const })
}

export type ReservationRequest = Readonly<{ workspaceId: string; policyFingerprint: string; proposalFingerprint: string; idempotencyKey: string }>
export type ReservationResult = Readonly<{ status: 'RESERVED'; reservationId: string }> | Readonly<{ status: 'CONFLICT' | 'ERROR' }>
/** Atomic budget/discount-case reservation. Implementations must be idempotent on idempotencyKey. */
export type ReservationPort = (request: ReservationRequest) => Promise<ReservationResult>

export type SalesApprovalResult = Readonly<{
  status: 'BLOCKED' | 'OWNER_REVIEW_REQUIRED' | 'REAPPROVAL_REQUIRED' | 'RESERVATION_FAILED' | 'APPROVED_RESERVED'
  ownerMessage: string; alternative: string; reasonCode: string
  warnings: readonly CtaWarning[]; reservationId: string | null
  policyFingerprint: string | null; proposalFingerprint: string | null; executionAllowed: false
}>

/**
 * Owner approval step: policy gate -> CTA preflight -> atomic reservation.
 * It has no publish/send port, so approval can never execute an external action.
 */
export async function approveSalesProposal(input: {
  gateInput: unknown; approval: unknown | undefined; cta: CtaPreflightResult; now: string; reserve: ReservationPort
}): Promise<SalesApprovalResult> {
  const review = reviewProposalPolicy(input.gateInput, input.now, input.approval)
  const base = { warnings: input.cta.warnings, reservationId: null, policyFingerprint: review.gate.policyFingerprint, proposalFingerprint: review.gate.proposalFingerprint, executionAllowed: false as const }
  const stop = (status: SalesApprovalResult['status'], ownerMessage: string, alternative: string, reasonCode: string): SalesApprovalResult =>
    Object.freeze({ ...base, status, ownerMessage, alternative, reasonCode })
  if (review.status === 'BLOCKED') return stop('BLOCKED', review.ownerMessage, review.alternative, review.reasonCode)
  if (review.status === 'OWNER_REVIEW_REQUIRED') return stop('OWNER_REVIEW_REQUIRED', review.ownerMessage, review.alternative, review.reasonCode)
  if (review.status === 'REAPPROVAL_REQUIRED') return stop('REAPPROVAL_REQUIRED', review.ownerMessage, review.alternative, review.reasonCode)
  if (input.cta.status === 'BLOCK') return stop('BLOCKED', input.cta.ownerMessage, '문의 주소를 확인한 뒤 다시 승인해 주세요.', 'CTA_DESTINATION')
  const { policyFingerprint, proposalFingerprint } = review.gate
  const workspaceId = (input.gateInput as { policy: { workspaceId: string } }).policy.workspaceId
  const idempotencyKey = createHash('sha256').update(`${workspaceId}:${policyFingerprint}:${proposalFingerprint}`).digest('hex')
  let reservation: ReservationResult
  try {
    reservation = await input.reserve({ workspaceId, policyFingerprint: policyFingerprint!, proposalFingerprint: proposalFingerprint!, idempotencyKey })
  } catch {
    reservation = { status: 'ERROR' }
  }
  if (reservation.status !== 'RESERVED') {
    return stop('RESERVATION_FAILED', '한도를 확보하지 못해 승인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.', '', `RESERVATION_${reservation.status}`)
  }
  return Object.freeze({ ...base, status: 'APPROVED_RESERVED', ownerMessage: '승인되었어요. 아직 게시나 발송은 시작하지 않았어요.', alternative: '', reasonCode: 'APPROVED', reservationId: reservation.reservationId })
}
