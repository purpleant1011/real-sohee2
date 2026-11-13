/**
 * SOHEE V0.91 · M5 Exact Approval & Dual Publish Coordinator (HF-26, HF-27, HF-28, HF-29)
 * 
 * Rules:
 * 1. Exact Approval Fingerprint:
 *    Fingerprint MUST encompass copy, media, target channels, knowledge, text harness,
 *    and image harness versions. Any variation triggers FINGERPRINT_MISMATCH and invalidates approval.
 * 2. Independent Channel Receipts:
 *    Instagram and Threads execute independently. One channel's failure is NEVER marked as
 *    overall success (Zero False-Success).
 * 3. Provider Accepted ≠ VERIFIED:
 *    Live URL / native post ID must be obtained via readback to reach VERIFIED state.
 * 4. RESULT_UNKNOWN & Reconcile Truth:
 *    Network timeouts and 5xx errors enter RESULT_UNKNOWN to prevent duplicate blind retries.
 */

import { createHash } from 'crypto'

export type PublishChannel = 'instagram' | 'threads'

export interface ExactApprovalPayload {
  workspaceId: string
  contentId: string
  contentVersion: number
  copyText: string
  imageUrl?: string
  channelTargets: PublishChannel[]
  harnessVersions: {
    knowledgeVersionId?: string | null
    textHarnessVersionId?: string | null
    imageHarnessVersionId?: string | null
    operatingPolicyVersionId?: string | null
  }
  rightsAndConsent: {
    rightsStatus: string
    consentStatus: string
  }
}

export interface ChannelPublishReceipt {
  channel: PublishChannel
  status: 'REQUESTED' | 'EXECUTING' | 'PROVIDER_ACCEPTED' | 'VERIFYING' | 'VERIFIED' | 'RESULT_UNKNOWN' | 'FAILED'
  nativePostId?: string
  liveUrl?: string
  errorMessage?: string
  attemptCount: number
  lastAttemptAt: string
  idempotencyKey: string
  reconciledAt?: string
}

export type DualPublishOverallStatus = 'ALL_VERIFIED' | 'PARTIAL_SUCCESS' | 'FAILED'

export interface DualPublishResult {
  overallStatus: DualPublishOverallStatus
  contentId: string
  contentVersion: number
  approvalFingerprint: string
  receipts: Record<PublishChannel, ChannelPublishReceipt>
  completedAt: string
}

/**
 * HF-27: Computes a deterministic approval fingerprint covering content, targets, and harness versions.
 */
export function computeExactApprovalFingerprint(payload: ExactApprovalPayload): string {
  const sortedChannels = [...payload.channelTargets].sort()
  const rawKey = JSON.stringify({
    ws: payload.workspaceId,
    cid: payload.contentId,
    ver: payload.contentVersion,
    txt: payload.copyText.trim(),
    img: payload.imageUrl || '',
    ch: sortedChannels,
    kv: payload.harnessVersions.knowledgeVersionId || '',
    tv: payload.harnessVersions.textHarnessVersionId || '',
    iv: payload.harnessVersions.imageHarnessVersionId || '',
    pv: payload.harnessVersions.operatingPolicyVersionId || '',
    rights: payload.rightsAndConsent.rightsStatus,
    consent: payload.rightsAndConsent.consentStatus,
  })

  const hash = createHash('sha256').update(rawKey).digest('hex').substring(0, 24)
  return `apfp_${hash}`
}

/**
 * Validates the provided fingerprint against the current payload.
 * Throws FINGERPRINT_MISMATCH if any attribute was altered.
 */
export function validateApprovalFingerprint(params: {
  expectedFingerprint: string
  currentPayload: ExactApprovalPayload
}): void {
  const actualFingerprint = computeExactApprovalFingerprint(params.currentPayload)
  if (actualFingerprint !== params.expectedFingerprint) {
    throw new Error(
      `FINGERPRINT_MISMATCH: 승인 당시의 콘텐츠/하네스 버전과 현재 상태가 일치하지 않습니다. (Expected: ${params.expectedFingerprint}, Actual: ${actualFingerprint})`
    )
  }
}

export type ChannelExecutor = (
  channel: PublishChannel,
  payload: ExactApprovalPayload,
  idempotencyKey: string
) => Promise<{ success: boolean; nativePostId: string; liveUrl: string }>

/**
 * HF-28 & HF-29: Executes dual publishing across Instagram and Threads with independent receipts.
 */
export async function executeDualChannelPublish(params: {
  payload: ExactApprovalPayload
  approvalFingerprint: string
  executor: ChannelExecutor
}): Promise<DualPublishResult> {
  const { payload, approvalFingerprint, executor } = params

  // 1. Verify fingerprint before taking any destructive/external action
  validateApprovalFingerprint({
    expectedFingerprint: approvalFingerprint,
    currentPayload: payload,
  })

  const receipts: Record<PublishChannel, ChannelPublishReceipt> = {
    instagram: {
      channel: 'instagram',
      status: 'REQUESTED',
      attemptCount: 0,
      lastAttemptAt: new Date().toISOString(),
      idempotencyKey: `idem_ig_${payload.contentId}_v${payload.contentVersion}`,
    },
    threads: {
      channel: 'threads',
      status: 'REQUESTED',
      attemptCount: 0,
      lastAttemptAt: new Date().toISOString(),
      idempotencyKey: `idem_th_${payload.contentId}_v${payload.contentVersion}`,
    },
  }

  // Execute channels independently
  for (const channel of payload.channelTargets) {
    const receipt = receipts[channel]
    receipt.status = 'EXECUTING'
    receipt.attemptCount += 1
    receipt.lastAttemptAt = new Date().toISOString()

    try {
      const res = await executor(channel, payload, receipt.idempotencyKey)
      const isSynthetic = res.liveUrl && (res.liveUrl.includes('live_recent') || res.liveUrl.includes('/sample/'))
      if (res.success && res.liveUrl && !isSynthetic) {
        receipt.status = 'VERIFIED'
        receipt.nativePostId = res.nativePostId
        receipt.liveUrl = res.liveUrl
      } else if (isSynthetic) {
        receipt.status = 'FAILED'
        receipt.errorMessage = 'Synthetic or mock URL rejected in live verification'
      } else {
        receipt.status = 'FAILED'
        receipt.errorMessage = 'Readback verification failed'
      }
    } catch (err: any) {
      if (err.isUnknownResult || err.message?.includes('TIMEOUT') || err.message?.includes('504')) {
        receipt.status = 'RESULT_UNKNOWN'
        receipt.errorMessage = `Network timeout during publish: ${err.message}`
      } else {
        receipt.status = 'FAILED'
        receipt.errorMessage = err.message || 'Unknown publish error'
      }
    }
  }

  // Determine overall status
  const targetStatuses = payload.channelTargets.map((c) => receipts[c].status)
  const allVerified = targetStatuses.every((s) => s === 'VERIFIED')
  const anyVerified = targetStatuses.some((s) => s === 'VERIFIED')

  let overallStatus: DualPublishOverallStatus
  if (allVerified) {
    overallStatus = 'ALL_VERIFIED'
  } else if (anyVerified || targetStatuses.includes('RESULT_UNKNOWN')) {
    overallStatus = 'PARTIAL_SUCCESS'
  } else {
    overallStatus = 'FAILED'
  }

  return {
    overallStatus,
    contentId: payload.contentId,
    contentVersion: payload.contentVersion,
    approvalFingerprint,
    receipts,
    completedAt: new Date().toISOString(),
  }
}

/**
 * HF-29: Reconciles a RESULT_UNKNOWN receipt via active readback.
 */
export async function reconcileChannelPublishState(params: {
  receipt: ChannelPublishReceipt
  readbackChecker: () => Promise<{ found: boolean; nativePostId?: string; liveUrl?: string }>
}): Promise<ChannelPublishReceipt> {
  const { receipt, readbackChecker } = params
  const check = await readbackChecker()

  const now = new Date().toISOString()
  if (check.found && check.liveUrl) {
    return {
      ...receipt,
      status: 'VERIFIED',
      nativePostId: check.nativePostId,
      liveUrl: check.liveUrl,
      reconciledAt: now,
    }
  }

  return {
    ...receipt,
    status: 'FAILED',
    errorMessage: 'Reconcile readback confirmed post was not created',
    reconciledAt: now,
  }
}
