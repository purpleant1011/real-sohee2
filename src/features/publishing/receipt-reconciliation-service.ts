/**
 * Read-only provider reconciliation. Missing/ambiguous evidence never authorizes
 * republishing. Durable deduplication and atomic concurrency remain the gateway's
 * responsibility; these checks do not implement an inbox or a lock.
 */
import {
  isSafeToRepublish,
  transitionReceiptState,
  type ExternalActionReceipt,
  type ReceiptVerificationState,
} from './external-action-receipt-engine'
import type { CreativeBundle } from '../creative/creative-bundle-types'
import { composeBundleCaption } from './creative-bundle-publishing-executor'

export interface ProviderRecentPost {
  providerPostId: string
  caption: string
  permalink?: string
  publishedAt?: string
  mediaUrls?: string[]
}

export interface ReconcileDependencies {
  loadReceipt(receiptId: string, workspaceId: string): Promise<ExternalActionReceipt | null>
  loadBundle(bundleId: string, workspaceId: string): Promise<CreativeBundle | null>
  loadCredential(
    workspaceId: string,
    channelConnectionId: string,
    channel: string
  ): Promise<{ externalAccountId: string; accessToken: string }>
  fetchRecentProviderPosts(
    channel: string,
    externalAccountId: string,
    accessToken: string
  ): Promise<ProviderRecentPost[]>
  verifyPublishedPost(
    bundle: CreativeBundle,
    providerPostId: string,
    accessToken: string
  ): Promise<{
    outcome: 'VERIFIED' | 'VERIFICATION_PENDING' | 'FAILED' | 'RESULT_UNKNOWN'
    visualScore?: number
    captionMatch?: boolean
    reasonCode?: string
    message?: string
    evaluatedAt?: string
  }>
  saveReceipt(receipt: ExternalActionReceipt): Promise<void>
  isEventProcessed?(eventId: string): Promise<boolean>
  markEventProcessed?(eventId: string): Promise<void>
}

export interface ReconcileReceiptParams {
  workspaceId: string
  receiptId: string
  /** Compatibility only: elapsed time is not evidence of provider failure. */
  timeoutThresholdMs?: number
  channelConnectionId?: string
}

export interface ReconcileOutcome {
  resolvedState: ReceiptVerificationState
  reconciled: boolean
  alreadyVerified?: boolean
  providerPostId?: string
  permalink?: string
  reason?: string
  nextAction?: 'REVIEW_CONFIRMED_FAILURE' | 'CONTACT_OPERATOR'
  receipt?: ExternalActionReceipt
}

export interface PublishWebhookEvent {
  eventId: string
  workspaceId: string
  receiptId?: string
  providerPostId?: string
  status: 'PUBLISHED' | 'FAILED' | 'MEDIA_READY'
  permalink?: string
  errorMessage?: string
  timestamp: string
}

export interface WebhookReconciliationOutcome {
  idempotentNoOp: boolean
  receiptState: ReceiptVerificationState
  downgradePrevented?: boolean
  reason?: string
  nextAction?: 'REVIEW_CONFIRMED_FAILURE' | 'CONTACT_OPERATOR'
}

function isConcretePostId(id: string | undefined): id is string {
  return Boolean(id?.trim()) && id?.trim().toLowerCase() !== 'unknown'
}

export class ReceiptReconciliationService {
  constructor(private readonly deps: ReconcileDependencies) {}

  private async loadReceipt(receiptId: string, workspaceId: string) {
    const receipt = await this.deps.loadReceipt(receiptId, workspaceId)
    if (!receipt || receipt.workspaceId !== workspaceId || receipt.receiptId !== receiptId) {
      throw new Error('RECONCILIATION_RECEIPT_UNAVAILABLE')
    }
    return receipt
  }

  private async loadBundle(receipt: ExternalActionReceipt) {
    const bundle = await this.deps.loadBundle(receipt.creativeBundleId, receipt.workspaceId)
    if (!bundle || bundle.workspaceId !== receipt.workspaceId
      || bundle.bundleId !== receipt.creativeBundleId || bundle.channel !== receipt.channel
      || bundle.bundleFingerprint !== receipt.creativeFingerprint) {
      throw new Error('RECONCILIATION_BUNDLE_UNAVAILABLE')
    }
    return bundle
  }

  private async loadCredential(receipt: ExternalActionReceipt, connectionId = 'default') {
    const credential = await this.deps.loadCredential(receipt.workspaceId, connectionId, receipt.channel)
    if (!credential?.externalAccountId?.trim() || !credential?.accessToken?.trim()) {
      throw new Error('RECONCILIATION_CREDENTIAL_UNAVAILABLE')
    }
    return credential
  }

  private failedRecoveryGuidance(receipt: ExternalActionReceipt) {
    // Reuse the existing evidence precedence: submission/transport evidence
    // overrides even a contradictory pre-submit rejection flag. This classifies
    // the preserved failure; it does not authorize a retry or bypass the FSM.
    const confirmedPreSubmit = isSafeToRepublish(receipt).stage === 'PRE_CONTAINER'
    return confirmedPreSubmit ? {
      nextAction: 'REVIEW_CONFIRMED_FAILURE' as const,
      reason: '공급자 제출 전 실패 기록을 유지합니다. 실패 원인을 검토해 주세요. 이 확인 작업은 다시 게시하지 않습니다.',
    } : {
      nextAction: 'CONTACT_OPERATOR' as const,
      reason: '실패 기록은 유지하지만 외부 게시 결과는 확정하지 못했습니다. 다시 게시하지 말고 운영 담당자에게 공식 채널 조회와 대사를 요청해 주세요.',
    }
  }

  private async verify(
    receipt: ExternalActionReceipt,
    bundle: CreativeBundle,
    providerPostId: string,
    accessToken: string,
    permalink?: string,
    evidence: Record<string, unknown> = {},
  ): Promise<ReconcileOutcome> {
    const verification = await this.deps.verifyPublishedPost(bundle, providerPostId, accessToken)
    // Preserve pending/unknown rather than collapsing every non-success to failure.
    let intermediate = receipt
    if (verification.outcome === 'VERIFIED' || verification.outcome === 'VERIFICATION_PENDING') {
      if (intermediate.state === 'REQUESTED') {
        intermediate = transitionReceiptState(intermediate, 'PROVIDER_ACCEPTED', { providerPostId })
      }
      if (intermediate.state === 'PROVIDER_ACCEPTED') {
        intermediate = transitionReceiptState(intermediate, 'VERIFICATION_PENDING', { providerPostId })
      }
    }
    const updated = transitionReceiptState(intermediate, verification.outcome, {
      providerPostId,
      permalink,
      reasonCode: verification.reasonCode || `RECONCILE_${verification.outcome}`,
      observedAt: verification.evaluatedAt,
      additionalEvidence: {
        ...evidence,
        reconciledAt: new Date().toISOString(),
        visualScore: verification.visualScore,
        captionMatch: verification.captionMatch,
        verificationMessage: verification.message,
      },
    })
    await this.deps.saveReceipt(updated)
    return {
      resolvedState: updated.state,
      reconciled: true,
      providerPostId: updated.providerPostId,
      permalink: updated.permalink,
      reason: verification.message,
      receipt: updated,
    }
  }

  async reconcileReceipt(params: ReconcileReceiptParams): Promise<ReconcileOutcome> {
    const receipt = await this.loadReceipt(params.receiptId, params.workspaceId)
    if (receipt.state === 'FAILED') {
      return {
        resolvedState: receipt.state, reconciled: false, receipt,
        providerPostId: receipt.providerPostId, permalink: receipt.permalink,
        ...this.failedRecoveryGuidance(receipt),
      }
    }
    if (receipt.state === 'VERIFIED') {
      return {
        resolvedState: 'VERIFIED', reconciled: false, alreadyVerified: true,
        providerPostId: receipt.providerPostId, permalink: receipt.permalink, receipt,
      }
    }
    const bundle = await this.loadBundle(receipt)
    const credential = await this.loadCredential(receipt, params.channelConnectionId)
    const recentPosts = await this.deps.fetchRecentProviderPosts(
      receipt.channel, credential.externalAccountId, credential.accessToken,
    )
    const expected = composeBundleCaption(bundle.caption, bundle.hashtags).replace(/\s+/g, ' ').trim()
    // An existing concrete ID takes precedence over any same-caption post.
    // A legacy placeholder is incomplete evidence, not permission to replace it.
    const matches = recentPosts.filter((post) => receipt.providerPostId
      ? isConcretePostId(receipt.providerPostId) && post.providerPostId === receipt.providerPostId
      : (post.caption || '').replace(/\s+/g, ' ').trim() === expected)
    if (matches.length === 1 && isConcretePostId(matches[0].providerPostId)) {
      const post = matches[0]
      return this.verify(receipt, bundle, post.providerPostId, credential.accessToken, post.permalink)
    }
    // Persist the ambiguity when called on a pre-verification receipt too, so
    // downstream retry guards cannot mistake REQUESTED for a safe new write.
    const unknownReceipt = receipt.state === 'RESULT_UNKNOWN' ? receipt : transitionReceiptState(receipt, 'RESULT_UNKNOWN', {
      reasonCode: 'RECONCILE_INCONCLUSIVE',
    })
    if (unknownReceipt !== receipt) await this.deps.saveReceipt(unknownReceipt)
    return {
      resolvedState: 'RESULT_UNKNOWN',
      reconciled: false,
      reason: '게시 결과 확인 대기 중입니다. 다시 게시하지 말고 공식 채널 기록을 조회하거나 운영 담당자에게 확인을 요청해 주세요.',
      providerPostId: unknownReceipt.providerPostId,
      receipt: unknownReceipt,
    }
  }

  async handlePublishWebhookEvent(event: PublishWebhookEvent): Promise<WebhookReconciliationOutcome> {
    const { eventId, workspaceId, receiptId, providerPostId, status, permalink, errorMessage } = event
    if (!receiptId) throw new Error('RECONCILIATION_RECEIPT_REQUIRED')
    // Validate tenant and identity even for duplicate events or verified no-ops.
    const receipt = await this.loadReceipt(receiptId, workspaceId)
    if (receipt.state === 'FAILED') {
      return {
        idempotentNoOp: true, receiptState: receipt.state,
        ...this.failedRecoveryGuidance(receipt),
      }
    }
    if (this.deps.isEventProcessed && await this.deps.isEventProcessed(eventId)) {
      return { idempotentNoOp: true, receiptState: receipt.state, reason: '이미 처리한 알림입니다.' }
    }
    if (receipt.state === 'VERIFIED') {
      await this.deps.markEventProcessed?.(eventId)
      return { idempotentNoOp: true, receiptState: 'VERIFIED', downgradePrevented: true }
    }
    if (status === 'PUBLISHED') {
      const bundle = await this.loadBundle(receipt)
      // Never replace an already bound post ID with a different webhook object.
      if (receipt.providerPostId && providerPostId && receipt.providerPostId !== providerPostId) {
        throw new Error('RECONCILIATION_POST_ID_MISMATCH')
      }
      const resolvedPostId = receipt.providerPostId || providerPostId
      if (!isConcretePostId(resolvedPostId)) throw new Error('RECONCILIATION_POST_ID_REQUIRED')
      const credential = await this.loadCredential(receipt)
      const result = await this.verify(receipt, bundle, resolvedPostId, credential.accessToken, permalink, {
        webhookEventId: eventId, webhookTimestamp: event.timestamp,
      })
      // Pending/unknown must remain eligible for a later independent readback.
      if (result.resolvedState === 'VERIFIED' || result.resolvedState === 'FAILED') {
        await this.deps.markEventProcessed?.(eventId)
      }
      return { idempotentNoOp: false, receiptState: result.resolvedState, reason: result.reason }
    }
    if (status === 'FAILED') {
      if (receipt.providerPostId && providerPostId && receipt.providerPostId !== providerPostId) {
        throw new Error('RECONCILIATION_POST_ID_MISMATCH')
      }
      const updated = transitionReceiptState(receipt, 'FAILED', {
        reasonCode: 'WEBHOOK_PUBLISH_FAILED',
        additionalEvidence: { webhookEventId: eventId, errorMessage, webhookTimestamp: event.timestamp },
      })
      await this.deps.saveReceipt(updated)
      await this.deps.markEventProcessed?.(eventId)
      return { idempotentNoOp: false, receiptState: 'FAILED' }
    }
    return { idempotentNoOp: true, receiptState: receipt.state }
  }
}
