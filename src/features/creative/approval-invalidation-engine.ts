/**
 * Approval Invalidation & TOCTOU Protection Engine (ANI-1081)
 * Detects mutations after approval, invalidates stale approvals, and blocks mismatched publishing.
 */

import { randomUUID } from 'node:crypto'
import type {
  CreativeBundle,
  BundleApprovalRecord,
} from './creative-bundle-types'
import { calculateBundleFingerprint } from './creative-bundle-engine'

export class ApprovalIntegrityError extends Error {
  readonly code: string
  constructor(message: string, code = 'APPROVAL_INTEGRITY_VIOLATION') {
    super(message)
    this.name = 'ApprovalIntegrityError'
    this.code = code
  }
}

export function recordBundleApproval(params: {
  bundle: CreativeBundle
  approvedBy: string
}): { bundle: CreativeBundle; approval: BundleApprovalRecord } {
  const { bundle, approvedBy } = params
  const now = new Date().toISOString()

  const approvalId = randomUUID()
  const approval: BundleApprovalRecord = {
    id: approvalId,
    workspaceId: bundle.workspaceId,
    bundleId: bundle.bundleId,
    bundleFingerprint: bundle.bundleFingerprint,
    channel: bundle.channel,
    status: 'APPROVED',
    approvedBy,
    approvedAt: now,
  }

  const updatedBundle: CreativeBundle = {
    ...bundle,
    approvalStatus: 'APPROVED',
    approvedFingerprint: bundle.bundleFingerprint,
    approvedAt: now,
    approvedBy,
    updatedAt: now,
  }

  return { bundle: updatedBundle, approval }
}

export function preflightPublishAdmission(params: {
  bundle: CreativeBundle
  approval: BundleApprovalRecord
}): { admitted: boolean; currentFingerprint: string } {
  const { bundle, approval } = params

  if (approval.status !== 'APPROVED') {
    throw new ApprovalIntegrityError(
      `Cannot publish: Approval status is "${approval.status}". An active approval is required.`,
      'APPROVAL_NOT_ACTIVE'
    )
  }

  // Recalculate exact fingerprint on live bundle state
  const liveFingerprint = calculateBundleFingerprint({
    channel: bundle.channel,
    caption: bundle.caption,
    hashtags: bundle.hashtags,
    orderedMedia: bundle.orderedMedia,
    creativeBriefVersion: bundle.creativeBriefVersion,
  })

  if (liveFingerprint !== approval.bundleFingerprint) {
    throw new ApprovalIntegrityError(
      `TOCTOU violation detected: Bundle content was mutated after approval. Expected fingerprint "${approval.bundleFingerprint}" but current is "${liveFingerprint}". Re-approval required.`,
      'MUTATION_DETECTED_REAPPROVAL_REQUIRED'
    )
  }

  if (bundle.channel !== approval.channel) {
    throw new ApprovalIntegrityError(
      `Channel mismatch: Bundle channel is "${bundle.channel}" but approval was for "${approval.channel}".`,
      'CHANNEL_MISMATCH'
    )
  }

  return { admitted: true, currentFingerprint: liveFingerprint }
}

export function invalidateApprovalOnMutation(
  approval: BundleApprovalRecord,
  reason = 'CONTENT_MUTATED_AFTER_APPROVAL'
): BundleApprovalRecord {
  return {
    ...approval,
    status: 'SUPERSEDED',
    supersededAt: new Date().toISOString(),
    supersededReason: reason,
  }
}
