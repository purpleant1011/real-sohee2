/**
 * ExternalActionReceipt & Durable State Machine (Wave 5: ANI-1085)
 * Disengages provider accept acknowledgment from true external verification,
 * and maintains durable receipt with exact bundle & media digest evidence.
 */

import { createHash } from 'node:crypto'
import type { TargetChannel } from '../creative/visual-brief-types'
import type { VerificationOutcome } from './provider-readback-types'

export type ReceiptVerificationState =
  | 'REQUESTED'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'FAILED'

export interface ExternalActionReceipt {
  receiptId: string
  workspaceId: string
  scheduleId: string
  creativeBundleId: string
  creativeFingerprint: string
  channel: TargetChannel
  orderedMediaSha256: string[]
  providerPayloadDigest: string
  idempotencyKey: string
  providerPostId?: string
  permalink?: string
  state: ReceiptVerificationState
  reasonCode?: string
  observedAt?: string
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateReceiptInput {
  receiptId?: string
  workspaceId: string
  scheduleId: string
  creativeBundleId: string
  creativeFingerprint: string
  channel: TargetChannel
  orderedMediaSha256: string[]
  providerPayloadDigest: string
  idempotencyKey: string
  evidence?: Record<string, unknown>
}

export class ReceiptStateTransitionError extends Error {
  readonly code: string
  constructor(message: string, code = 'INVALID_STATE_TRANSITION') {
    super(message)
    this.name = 'ReceiptStateTransitionError'
    this.code = code
  }
}

// Valid state machine transitions
const ALLOWED_TRANSITIONS: Record<ReceiptVerificationState, ReceiptVerificationState[]> = {
  REQUESTED: ['PROVIDER_ACCEPTED', 'RESULT_UNKNOWN', 'FAILED'],
  PROVIDER_ACCEPTED: ['VERIFICATION_PENDING', 'RESULT_UNKNOWN', 'FAILED'],
  VERIFICATION_PENDING: ['VERIFIED', 'RESULT_UNKNOWN', 'FAILED'],
  RESULT_UNKNOWN: ['VERIFICATION_PENDING', 'VERIFIED', 'FAILED'],
  VERIFIED: [], // Terminal success
  FAILED: ['REQUESTED'], // Can be retried with fresh claim / attempt
}

export function createExternalActionReceipt(input: CreateReceiptInput): ExternalActionReceipt {
  const now = new Date().toISOString()
  return {
    receiptId: input.receiptId ?? crypto.randomUUID(),
    workspaceId: input.workspaceId,
    scheduleId: input.scheduleId,
    creativeBundleId: input.creativeBundleId,
    creativeFingerprint: input.creativeFingerprint,
    channel: input.channel,
    orderedMediaSha256: [...input.orderedMediaSha256],
    providerPayloadDigest: input.providerPayloadDigest,
    idempotencyKey: input.idempotencyKey,
    state: 'REQUESTED',
    evidence: {
      creativeFingerprint: input.creativeFingerprint,
      orderedMediaSha256: [...input.orderedMediaSha256],
      ...(input.evidence ?? {}),
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function transitionReceiptState(
  receipt: ExternalActionReceipt,
  nextState: ReceiptVerificationState,
  params: {
    providerPostId?: string
    permalink?: string
    reasonCode?: string
    observedAt?: string
    additionalEvidence?: Record<string, unknown>
  } = {}
): ExternalActionReceipt {
  // Monotonic Terminal Progress: Never allow late callbacks to downgrade a VERIFIED receipt (ANI-1138)
  // Backwards transitions to REQUESTED are strictly illegal and throw ReceiptStateTransitionError (ANI-1085)
  if (receipt.state === 'VERIFIED') {
    if (nextState === 'REQUESTED') {
      throw new ReceiptStateTransitionError(
        `Cannot transition receipt from ${receipt.state} to ${nextState}`,
        'ILLEGAL_RECEIPT_TRANSITION'
      )
    }
    if (nextState !== 'VERIFIED') {
      return {
        ...receipt,
        evidence: {
          ...receipt.evidence,
          downgradePrevented: true,
          attemptedTransition: nextState,
          attemptedParams: params,
        },
      }
    }
  }

  // Idempotent self-transition: Allow metadata update when nextState === receipt.state
  if (nextState !== receipt.state) {
    const allowed = ALLOWED_TRANSITIONS[receipt.state]
    if (!allowed.includes(nextState)) {
      throw new ReceiptStateTransitionError(
        `Cannot transition receipt from ${receipt.state} to ${nextState}`,
        'ILLEGAL_RECEIPT_TRANSITION'
      )
    }
  }

  // Safety invariant: Never transition directly to VERIFIED without provider post ID
  if (nextState === 'VERIFIED' && !params.providerPostId && !receipt.providerPostId) {
    throw new ReceiptStateTransitionError(
      'Cannot mark receipt as VERIFIED without provider post ID',
      'MISSING_PROVIDER_POST_ID_FOR_VERIFIED'
    )
  }

  const now = new Date().toISOString()
  const providerPostId = params.providerPostId ?? receipt.providerPostId
  const permalink = params.permalink ?? receipt.permalink
  const reasonCode = params.reasonCode ?? receipt.reasonCode
  const observedAt = params.observedAt ?? receipt.observedAt ?? (nextState === 'VERIFIED' ? now : undefined)

  return {
    ...receipt,
    state: nextState,
    providerPostId,
    permalink,
    reasonCode,
    observedAt,
    evidence: {
      ...receipt.evidence,
      ...(providerPostId ? { providerPostId } : {}),
      ...(permalink ? { permalink } : {}),
      ...(reasonCode ? { reasonCode } : {}),
      ...(observedAt ? { observedAt } : {}),
      ...(params.additionalEvidence ?? {}),
      lastStateTransition: {
        from: receipt.state,
        to: nextState,
        at: now,
      },
    },
    updatedAt: now,
  }
}

export function mapOutcomeToReceiptState(outcome: VerificationOutcome): ReceiptVerificationState {
  switch (outcome) {
    case 'VERIFIED':
      return 'VERIFIED'
    case 'VERIFICATION_PENDING':
      return 'VERIFICATION_PENDING'
    case 'RESULT_UNKNOWN':
      return 'RESULT_UNKNOWN'
    case 'MANUAL_REVIEW_REQUIRED':
      return 'VERIFICATION_PENDING'
    case 'VISUAL_MISMATCH':
      return 'FAILED'
  }
}

export function calculatePayloadDigest(payload: Record<string, unknown>): string {
  const serialized = JSON.stringify(payload, Object.keys(payload).sort())
  return createHash('sha256').update(serialized).digest('hex')
}

/**
 * Restores an ExternalActionReceipt from a database row (ANI-1136).
 * Guarantees durable round-trip restoration after F5 / re-login.
 */
export function restoreExternalActionReceipt(row: any): ExternalActionReceipt {
  if (!row || typeof row !== 'object') {
    throw new Error('Invalid receipt database row')
  }

  const evidence = (row.additional_evidence && typeof row.additional_evidence === 'object')
    ? row.additional_evidence
    : (row.raw_evidence && typeof row.raw_evidence === 'object')
    ? row.raw_evidence
    : (row.evidence_details && typeof row.evidence_details === 'object')
    ? row.evidence_details
    : {}

  const rawActionKind = (row.action_kind || '').replace(/_publish$/, '').toLowerCase()
  const channelCandidate = rawActionKind || (row.channel || '').toLowerCase() || (evidence.channel || '').toLowerCase()
  const channel: TargetChannel = (channelCandidate === 'instagram' || channelCandidate === 'threads')
    ? channelCandidate
    : 'instagram'

  return {
    receiptId: row.id,
    workspaceId: row.workspace_id,
    scheduleId: row.schedule_id || '',
    creativeBundleId: row.bundle_id || evidence.creativeBundleId || '',
    creativeFingerprint: evidence.creativeFingerprint || '',
    channel,
    orderedMediaSha256: Array.isArray(evidence.orderedMediaSha256) ? evidence.orderedMediaSha256 : [],
    providerPayloadDigest: row.request_payload_digest || '',
    idempotencyKey: row.idempotency_key || '',
    providerPostId: row.provider_reference || row.provider_post_id || row.external_id || evidence.providerPostId || evidence.observedPost?.providerPostId || undefined,
    permalink: row.result_url || row.provider_post_url || row.permalink || evidence.permalink || evidence.observedPost?.permalink || undefined,
    state: row.state as ReceiptVerificationState,
    reasonCode: evidence.reasonCode || undefined,
    observedAt: evidence.observedAt || row.finalized_at || undefined,
    evidence,
    createdAt: row.created_at,
    updatedAt: row.finalized_at || row.created_at,
  }
}

export interface SafeRetryBoundaryCheck {
  safe: boolean
  reason: string
  stage: 'PRE_CONTAINER' | 'CONTAINER_SUBMITTED' | 'PROVIDER_ACCEPTED' | 'VERIFIED'
}

/**
 * Evaluates whether an external action receipt is safe to republish without causing duplicate posts (ANI-1138).
 */
export function isSafeToRepublish(receipt: ExternalActionReceipt): SafeRetryBoundaryCheck {
  if (receipt.state === 'VERIFIED') {
    return {
      safe: false,
      reason: '이미 검증 완료된 발행 건이므로 재발행이 불가합니다.',
      stage: 'VERIFIED',
    }
  }

  if (receipt.state === 'PROVIDER_ACCEPTED' || receipt.state === 'VERIFICATION_PENDING') {
    return {
      safe: false,
      reason: '공급자 승인이 완료되었으므로 재발행 대신 검증(Readback)을 진행해야 합니다.',
      stage: 'PROVIDER_ACCEPTED',
    }
  }

  // Pre-container vs Container Submitted boundary check:
  // Fail-closed invariant: Check all evidence of transport attempt, request initiation, or container submission.
  // If transport/submission was attempted, or if a container ID / request ID was registered,
  // contradictory flags (e.g. preContainerFailed: true) MUST NOT authorize republishing.
  const hasContainerOrTransportEvidence =
    receipt.evidence?.containerSubmitted === true ||
    Boolean(receipt.evidence?.providerContainerId) ||
    receipt.evidence?.dispatchStarted === true ||
    receipt.evidence?.submissionInitiated === true ||
    receipt.evidence?.transportAttempted === true ||
    Boolean(receipt.evidence?.action_request_id || receipt.evidence?.providerRequestId || receipt.evidence?.request_id) ||
    Boolean(receipt.providerPostId)

  if (hasContainerOrTransportEvidence) {
    return {
      safe: false,
      reason: '공급자에 컨테이너가 생성되었거나 전송이 시작되었을 가능성이 있어 중복 발행을 방지하기 위해 먼저 Reconcile이 필요합니다.',
      stage: 'CONTAINER_SUBMITTED',
    }
  }

  if (receipt.state === 'RESULT_UNKNOWN') {
    return {
      safe: false,
      reason: '공급자 응답 미확인 상태이므로 중복 발행을 방지하기 위해 먼저 Reconcile이 필요합니다.',
      stage: 'CONTAINER_SUBMITTED',
    }
  }

  if (receipt.state === 'FAILED') {
    // Only confirmed pre-submit rejections (before external network write) are safe for NEW_WRITE.
    const reasonCode = receipt.reasonCode || (receipt.evidence?.reasonCode as string) || ''
    const isKnownPreSubmitReason = [
      'PRE_VALIDATION_FAILED',
      'POLICY_VIOLATION',
      'CONTROL_GATE_BLOCKED',
      'CONTROL_GATE_DEPENDENCY_REQUIRED',
      'CREDENTIAL_LOAD_FAILED',
      'PRE_CONTAINER_REJECTED',
      'ADMISSION_BLOCKED',
      'VALIDATION_ERROR',
      'CONTENT_NOT_FOUND',
      'VERSION_NOT_FOUND',
      'STALE_APPROVAL',
    ].includes(reasonCode)

    const isConfirmedPreSubmit =
      receipt.evidence?.preContainerFailed === true ||
      isKnownPreSubmitReason

    if (isConfirmedPreSubmit) {
      return {
        safe: true,
        reason: '실패 확정 상태(공급자 제출 전 사전 거절)이므로 안전하게 재발행할 수 있습니다.',
        stage: 'PRE_CONTAINER',
      }
    }

    // Fail-closed: Ambiguous legacy FAILED or post-dispatch failure without clear pre-submit proof
    return {
      safe: false,
      reason: '제출 시점 또는 응답 유실 여부가 불명확한 실패 상태이므로 중복 발행을 방지하기 위해 먼저 Reconcile이 필요합니다.',
      stage: 'CONTAINER_SUBMITTED',
    }
  }

  if (receipt.state === 'REQUESTED') {
    return {
      safe: true,
      reason: '공급자 컨테이너 생성 전이므로 안전하게 재발행할 수 있습니다.',
      stage: 'PRE_CONTAINER',
    }
  }

  // Any unrecognized, ambiguous, or corrupted state defaults to fail-closed
  return {
    safe: false,
    reason: `인식할 수 없거나 모호한 영수증 상태(${receipt.state})이므로 중복 발행 방지를 위해 재발행이 차단되었습니다.`,
    stage: 'CONTAINER_SUBMITTED',
  }
}

