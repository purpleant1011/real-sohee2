/**
 * SOHEE V0.91 · Phase 8 (ANI-1434)
 * Dual Provider Publish · Independent Readback · Evidence Lineage
 *
 * Rules:
 * 1. 5-Stage Lifecycle: REQUESTED → EXECUTING → PROVIDER_ACCEPTED → EXTERNALLY_VERIFIED → OUTCOME_OBSERVED
 * 2. Provider Accepted ≠ VERIFIED: Must be verified via independent readback before marking VERIFIED.
 * 3. Dual Channel Independence: Never blur partial success/failure into overall success.
 * 4. Selective Retry & Idempotency: Retries only failed channels; never duplicate-publish verified channels.
 * 5. Tamper Invariant: Approval fingerprint must match before executing any external action.
 * 6. Real Provider Invariant: Production default MUST fail closed when credentials or configuration are missing (NO simulated fake success).
 */

import { validateApprovalForPublish } from '@/features/missions/conversational-first-post'
import type { ApprovedFirstPostMission, ExactApprovalPayload } from '@/features/missions/conversational-first-post'
import { composeFirstPostChannelText } from '@/features/publishing/meta-content-text'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { createInstagramProvider, createThreadsProvider } from '@/lib/providers/meta-api'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import { getPostReadback } from '@/lib/providers/instagram-provider'

export type PublishStage =
  | 'REQUESTED'
  | 'EXECUTING'
  | 'PROVIDER_ACCEPTED'
  | 'EXTERNALLY_VERIFIED'
  | 'OUTCOME_OBSERVED'
  | 'FAILED'
  | 'RESULT_UNKNOWN'

function isUncertainPublishError(message: string | undefined): boolean {
  return /timeout|abort|unknown/i.test(message ?? '')
}

export type DualPublishChannel = 'instagram' | 'threads'

export type DualPublishOverallStatus = 'ALL_VERIFIED' | 'PARTIAL_SUCCESS' | 'FAILED'

export interface DualPublishChannelReceipt {
  channel: DualPublishChannel
  stage: PublishStage
  providerPostId?: string
  permalink?: string
  receiptId: string
  requestId: string
  approvalFingerprint: string
  attemptCount: number
  lastAttemptAt: string
  verifiedAt?: string
  errorMessage?: string
}

export interface DualPublishExecutionResult {
  overallStatus: DualPublishOverallStatus
  missionId: string
  approvalFingerprint: string
  receipts: Partial<Record<DualPublishChannel, DualPublishChannelReceipt>>
  completedAt: string
}

export interface ChannelPublishAdapter {
  publish: (
    channel: DualPublishChannel,
    payload: ExactApprovalPayload
  ) => Promise<{
    providerAccepted: boolean
    providerPostId?: string
    requestId: string
    errorMessage?: string
  }>
  readback: (
    providerPostId: string,
    context?: { workspaceId?: string; channel?: DualPublishChannel }
  ) => Promise<{
    isLive: boolean
    permalink?: string
    verifiedAt?: string
    /** provider 가 돌려준 게시 본문. 있으면 승인 원고와 대조한다(ANI-1775). */
    caption?: string
    errorMessage?: string
  }>
}

/**
 * 채널별 게시 본문 (ANI-1775).
 *
 * 승인 화면(M07)과 승인 지문은 `cta` 를 포함하는데, 게시 직렬화가 이를 빼면
 * 사용자가 승인한 원고와 실제 게시물이 달라진다. 직렬화는 `meta-content-text.ts`
 * 한 곳에 있고, 생성 단계(CTA 부착)와 게시 단계가 같은 함수를 쓴다.
 */
export function composeInstagramPublishText(copy: ExactApprovalPayload['copies']['instagram']): string {
  return composeFirstPostChannelText('instagram', {
    instagram: copy,
    threads: { content: '' },
  })
}

export function composeThreadsPublishText(copy: ExactApprovalPayload['copies']['threads']): string {
  return composeFirstPostChannelText('threads', {
    instagram: { caption: '' },
    threads: copy,
  })
}

/** 공백·줄바꿈 차이만 다른 경우를 같게 보기 위한 정규화. 그 외 문자 차이는 그대로 둔다. */
function normalizePublishedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * provider 가 돌려준 본문이 승인 원고와 같은가.
 * 관측값이 없으면 판정하지 않는다(`null`).
 */
export function publishedTextMatches(observed: string | undefined, expected: string): boolean | null {
  if (typeof observed !== 'string' || !observed.trim()) return null
  return normalizePublishedText(observed) === normalizePublishedText(expected)
}

/** 이 채널의 승인 원고에 CTA 가 실려 있는가(지문에 묶인 값). */
export function channelHasApprovedCta(
  channel: DualPublishChannel,
  currentPayload: ExactApprovalPayload,
): boolean {
  const cta = channel === 'instagram'
    ? currentPayload.copies.instagram.cta
    : currentPayload.copies.threads.cta
  return typeof cta === 'string' && cta.trim().length > 0
}

export interface DualProviderPublishParams {
  approvedMission: ApprovedFirstPostMission
  currentPayload: ExactApprovalPayload
  adapters?: Partial<Record<DualPublishChannel, ChannelPublishAdapter>>
  assertMissionGateAllowed?: (params: {
    workspaceId: string
    missionId: string
    workerObservedEpoch?: number
  }) => Promise<void>
  workerObservedEpoch?: number
  isContractMission?: boolean
}

export interface RetryFailedChannelParams {
  approvedMission: ApprovedFirstPostMission
  currentPayload: ExactApprovalPayload
  targetChannel: DualPublishChannel
  existingReceipts: Partial<Record<DualPublishChannel, DualPublishChannelReceipt>>
  adapters?: Partial<Record<DualPublishChannel, ChannelPublishAdapter>>
  assertMissionGateAllowed?: (params: {
    workspaceId: string
    missionId: string
    workerObservedEpoch?: number
  }) => Promise<void>
  workerObservedEpoch?: number
  isContractMission?: boolean
}

async function resolvePublishableImageUrls(
  workspaceId: string,
  imageIds?: readonly string[],
  imageUrls?: readonly string[],
): Promise<string[]> {
  const resolved: string[] = []

  if (Array.isArray(imageUrls)) {
    for (const url of imageUrls) {
      if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
        resolved.push(url)
      }
    }
  }

  if (Array.isArray(imageIds) && imageIds.length > 0) {
    try {
      const [{ createAdminSupabaseClient }, { createPrivateSignedUrl }] = await Promise.all([
        import('@/lib/supabase/admin'),
        import('@/lib/supabase/storage'),
      ])
      const adminClient = createAdminSupabaseClient()

      const { data: assets } = await (adminClient as any)
        .from('media_assets')
        .select('id, bucket_id, object_path')
        .eq('workspace_id', workspaceId)
        .in('id', [...imageIds])

      if (assets && assets.length > 0) {
        const assetMap = new Map((assets as any[]).map((a) => [a.id, a]))
        for (const id of imageIds) {
          const asset = assetMap.get(id)
          if (asset && asset.object_path) {
            try {
              const signedUrl = await createPrivateSignedUrl(
                adminClient,
                (asset.bucket_id || 'content-media') as any,
                asset.object_path,
                86400,
              )
              if (signedUrl && !resolved.includes(signedUrl)) {
                resolved.push(signedUrl)
              }
            } catch (err) {
              console.error(`[resolvePublishableImageUrls] Failed to sign URL for asset ${id}:`, err)
            }
          }
        }
      }
    } catch (err) {
      console.error('[resolvePublishableImageUrls] DB lookup failed:', err)
    }
  }

  return resolved
}

/**
 * Production Default Adapter
 * Strictly connects to real Meta Graph & Threads API.
 * FAILS CLOSED (providerAccepted: false) when credentials or channels are unconfigured.
 */
export function createDefaultProductionAdapter(provider: DualPublishChannel): ChannelPublishAdapter {
  return {
    async publish(channel, payload) {
      const requestId = `req_${channel}_${Date.now()}`
      try {
        if (!isMetaLiveAllowed(payload.workspaceId)) {
          return {
            providerAccepted: false,
            requestId,
            errorMessage: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT: 아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
          }
        }

        const cred = await loadChannelCredentialByChannel(payload.workspaceId, channel)
        if (!cred || !cred.accessToken || !cred.externalAccountId) {
          return {
            providerAccepted: false,
            requestId,
            errorMessage: `MISSING_PROVIDER_CREDENTIALS: ${channel} account credentials are not configured`,
          }
        }

        const resolvedImageUrls = await resolvePublishableImageUrls(
          payload.workspaceId,
          payload.imageIds,
          (payload as any).imageUrls,
        )

        if (channel === 'instagram') {
          const ig = createInstagramProvider()
          const candidateUrls: string[] = resolvedImageUrls.length > 0
            ? resolvedImageUrls
            : (payload.imageIds || []).filter((id: string) => id.startsWith('http://') || id.startsWith('https://'))

          const imageUrls = candidateUrls.length > 0 ? [candidateUrls[0]] : []
          if (!imageUrls || imageUrls.length === 0) {
            return {
              providerAccepted: false,
              requestId,
              errorMessage: 'IMAGE_REQUIRED: Instagram requires at least one valid resolved image URL (fallback image prohibited)',
            }
          }
          // ANI-1775: 승인 원고(cta 포함)를 그대로 직렬화한다.
          const caption = composeInstagramPublishText(payload.copies.instagram)

          const published = await ig.publish({
            accountId: cred.externalAccountId,
            accessToken: cred.accessToken,
            caption,
            imageUrls,
            isAiGenerated: true,
          })

          return {
            providerAccepted: true,
            providerPostId: published.providerPostId,
            requestId,
          }
        } else {
          const th = createThreadsProvider()
          const threadImages = resolvedImageUrls.length > 0 ? [resolvedImageUrls[0]] : []
          const published = await th.publish({
            accountId: cred.externalAccountId,
            accessToken: cred.accessToken,
            text: composeThreadsPublishText(payload.copies.threads),
            imageUrls: threadImages,
          })

          return {
            providerAccepted: true,
            providerPostId: published.providerPostId,
            requestId,
          }
        }
      } catch (err: any) {
        return {
          providerAccepted: false,
          requestId,
          errorMessage: err?.message || String(err),
        }
      }
    },

    async readback(providerPostId, context) {
      try {
        if (!context?.workspaceId) {
          return {
            isLive: false,
            errorMessage: 'WORKSPACE_REQUIRED: Cannot read back without workspace context',
          }
        }
        const cred = await loadChannelCredentialByChannel(context.workspaceId, provider)
        if (!cred || !cred.accessToken) {
          return {
            isLive: false,
            errorMessage: `MISSING_PROVIDER_CREDENTIALS: Valid access token required for ${provider} readback`,
          }
        }

        const readbackRes = await getPostReadback(providerPostId, cred.accessToken, {
          channel: provider,
        })

        return {
          isLive: readbackRes.isLive,
          permalink: readbackRes.permalink,
          verifiedAt: readbackRes.isLive ? readbackRes.observedAt : undefined,
          // ANI-1775: 게시된 본문을 승인 원고와 대조할 수 있게 함께 돌려준다.
          caption: readbackRes.caption,
          errorMessage: readbackRes.error,
        }
      } catch (err: any) {
        return {
          isLive: false,
          errorMessage: err?.message || String(err),
        }
      }
    },
  }
}

/**
 * readback 결과를 영수증에 반영한다. VERIFIED 승격은 permalink + (관측된 경우) 본문 일치를 모두 만족할 때만.
 * 관측 본문이 없으면 본문 판정은 하지 않는다(없는 근거로 막지도 열지도 않는다).
 */
function applyReadbackVerification(
  receipt: DualPublishChannelReceipt,
  readbackRes: { isLive: boolean; permalink?: string; verifiedAt?: string; caption?: string; errorMessage?: string },
  channel: DualPublishChannel,
  currentPayload: ExactApprovalPayload,
  fallbackMessage: string,
): void {
  if (!readbackRes.isLive || !readbackRes.permalink) {
    receipt.errorMessage = readbackRes.errorMessage || fallbackMessage
    return
  }

  // 승인 원고에 CTA 가 있으면, 게시 본문까지 확인되기 전에는 VERIFIED 로 올리지 않는다.
  // provider 가 본문을 돌려주지 않으면 승인한 CTA 가 실렸는지 알 수 없다(fail-closed).
  if (channelHasApprovedCta(channel, currentPayload)) {
    const expectedText =
      channel === 'instagram'
        ? composeInstagramPublishText(currentPayload.copies.instagram)
        : composeThreadsPublishText(currentPayload.copies.threads)
    const copyMatch = publishedTextMatches(readbackRes.caption, expectedText)

    if (copyMatch === null) {
      // permalink·verifiedAt 을 비워 둔다. 게시는 됐지만 승인 원고와 같은지는 미확인.
      receipt.errorMessage =
        'COPY_UNVERIFIED: 게시된 본문을 확인하지 못했어요. 승인한 안내 문구가 실렸는지 직접 확인해 주세요.'
      return
    }
    if (copyMatch === false) {
      receipt.errorMessage =
        'PUBLISHED_COPY_MISMATCH: 게시된 본문이 승인한 원고와 달라요. 직접 확인해 주세요.'
      return
    }
  }
  // CTA 가 없는 원고는 기존 계약(permalink 확인)대로 판정한다.

  // Transition: PROVIDER_ACCEPTED → EXTERNALLY_VERIFIED
  receipt.stage = 'EXTERNALLY_VERIFIED'
  receipt.permalink = readbackRes.permalink
  receipt.verifiedAt = readbackRes.verifiedAt || new Date().toISOString()
}

/**
 * Executes dual publishing with strict 5-stage lifecycle and independent readback
 */
export async function executeDualProviderPublish(
  params: DualProviderPublishParams
): Promise<DualPublishExecutionResult> {
  const { approvedMission, currentPayload, adapters = {} } = params

  // 1. Enforce tamper guard before any destructive action
  validateApprovalForPublish(approvedMission, currentPayload)

  const receipts: Partial<Record<DualPublishChannel, DualPublishChannelReceipt>> = {}
  const targetChannels = currentPayload.channels.map((c) => c.provider as DualPublishChannel)

  for (const channel of targetChannels) {
    const adapter = adapters[channel] ?? createDefaultProductionAdapter(channel)
    const requestId = `req_${channel}_${Date.now()}`
    const receiptId = `rcpt_${channel}_${Date.now()}`

    const receipt: DualPublishChannelReceipt = {
      channel,
      stage: 'REQUESTED',
      receiptId,
      requestId,
      approvalFingerprint: approvedMission.approvedFingerprint,
      attemptCount: 1,
      lastAttemptAt: new Date().toISOString(),
    }

    // Pre-mutation Mission Gate check immediately before provider write
    if (params.assertMissionGateAllowed && approvedMission.missionId) {
      try {
        await params.assertMissionGateAllowed({
          workspaceId: currentPayload.workspaceId,
          missionId: approvedMission.missionId,
          workerObservedEpoch: params.workerObservedEpoch,
        })
      } catch (gateErr: any) {
        receipt.stage = 'FAILED'
        receipt.errorMessage = gateErr?.message || 'Mission control gate blocked channel write'
        receipts[channel] = receipt
        // Invariant: If paused/blocked, do not attempt subsequent channels (0 external writes)
        break
      }
    } else if (params.isContractMission) {
      receipt.stage = 'FAILED'
      receipt.errorMessage = '[CONTROL_GATE_DEPENDENCY_REQUIRED] assertMissionGateAllowed is required for contract mission'
      receipts[channel] = receipt
      break
    }

    try {
      // Transition: REQUESTED → EXECUTING
      receipt.stage = 'EXECUTING'
      const pubRes = await adapter.publish(channel, currentPayload)

      if (!pubRes.providerAccepted || !pubRes.providerPostId) {
        receipt.stage = isUncertainPublishError(pubRes.errorMessage) ? 'RESULT_UNKNOWN' : 'FAILED'
        receipt.errorMessage = pubRes.errorMessage || 'Provider rejected or did not accept the publish payload'
        receipts[channel] = receipt
        continue
      }

      // Transition: EXECUTING → PROVIDER_ACCEPTED
      receipt.stage = 'PROVIDER_ACCEPTED'
      receipt.providerPostId = pubRes.providerPostId
      receipt.requestId = pubRes.requestId || requestId

      // Invariant: Independent Readback required before VERIFIED
      const readbackRes = await adapter.readback(pubRes.providerPostId, {
        workspaceId: currentPayload.workspaceId,
        channel,
      })
      // ANI-1775: 본문까지 대조한다. 어긋나면 PROVIDER_ACCEPTED 로 남는다(VERIFIED 아님).
      applyReadbackVerification(
        receipt,
        readbackRes,
        channel,
        currentPayload,
        'Readback verification failed: post is not live',
      )
    } catch (err: any) {
      const errMsg = err?.message || String(err)
      receipt.stage = isUncertainPublishError(errMsg) ? 'RESULT_UNKNOWN' : 'FAILED'
      receipt.errorMessage = errMsg || 'Unexpected publish exception'
    }

    receipts[channel] = receipt
  }

  // 2. Evaluate overall status without blurring
  const channelReceiptList = Object.values(receipts) as DualPublishChannelReceipt[]
  const verifiedCount = channelReceiptList.filter((r) => r.stage === 'EXTERNALLY_VERIFIED').length
  const totalChannels = targetChannels.length

  let overallStatus: DualPublishOverallStatus = 'FAILED'
  if (verifiedCount === totalChannels && totalChannels > 0) {
    overallStatus = 'ALL_VERIFIED'
  } else if (verifiedCount > 0) {
    overallStatus = 'PARTIAL_SUCCESS'
  }

  return {
    overallStatus,
    missionId: currentPayload.missionId,
    approvalFingerprint: approvedMission.approvedFingerprint,
    receipts,
    completedAt: new Date().toISOString(),
  }
}

/**
 * Retries only the failed channel with selective idempotency (never re-publishes verified channels)
 */
export async function retryFailedChannelPublish(
  params: RetryFailedChannelParams
): Promise<DualPublishExecutionResult> {
  const {
    approvedMission,
    currentPayload,
    targetChannel,
    existingReceipts,
    adapters = {},
  } = params

  // 1. Enforce tamper guard & channel authorization
  validateApprovalForPublish(approvedMission, currentPayload)

  const isApprovedChannel = currentPayload.channels.some((c) => c.provider === targetChannel)
  if (!isApprovedChannel) {
    throw new Error(
      `[INVALID_RETRY_CHANNEL] Channel '${targetChannel}' is not configured in approved channels.`
    )
  }

  // 2. Enforce idempotency: Never re-publish an already EXTERNALLY_VERIFIED channel
  const existingReceipt = existingReceipts[targetChannel]
  if (existingReceipt && existingReceipt.stage === 'EXTERNALLY_VERIFIED') {
    throw new Error(
      `[CHANNEL_ALREADY_VERIFIED] Channel '${targetChannel}' is already verified live (${existingReceipt.permalink}). Duplicate publish prevented.`
    )
  }

  // 3. Re-execute only target channel with strict idempotency and duplicate prevention
  const adapter = adapters[targetChannel] ?? createDefaultProductionAdapter(targetChannel)
  const prevAttempts = existingReceipt?.attemptCount ?? 0
  const requestId = existingReceipt?.requestId || `req_${targetChannel}_${Date.now()}`
  const receiptId = existingReceipt?.receiptId ?? `rcpt_${targetChannel}_${Date.now()}`

  const newReceipt: DualPublishChannelReceipt = {
    channel: targetChannel,
    stage: 'REQUESTED',
    receiptId,
    requestId,
    approvalFingerprint: approvedMission.approvedFingerprint,
    attemptCount: prevAttempts + 1,
    lastAttemptAt: new Date().toISOString(),
  }

  if (existingReceipt && (existingReceipt.stage === 'PROVIDER_ACCEPTED' || Boolean(existingReceipt.providerPostId))) {
    // Invariant: Provider already accepted the post. Only perform independent readback, NEVER publish again!
    const providerPostId = existingReceipt.providerPostId!
    newReceipt.providerPostId = providerPostId
    newReceipt.stage = 'PROVIDER_ACCEPTED'

    try {
      const readbackRes = await adapter.readback(providerPostId, {
        workspaceId: currentPayload.workspaceId,
        channel: targetChannel,
      })
      applyReadbackVerification(
        newReceipt,
        readbackRes,
        targetChannel,
        currentPayload,
        'Retry readback verification failed: post is not live',
      )
    } catch (err: any) {
      newReceipt.errorMessage = err.message || 'Retry readback exception'
    }
  } else if (existingReceipt && existingReceipt.stage === 'RESULT_UNKNOWN' && !existingReceipt.providerPostId) {
    // Invariant: When previous outcome is uncertain without providerPostId, automated republishing is blocked!
    throw new Error(
      `[RESULT_UNKNOWN_RETRY_BLOCKED] Channel '${targetChannel}' previous publish outcome is uncertain. Automated re-publishing is blocked to prevent duplicate posts.`
    )
  } else {
    // Only explicitly failed channels without provider acceptance can re-attempt publish
    try {
      if (params.assertMissionGateAllowed && approvedMission.missionId) {
        await params.assertMissionGateAllowed({
          workspaceId: currentPayload.workspaceId,
          missionId: approvedMission.missionId,
          workerObservedEpoch: params.workerObservedEpoch,
        })
      } else if (params.isContractMission) {
        throw new Error('[CONTROL_GATE_DEPENDENCY_REQUIRED] assertMissionGateAllowed is required for contract mission')
      }

      newReceipt.stage = 'EXECUTING'
      const pubRes = await adapter.publish(targetChannel, currentPayload)

      if (!pubRes.providerAccepted || !pubRes.providerPostId) {
        newReceipt.stage = isUncertainPublishError(pubRes.errorMessage) ? 'RESULT_UNKNOWN' : 'FAILED'
        newReceipt.errorMessage = pubRes.errorMessage || 'Provider rejected or did not accept the retry publish payload'
      } else {
        newReceipt.stage = 'PROVIDER_ACCEPTED'
        newReceipt.providerPostId = pubRes.providerPostId
        newReceipt.requestId = pubRes.requestId || requestId

        const readbackRes = await adapter.readback(pubRes.providerPostId, {
          workspaceId: currentPayload.workspaceId,
          channel: targetChannel,
        })
        applyReadbackVerification(
          newReceipt,
          readbackRes,
          targetChannel,
          currentPayload,
          'Retry readback verification failed',
        )
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err)
      newReceipt.stage = isUncertainPublishError(errMsg) ? 'RESULT_UNKNOWN' : 'FAILED'
      newReceipt.errorMessage = errMsg || 'Unexpected retry exception'
    }
  }

  // 4. Merge receipts
  const mergedReceipts: Partial<Record<DualPublishChannel, DualPublishChannelReceipt>> = {
    ...existingReceipts,
    [targetChannel]: newReceipt,
  }

  const allApprovedVerified =
    currentPayload.channels.length > 0 &&
    currentPayload.channels.every(
      (c) => mergedReceipts[c.provider as DualPublishChannel]?.stage === 'EXTERNALLY_VERIFIED'
    )
  const anyApprovedVerified = currentPayload.channels.some(
    (c) => mergedReceipts[c.provider as DualPublishChannel]?.stage === 'EXTERNALLY_VERIFIED'
  )

  let overallStatus: DualPublishOverallStatus = 'FAILED'
  if (allApprovedVerified) {
    overallStatus = 'ALL_VERIFIED'
  } else if (anyApprovedVerified) {
    overallStatus = 'PARTIAL_SUCCESS'
  }

  return {
    overallStatus,
    missionId: currentPayload.missionId,
    approvalFingerprint: approvedMission.approvedFingerprint,
    receipts: mergedReceipts,
    completedAt: new Date().toISOString(),
  }
}
