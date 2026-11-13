/**
 * Exact Approval Command & Optimistic Concurrency Service (ANI-1130)
 * Enforces atomic approval predicate:
 * UPDATE creative_bundles
 *   SET approval_status = 'APPROVED', approved_fingerprint = bundle_fingerprint, approved_at = now(), approved_by = actor
 *   WHERE id = bundleId AND workspace_id = workspaceId AND bundle_fingerprint = expectedFingerprint AND approval_status = 'PENDING'
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export class StaleApprovalConcurrencyError extends Error {
  readonly code = 'STALE_APPROVAL_CONCURRENCY_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'StaleApprovalConcurrencyError'
  }
}

export class FingerprintMismatchError extends Error {
  readonly code = 'FINGERPRINT_MISMATCH_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'FingerprintMismatchError'
  }
}

export class BundleNotFoundError extends Error {
  readonly code = 'BUNDLE_NOT_FOUND'
  constructor(message: string) {
    super(message)
    this.name = 'BundleNotFoundError'
  }
}

export class BundleApprovalResultUnknownError extends Error {
  readonly code = 'BUNDLE_APPROVAL_RESULT_UNKNOWN'
  constructor() {
    super('사진 묶음의 승인 저장 결과를 확인하지 못했습니다. 최신 승인 상태를 다시 확인해 주세요.')
    this.name = 'BundleApprovalResultUnknownError'
  }
}

export interface ApproveBundleExactParams {
  workspaceId: string
  bundleId: string
  expectedFingerprint: string
  decidedBy: string
}

export interface ApproveBundleExactResult {
  bundleId: string
  status: 'APPROVED'
  approvedFingerprint: string
  approvedAt: string
  approvedBy: string
  isIdempotentReplay: boolean
}

export class ExactApprovalService {
  constructor(private readonly supabase: SupabaseClient | any) {}

  /**
   * Atomically approves a CreativeBundle using optimistic predicate.
   * Eliminates TOCTOU and concurrency races.
   */
  async approveBundleExact(
    params: ApproveBundleExactParams
  ): Promise<ApproveBundleExactResult> {
    const { workspaceId, bundleId, expectedFingerprint, decidedBy } = params
    const now = new Date().toISOString()

    // 1. Execute conditional atomic update with optimistic predicate
    const { data: updatedBundle, error: updateError } = await this.supabase
      .from('creative_bundles')
      .update({
        approval_status: 'APPROVED',
        approved_fingerprint: expectedFingerprint,
        approved_at: now,
        approved_by: decidedBy,
        updated_at: now,
      })
      .match({
        id: bundleId,
        workspace_id: workspaceId,
        bundle_fingerprint: expectedFingerprint,
        approval_status: 'PENDING',
      })
      .select()
      .single()

    // 2. If update succeeded, return canonical approved record
    if (updatedBundle && !updateError) {
      if (updatedBundle.id !== bundleId || updatedBundle.workspace_id !== workspaceId
        || updatedBundle.approval_status !== 'APPROVED'
        || updatedBundle.bundle_fingerprint !== expectedFingerprint
        || updatedBundle.approved_fingerprint !== expectedFingerprint
        || typeof updatedBundle.approved_at !== 'string' || !Number.isFinite(Date.parse(updatedBundle.approved_at))
        || typeof updatedBundle.approved_by !== 'string' || !updatedBundle.approved_by.trim()
        || updatedBundle.approved_by !== decidedBy) {
        // The write may already exist. Missing evidence is not a failed write or permission to retry it.
        throw new BundleApprovalResultUnknownError()
      }
      return {
        bundleId: updatedBundle.id,
        status: 'APPROVED',
        approvedFingerprint: updatedBundle.approved_fingerprint,
        approvedAt: updatedBundle.approved_at,
        approvedBy: updatedBundle.approved_by,
        isIdempotentReplay: false,
      }
    }

    // 3. Predicate failed (0 rows affected). Inspect current row to distinguish cause
    const { data: currentBundle, error: selectError } = await this.supabase
      .from('creative_bundles')
      .select('id, workspace_id, bundle_fingerprint, approval_status, approved_fingerprint, approved_at, approved_by')
      .eq('workspace_id', workspaceId)
      .eq('id', bundleId)
      .single()

    if (selectError || !currentBundle) {
      throw new BundleNotFoundError(
        `Creative bundle ${bundleId} not found in workspace ${workspaceId}`
      )
    }

    if (currentBundle.id !== bundleId || currentBundle.workspace_id !== workspaceId) {
      throw new BundleApprovalResultUnknownError()
    }

    // Case A: Idempotent Replay (already APPROVED with identical fingerprint)
    if (
      currentBundle.approval_status === 'APPROVED' &&
      currentBundle.bundle_fingerprint === expectedFingerprint &&
      currentBundle.approved_fingerprint === expectedFingerprint &&
      typeof currentBundle.approved_at === 'string' && Number.isFinite(Date.parse(currentBundle.approved_at)) &&
      typeof currentBundle.approved_by === 'string' && currentBundle.approved_by.trim().length > 0
    ) {
      return {
        bundleId: currentBundle.id,
        status: 'APPROVED',
        approvedFingerprint: currentBundle.approved_fingerprint,
        approvedAt: currentBundle.approved_at,
        approvedBy: currentBundle.approved_by,
        isIdempotentReplay: true,
      }
    }

    // Case B: Fingerprint mismatch (content mutated after preview)
    if (currentBundle.bundle_fingerprint !== expectedFingerprint) {
      throw new FingerprintMismatchError(
        `TOCTOU violation: Expected bundle fingerprint "${expectedFingerprint}" does not match live bundle fingerprint "${currentBundle.bundle_fingerprint}". Re-inspection required.`
      )
    }

    // Case C: Stale concurrency (status is already SUPERSEDED, REJECTED, etc.)
    throw new StaleApprovalConcurrencyError(
      `Cannot approve bundle: Current status is "${currentBundle.approval_status}". Only "PENDING" bundles can be transitioned to "APPROVED".`
    )
  }
}
