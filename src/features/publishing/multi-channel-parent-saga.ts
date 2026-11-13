/**
 * Multi-channel Parent Saga Engine (Wave 5: ANI-1137)
 * 
 * Orchestrates multi-channel delivery (Instagram + Threads) with:
 * - Parent operation tracking + child operations modeling
 * - Independent child idempotency keys and verification status
 * - PARTIAL_SUCCESS state preservation (never reports false total success)
 * - Zero republish of already-VERIFIED channels during retries
 */

import { randomUUID } from 'node:crypto'
import {
  isNetworkAmbiguityError,
  type CreativeBundlePublishInput,
  type BundlePublishOutcome,
} from './creative-bundle-publishing-executor'
import type { ExternalActionReceipt } from './external-action-receipt-engine'

export type SagaOverallStatus =
  | 'ALL_VERIFIED'
  | 'PARTIAL_SUCCESS'
  | 'ALL_FAILED'
  | 'PENDING'
  | 'RESULT_UNKNOWN'

export interface MultiChannelSagaRequest {
  workspaceId: string
  bundleId: string
  expectedFingerprint: string
  channel: 'INSTAGRAM' | 'THREADS' | 'BOTH'
  channelConnectionId?: string
  actorUserId?: string
  idempotencyKey?: string
  missionId?: string | null
  scheduleId?: string | null
  actionRequestId?: string | null
  workerObservedEpoch?: number
}

export interface ChannelSagaChildResult {
  channel: 'instagram' | 'threads'
  status: string
  success: boolean
  verified: boolean
  reusedExisting: boolean
  postId?: string | null
  url?: string | null
  receiptId?: string
  errorCode?: string
  errorMessage?: string
}

export interface MultiChannelSagaOutcome {
  success: boolean
  overallStatus: SagaOverallStatus
  parentSagaId: string
  workspaceId: string
  channel: string
  children: Partial<Record<'instagram' | 'threads', ChannelSagaChildResult>>
  message: string
}

export interface MultiChannelPublishSagaDependencies {
  publishChannel(input: CreativeBundlePublishInput): Promise<BundlePublishOutcome>
  loadExistingReceipt(
    workspaceId: string,
    bundleId: string,
    channel: 'instagram' | 'threads'
  ): Promise<ExternalActionReceipt | null>
  reconcileUnknownReceipt?(
    workspaceId: string,
    receiptId: string,
    channel: 'instagram' | 'threads'
  ): Promise<{ resolvedState: string; reason?: string; providerPostId?: string; permalink?: string }>
}

export class MultiChannelPublishSaga {
  constructor(private readonly deps: MultiChannelPublishSagaDependencies) {}

  /**
   * Executes multi-channel publishing with partial success protection and zero-republish retry.
   */
  async execute(request: MultiChannelSagaRequest): Promise<MultiChannelSagaOutcome> {
    const parentSagaId = `saga_${randomUUID()}`
    const { workspaceId, bundleId, expectedFingerprint, channel, channelConnectionId = 'default', actorUserId = 'system' } = request
    const baseIdempotencyKey = request.idempotencyKey || `idem_${randomUUID()}`

    const targetChannels: Array<'instagram' | 'threads'> = []
    if (channel === 'INSTAGRAM' || channel === 'BOTH') {
      targetChannels.push('instagram')
    }
    if (channel === 'THREADS' || channel === 'BOTH') {
      targetChannels.push('threads')
    }

    const children: Partial<Record<'instagram' | 'threads', ChannelSagaChildResult>> = {}

    for (const targetChannel of targetChannels) {
      // 1. Check for pre-existing VERIFIED receipt for this channel (Zero-Republish Guard)
      const existingReceipt = await this.deps.loadExistingReceipt(workspaceId, bundleId, targetChannel)

      if (existingReceipt && existingReceipt.state === 'VERIFIED') {
        children[targetChannel] = {
          channel: targetChannel,
          status: 'VERIFIED',
          success: true,
          verified: true,
          reusedExisting: true,
          postId: existingReceipt.providerPostId || null,
          url: existingReceipt.permalink || null,
          receiptId: existingReceipt.receiptId,
        }
        continue
      }

      // 1.1 Prohibit blind republish if existing receipt is RESULT_UNKNOWN (ANI-1138)
      if (existingReceipt && existingReceipt.state === 'RESULT_UNKNOWN') {
        let reconciledState: string = 'RESULT_UNKNOWN'
        let reconciledPostId = existingReceipt.providerPostId
        let reconciledUrl = existingReceipt.permalink
        let reconcileReason = '공급자 응답 대기 중 타임아웃이 발생하여 상태를 RESULT_UNKNOWN으로 격리하였습니다.'

        if (this.deps.reconcileUnknownReceipt) {
          const recOutcome = await this.deps.reconcileUnknownReceipt(
            workspaceId,
            existingReceipt.receiptId,
            targetChannel
          )
          reconciledState = recOutcome.resolvedState
          if (recOutcome.providerPostId) reconciledPostId = recOutcome.providerPostId
          if (recOutcome.permalink) reconciledUrl = recOutcome.permalink
          if (recOutcome.reason) reconcileReason = recOutcome.reason
        }

        if (reconciledState === 'VERIFIED') {
          children[targetChannel] = {
            channel: targetChannel,
            status: 'VERIFIED',
            success: true,
            verified: true,
            reusedExisting: true,
            postId: reconciledPostId || null,
            url: reconciledUrl || null,
            receiptId: existingReceipt.receiptId,
          }
          continue
        } else if (reconciledState === 'RESULT_UNKNOWN') {
          // Keep RESULT_UNKNOWN: Strictly prohibit blind republish
          children[targetChannel] = {
            channel: targetChannel,
            status: 'RESULT_UNKNOWN',
            success: false,
            verified: false,
            reusedExisting: true,
            receiptId: existingReceipt.receiptId,
            errorCode: 'RESULT_UNKNOWN_RECONCILE_PENDING',
            errorMessage: reconcileReason,
          }
          continue
        }
        // If reconciledState === 'FAILED', fall through to fresh publish attempt below!
      }

      // 2. Execute fresh publish for non-verified or failed child channel
      const childIdempotencyKey = `${baseIdempotencyKey}:${targetChannel}`
      try {
        const outcome = await this.deps.publishChannel({
          workspaceId,
          scheduleId: request.scheduleId || parentSagaId,
          creativeBundleId: bundleId,
          expectedFingerprint,
          channelConnectionId,
          actorUserId,
          idempotencyKey: childIdempotencyKey,
          targetChannel,
          missionId: request.missionId,
          actionRequestId: request.actionRequestId,
          workerObservedEpoch: request.workerObservedEpoch,
        })

        children[targetChannel] = {
          channel: targetChannel,
          status: outcome.receiptState,
          success: outcome.ok,
          verified: outcome.verificationOutcome === 'VERIFIED',
          reusedExisting: false,
          postId: outcome.providerPostId,
          url: outcome.destinationUrl,
          receiptId: outcome.receiptId,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
        }
      } catch (err: any) {
        const isUnknown = isNetworkAmbiguityError(err) || String(err?.message || '').includes('RECORDING_FAILED')
        children[targetChannel] = {
          channel: targetChannel,
          status: isUnknown ? 'RESULT_UNKNOWN' : 'FAILED',
          success: false,
          verified: false,
          reusedExisting: false,
          errorCode: isUnknown ? 'RESULT_UNKNOWN' : 'CHANNEL_DISPATCH_EXCEPTION',
          errorMessage: err?.message || '채널 발행 중 예외가 발생했습니다.',
        }
      }
    }

    // 3. Synthesize Parent Outcome
    const resultsList = Object.values(children).filter((c): c is ChannelSagaChildResult => Boolean(c))
    const totalCount = targetChannels.length
    const successCount = resultsList.filter(c => c.success).length
    const verifiedCount = resultsList.filter(c => c.verified).length
    const failedCount = resultsList.filter(c => !c.success).length

    let overallStatus: SagaOverallStatus
    let success: boolean
    let message: string

    if (failedCount === 0 && totalCount > 0) {
      if (verifiedCount === totalCount) {
        overallStatus = 'ALL_VERIFIED'
        message = '선택하신 모든 채널에 게시 및 원고·시각 검증이 성공적으로 완료되었습니다.'
      } else {
        overallStatus = 'PENDING'
        message = '선택하신 모든 채널에 게시 요청이 정상 전달되었으며, 외부 검증이 진행 중입니다.'
      }
      success = true
    } else if (successCount > 0) {
      overallStatus = 'PARTIAL_SUCCESS'
      success = false // Partial success is NOT reported as complete clean success
      const successChannelNames = resultsList.filter(c => c.success).map(c => c.channel).join(', ')
      const failedChannelNames = resultsList.filter(c => !c.success).map(c => c.channel).join(', ')
      message = `일부 채널(${successChannelNames}) 게시에는 성공하였으나, ${failedChannelNames} 채널 처리에 실패하였습니다. 실패한 채널만 안전하게 재시도할 수 있습니다.`
    } else {
      overallStatus = 'ALL_FAILED'
      success = false
      message = '모든 요청 채널의 게시 처리에 실패하였습니다.'
    }

    return {
      success,
      overallStatus,
      parentSagaId,
      workspaceId,
      channel,
      children,
      message,
    }
  }
}
