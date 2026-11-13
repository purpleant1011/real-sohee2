/**
 * Strict CreativeBundle Delivery Executor (Wave 5: ANI-1083)
 * Eliminates raw imageUrl injection and guarantees atomic execution of
 * approved CreativeBundles with ephemeral Delivery Leases, receipts, and readback.
 */

import { createHash } from 'node:crypto'
import type { CreativeBundle } from '../creative/creative-bundle-types'
import type { PublishRendition, ProviderDeliveryLease, MediaAsset } from '../media/media-asset-types'
import {
  issueProviderDeliveryLease,
  ensureActiveDeliveryLease,
  type DeliveryLeaseGateway,
} from './provider-delivery-lease'
import {
  createExternalActionReceipt,
  transitionReceiptState,
  mapOutcomeToReceiptState,
  calculatePayloadDigest,
  type ExternalActionReceipt,
} from './external-action-receipt-engine'
import {
  verifyPublishedCreativeBundle,
  composeBundleCaption,
  type ReadbackVerificationDependencies,
  type ReadbackVerificationResult,
} from './provider-readback-verifier'
export { composeBundleCaption }
import type { MetaOAuthChannel } from '../channels/oauth/meta-oauth'

export interface CreativeBundlePublishInput {
  workspaceId: string
  scheduleId: string
  creativeBundleId: string
  expectedFingerprint: string
  channelConnectionId: string
  actorUserId: string
  idempotencyKey?: string
  targetChannel?: 'instagram' | 'threads'
  missionId?: string | null
  actionRequestId?: string | null
  workerObservedEpoch?: number
}

export interface BundlePublishOutcome {
  ok: boolean
  receiptId: string
  providerPostId: string | null
  destinationUrl: string | null
  verificationOutcome: string
  receiptState: string
  errorCode?: string
  errorMessage?: string
}

export interface BundleExecutorDependencies {
  loadApprovedBundle(bundleId: string, workspaceId: string): Promise<CreativeBundle | null>
  loadMediaAsset(mediaAssetId: string, workspaceId: string): Promise<MediaAsset | null>
  loadOrCreatePublishRendition(mediaAssetId: string, channel: 'instagram' | 'threads'): Promise<PublishRendition>
  leaseGateway: DeliveryLeaseGateway
  loadCredential(workspaceId: string, connectionId: string, channel: MetaOAuthChannel): Promise<{
    accessToken: string
    externalAccountId: string
  }>
  assertMissionGateAllowed?: (input: { workspaceId: string; missionId: string; workerObservedEpoch?: number }) => Promise<void>
  providerPublish(input: {
    channel: 'instagram' | 'threads'
    accountId: string
    accessToken: string
    caption: string
    deliveryUrls: string[]
    isAiGenerated: boolean
  }): Promise<{ providerPostId: string; destinationUrl: string | null }>
  readbackDependencies: ReadbackVerificationDependencies
  recordReceipt(receipt: ExternalActionReceipt): Promise<void>
}

export class BundlePublishingError extends Error {
  readonly code: string
  constructor(message: string, code = 'BUNDLE_PUBLISHING_ERROR') {
    super(message)
    this.name = 'BundlePublishingError'
    this.code = code
  }
}

export function isNetworkAmbiguityError(err: any): boolean {
  if (!err) return false
  if (err.code === 'RESULT_UNKNOWN' || err.code === 'TIMEOUT_RESULT_UNKNOWN') return true
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true
  const code = String(err.code || '').toUpperCase()
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNABORTED') return true
  const msg = String(err.message || '').toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('socket hang up') ||
    msg.includes('econnreset') ||
    msg.includes('504 gateway') ||
    msg.includes('502 bad gateway') ||
    msg.includes('result_unknown') ||
    msg.includes('network error')
  )
}

export async function executeCreativeBundlePublish(
  input: CreativeBundlePublishInput,
  deps: BundleExecutorDependencies
): Promise<BundlePublishOutcome> {
  const idempotencyKey = input.idempotencyKey ?? createHash('sha256')
    .update(`${input.scheduleId}:${input.creativeBundleId}:${input.expectedFingerprint}`)
    .digest('hex')

  // 1. Resolve canonical CreativeBundle from DB
  const bundle = await deps.loadApprovedBundle(input.creativeBundleId, input.workspaceId)
  if (!bundle) {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'BUNDLE_NOT_FOUND',
      errorMessage: 'Approved creative bundle not found for workspace',
    }
  }

  // 2. Strict Preflight Invariants (ANI-1083)
  // Check workspace isolation
  if (bundle.workspaceId !== input.workspaceId) {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'CROSS_WORKSPACE_FORBIDDEN',
      errorMessage: 'Creative bundle does not belong to specified workspace',
    }
  }

  // Check approval status
  if (bundle.approvalStatus !== 'APPROVED') {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'BUNDLE_NOT_APPROVED',
      errorMessage: `Bundle approval status is ${bundle.approvalStatus}, must be APPROVED`,
    }
  }

  // Check exact fingerprint match (TOCTOU guard)
  if (bundle.bundleFingerprint !== input.expectedFingerprint) {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'FINGERPRINT_MISMATCH',
      errorMessage: 'Bundle fingerprint does not match expected approval fingerprint',
    }
  }

  const metaChannel: 'instagram' | 'threads' = (input.targetChannel ?? bundle.channel) as 'instagram' | 'threads'
  // Validate supported Meta channel
  if (metaChannel !== 'instagram' && metaChannel !== 'threads') {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'UNSUPPORTED_META_CHANNEL',
      errorMessage: `Meta delivery executor only supports instagram and threads, got ${metaChannel}`,
    }
  }

  // Check media items count & rights/eligibility
  if (bundle.orderedMedia.length === 0) {
    return {
      ok: false,
      receiptId: '',
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'EMPTY_MEDIA_ITEMS',
      errorMessage: 'Bundle must contain at least one canonical media item',
    }
  }

  // Validate each media asset from SSOT
  const deliveryUrls: string[] = []
  const orderedMediaDigests: string[] = []

  for (const item of bundle.orderedMedia) {
    const asset = await deps.loadMediaAsset(item.mediaAssetId, input.workspaceId)
    if (!asset) {
      return {
        ok: false,
        receiptId: '',
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: 'MEDIA_ASSET_NOT_FOUND',
        errorMessage: `Media asset ${item.mediaAssetId} not found in workspace`,
      }
    }

    if (!asset.publish_eligibility || asset.lifecycle_status !== 'READY') {
      return {
        ok: false,
        receiptId: '',
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: 'MEDIA_INELIGIBLE_FOR_PUBLISH',
        errorMessage: `Media asset ${item.mediaAssetId} is not eligible for publish (${asset.lifecycle_status})`,
      }
    }

    if (asset.sha256_digest !== item.sha256Digest) {
      return {
        ok: false,
        receiptId: '',
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: 'MEDIA_DIGEST_CORRUPT',
        errorMessage: `Media asset ${item.mediaAssetId} digest does not match bundle record`,
      }
    }

    orderedMediaDigests.push(item.sha256Digest)

    // Issue ephemeral signed delivery lease (ANI-1095)
    const rendition = await deps.loadOrCreatePublishRendition(item.mediaAssetId, metaChannel)
    const lease = await issueProviderDeliveryLease(
      rendition,
      {
        workspaceId: input.workspaceId,
        renditionId: rendition.id,
        provider: metaChannel,
        purpose: 'meta_publish',
        ttlSeconds: 900,
      },
      deps.leaseGateway
    )
    deliveryUrls.push(lease.delivery_url)
  }

  // 3. Create initial durable receipt (ANI-1085)
  const providerPayloadDigest = calculatePayloadDigest({
    channel: metaChannel,
    caption: bundle.caption,
    deliveryUrls,
  })

  let receipt = createExternalActionReceipt({
    workspaceId: input.workspaceId,
    scheduleId: input.scheduleId,
    creativeBundleId: bundle.bundleId,
    creativeFingerprint: bundle.bundleFingerprint,
    channel: metaChannel,
    orderedMediaSha256: orderedMediaDigests,
    providerPayloadDigest,
    idempotencyKey,
    evidence: {
      ...(input.actorUserId ? { actor_user_id: input.actorUserId, actorUserId: input.actorUserId } : {}),
      ...(input.missionId ? { mission_id: input.missionId, missionId: input.missionId } : {}),
      ...(input.actionRequestId ? { action_request_id: input.actionRequestId, actionRequestId: input.actionRequestId } : {}),
    },
  })
  await deps.recordReceipt(receipt)

  // 4. Load channel credentials and execute provider publish
  const credential = await deps.loadCredential(
    input.workspaceId,
    input.channelConnectionId,
    metaChannel
  )

  // Mark container submission initiated (safe retry boundary transition)
  receipt.evidence = {
    ...receipt.evidence,
    containerSubmitted: true,
  }
  await deps.recordReceipt(receipt)

  // 4-1. Fail-closed Pre-mutation Mission Gate check (immediately before provider write)
  if (input.missionId) {
    if (!deps.assertMissionGateAllowed) {
      receipt = transitionReceiptState(receipt, 'FAILED', {
        reasonCode: 'CONTROL_GATE_DEPENDENCY_REQUIRED',
        additionalEvidence: { error: 'assertMissionGateAllowed is required when missionId is provided (fail-closed)' },
      })
      await deps.recordReceipt(receipt)

      return {
        ok: false,
        receiptId: receipt.receiptId,
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: 'CONTROL_GATE_DEPENDENCY_REQUIRED',
        errorMessage: 'assertMissionGateAllowed is required when missionId is provided (fail-closed)',
      }
    }

    try {
      await deps.assertMissionGateAllowed({
        workspaceId: input.workspaceId,
        missionId: input.missionId,
        workerObservedEpoch: input.workerObservedEpoch,
      })
    } catch (gateErr: any) {
      receipt = transitionReceiptState(receipt, 'FAILED', {
        reasonCode: 'CONTROL_GATE_BLOCKED',
        additionalEvidence: { error: gateErr?.message || String(gateErr) },
      })
      await deps.recordReceipt(receipt)

      return {
        ok: false,
        receiptId: receipt.receiptId,
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'FAILED',
        receiptState: 'FAILED',
        errorCode: gateErr?.message?.includes('CONTROL_GATE_STALE_EPOCH')
          ? 'CONTROL_GATE_STALE_EPOCH'
          : gateErr?.message?.includes('CONTROL_GATE_UNAPPROVED')
          ? 'CONTROL_GATE_UNAPPROVED_CONTRACT'
          : 'CONTROL_GATE_BLOCKED',
        errorMessage: gateErr?.message || 'Mission control gate blocked external mutation',
      }
    }
  }

  let publishResult: { providerPostId: string; destinationUrl: string | null }
  let providerWriteSucceeded = false
  try {
    publishResult = await deps.providerPublish({
      channel: metaChannel,
      accountId: credential.externalAccountId,
      accessToken: credential.accessToken,
      caption: composeBundleCaption(bundle.caption, bundle.hashtags),
      deliveryUrls,
      isAiGenerated: bundle.creativeBriefVersion.length > 0,
    })
    providerWriteSucceeded = true

    receipt = transitionReceiptState(receipt, 'PROVIDER_ACCEPTED', {
      providerPostId: publishResult.providerPostId,
      permalink: publishResult.destinationUrl ?? undefined,
    })
    try {
      await deps.recordReceipt(receipt)
    } catch (recErr: any) {
      console.error('[bundle-publish-executor] Failed to record PROVIDER_ACCEPTED receipt:', recErr)
      receipt = transitionReceiptState(receipt, 'RESULT_UNKNOWN', {
        reasonCode: 'RECEIPT_RECORDING_FAILED',
        providerPostId: publishResult.providerPostId,
        permalink: publishResult.destinationUrl ?? undefined,
        additionalEvidence: {
          error: recErr?.message || String(recErr),
          providerWriteSucceeded: true,
          providerPostId: publishResult.providerPostId,
        },
      })
      try {
        await deps.recordReceipt(receipt)
      } catch {}
      return {
        ok: false,
        receiptId: receipt.receiptId,
        providerPostId: publishResult.providerPostId,
        destinationUrl: publishResult.destinationUrl,
        verificationOutcome: 'RESULT_UNKNOWN',
        receiptState: 'RESULT_UNKNOWN',
        errorCode: 'RECEIPT_RECORDING_FAILED',
        errorMessage: '공급자 발행은 성공했으나 발행 기록 저장에 실패하여 결과 확인이 필요합니다. 중복 발행을 방지하기 위해 자동 재시도는 차단되었습니다.',
      }
    }
  } catch (publishErr: any) {
    if (providerWriteSucceeded) {
      // Invariant: Once provider write succeeded, never downgrade to PROVIDER_REJECTED / FAILED!
      return {
        ok: false,
        receiptId: receipt.receiptId,
        providerPostId: publishResult!.providerPostId,
        destinationUrl: publishResult!.destinationUrl,
        verificationOutcome: 'RESULT_UNKNOWN',
        receiptState: 'RESULT_UNKNOWN',
        errorCode: 'RESULT_UNKNOWN',
        errorMessage: '공급자 게시가 성공한 후 후속 처리 중 오류가 발생하여 결과 확인이 필요합니다.',
      }
    }
    if (isNetworkAmbiguityError(publishErr)) {
      receipt = transitionReceiptState(receipt, 'RESULT_UNKNOWN', {
        reasonCode: 'TIMEOUT_RESULT_UNKNOWN',
        additionalEvidence: {
          error: publishErr?.message || String(publishErr),
          ambiguousTimeout: true,
        },
      })
      await deps.recordReceipt(receipt)

      return {
        ok: false,
        receiptId: receipt.receiptId,
        providerPostId: null,
        destinationUrl: null,
        verificationOutcome: 'RESULT_UNKNOWN',
        receiptState: 'RESULT_UNKNOWN',
        errorCode: 'TIMEOUT_RESULT_UNKNOWN',
        errorMessage: publishErr?.message || 'Provider request timed out or returned ambiguous network error',
      }
    }

    receipt = transitionReceiptState(receipt, 'FAILED', {
      reasonCode: 'PROVIDER_REJECTED',
      additionalEvidence: { error: (publishErr as Error).message },
    })
    await deps.recordReceipt(receipt)

    return {
      ok: false,
      receiptId: receipt.receiptId,
      providerPostId: null,
      destinationUrl: null,
      verificationOutcome: 'FAILED',
      receiptState: 'FAILED',
      errorCode: 'PROVIDER_ERROR',
      errorMessage: (publishErr as Error).message,
    }
  }

  // 5. Post-publish Provider Media Readback & Visual Equivalence Verification (ANI-1084, ANI-1096)
  try {
    receipt = transitionReceiptState(receipt, 'VERIFICATION_PENDING')
    await deps.recordReceipt(receipt)

    const verification = await verifyPublishedCreativeBundle(
      bundle,
      publishResult.providerPostId,
      credential.accessToken,
      deps.readbackDependencies
    )

    const finalReceiptState = mapOutcomeToReceiptState(verification.outcome)
    receipt = transitionReceiptState(receipt, finalReceiptState, {
      providerPostId: verification.observedPost?.providerPostId || publishResult.providerPostId,
      permalink: verification.observedPost?.permalink || publishResult.destinationUrl || undefined,
      reasonCode: verification.reasonCode,
      observedAt: verification.evaluatedAt,
      additionalEvidence: {
        visualScore: verification.visualScore,
        captionMatch: verification.captionMatch,
        observedPost: verification.observedPost,
        calibrationCorpusVersion: verification.calibrationCorpusVersion,
        thresholdVersion: verification.thresholdVersion,
      },
    })
    await deps.recordReceipt(receipt)

    const isSuccess = verification.outcome === 'VERIFIED' || verification.outcome === 'VERIFICATION_PENDING'

    return {
      ok: isSuccess,
      receiptId: receipt.receiptId,
      providerPostId: publishResult.providerPostId,
      destinationUrl: publishResult.destinationUrl,
      verificationOutcome: verification.outcome,
      receiptState: finalReceiptState,
      errorCode: isSuccess ? undefined : verification.reasonCode,
      errorMessage: isSuccess ? undefined : verification.message,
    }
  } catch (postDispatchErr: any) {
    console.error('[bundle-publish-executor] Post-dispatch verification/recording error:', postDispatchErr)
    const now = new Date().toISOString()
    // Explicitly transition to RESULT_UNKNOWN regardless of prior memory state
    // (even if final transition in memory was already VERIFIED, monotonic downgrade check must not prevent recording RESULT_UNKNOWN)
    receipt = {
      ...receipt,
      state: 'RESULT_UNKNOWN',
      reasonCode: 'POST_DISPATCH_RECORDING_FAILED',
      observedAt: receipt.observedAt || now,
      evidence: {
        ...(receipt.evidence ?? {}),
        error: postDispatchErr?.message || String(postDispatchErr),
        providerWriteSucceeded: true,
        providerPostId: publishResult.providerPostId,
        permalink: publishResult.destinationUrl ?? undefined,
        lastStateTransition: {
          from: receipt.state,
          to: 'RESULT_UNKNOWN',
          at: now,
        },
      },
      updatedAt: now,
    }
    try {
      await deps.recordReceipt(receipt)
    } catch (finalRecErr) {
      console.error('[bundle-publish-executor] Failed to record RESULT_UNKNOWN receipt:', finalRecErr)
    }

    return {
      ok: false,
      receiptId: receipt.receiptId,
      providerPostId: publishResult.providerPostId,
      destinationUrl: publishResult.destinationUrl,
      verificationOutcome: 'RESULT_UNKNOWN',
      receiptState: 'RESULT_UNKNOWN',
      errorCode: 'POST_DISPATCH_VERIFICATION_FAILED',
      errorMessage: '공급자 게시가 성공한 후 결과 검증 또는 영수증 저장 중 오류가 발생하여 결과 확인이 필요합니다.',
    }
  }
}
