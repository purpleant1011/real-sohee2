/**
 * Sohee V0.8.9 Publishing Canonical Executor (ANI-655, ANI-659)
 * 
 * Reuses existing Done runtimes:
 * - ANI-598/618: Meta API read-after-write & Naver blog browser delegation
 * - ANI-617: Pre-flight Kill Switch check
 * - ANI-627: Browser Delegation Vault for Naver/Daangn
 * 
 * Invariants:
 * - NO synthetic / hard-coded post ID (ANI-648)
 * - Returns verified permalink or honest 'verification_pending' / 'failed'
 * - Records idempotent receipt into external_action_receipts
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { createInstagramProvider, createThreadsProvider, type MetaFetch } from '@/lib/providers/meta-api'
import { getPostReadback } from '@/lib/providers/instagram-provider'
import { ChannelId } from '@/lib/channels/channel-registry'
import { ProofChainService } from '@/lib/evidence/proof-chain-service'
import { BrowserTaskService, type BrowserTaskDriver } from '@/lib/channels/browser-task-contract'
import { CanonicalActionLedgerService } from '@/features/external-actions/canonical-action-ledger'
import { ExecutionAdmissionGate } from '@/features/channels/execution-admission-gate'
import { ActionRequestConflictError } from '@/lib/external-actions/action-request-contract'
import {
  assertPublishMissionGateAllowed,
} from '@/lib/mission-os/mission-lineage-guard'
import { NAVER_AUTOMATION_BLOCKED_MESSAGE } from '@/features/naver-publish/automation-policy'

export interface PublishInput {
  workspaceId: string
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN'
  caption: string
  imageUrl?: string
  idempotencyKey?: string
  readbackFetcher?: MetaFetch
  browserDriver?: BrowserTaskDriver
  autoSubmit?: boolean
  sessionRef?: string
  title?: string
  actorUserId?: string
  isAutonomousExecution?: boolean
  contentVersionId?: string
  expectedFingerprint?: string
  isPublicCustomer?: boolean
  missionId?: string
  workerObservedEpoch?: number
}

export type PublishingStage =
  | 'VALIDATED'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFYING'
  | 'EXTERNAL_VERIFIED'
  | 'AWAITING_BROWSER_EXECUTION'
  | 'RESULT_UNKNOWN'
  | 'FAILED'

export interface PublishResult {
  success: boolean
  verified: boolean
  stage: PublishingStage
  channel: string
  publishedUrl?: string
  externalPostId?: string
  receiptId?: string
  evidenceId?: string
  providerRequestId?: string
  readbackRequestId?: string
  statusMessage: string
  errorCode?: string
  browserTaskId?: string
}

export class PublishingExecutor {
  public static async executePublish(input: PublishInput): Promise<PublishResult> {
    // 0. Strict Production Kill Switch for Raw Unapproved Publishing (ANI-1133)
    // Legacy raw-media entrypoint is completely blocked in production before any external/DB access
    if (process.env.NODE_ENV === 'production' && (!input.contentVersionId || !input.expectedFingerprint)) {
      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: '프로덕션 환경에서는 승인된 CreativeBundle 및 Fingerprint가 없는 레거시 raw-media 발행이 전면 금지(Kill Switch)됩니다.',
        errorCode: 'LEGACY_RAW_PUBLISH_KILL_SWITCH'
      }
    }

    const supabase = await createServerSupabaseClient()
    const channelId = input.channel as ChannelId

    // 1. Mandatory Kill Switch Check (ANI-617)
    const killCheck = await checkKillSwitchPreflight(supabase, {
      workspaceId: input.workspaceId,
      channel: channelId,
      provider: (channelId === 'INSTAGRAM' || channelId === 'THREADS') ? 'META' : 'NAVER'
    })

    if (killCheck.blocked) {
      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: killCheck.reason || '긴급 킬스위치가 가동 중이므로 외부 발행이 차단되었습니다.',
        errorCode: 'KILL_SWITCH_ENGAGED'
      }
    }

    // 1-1. Mission Control Gate & Stale Epoch Check (ANI-1809, ANI-1880)
    // Prevents in-flight worker dispatch mutations if mission was PAUSED, contract unapproved, or epoch bumped (fail-closed)
    if (input.missionId) {
      try {
        await assertPublishMissionGateAllowed({
          supabase,
          workspaceId: input.workspaceId,
          missionId: input.missionId,
          workerObservedEpoch: input.workerObservedEpoch,
        })
      } catch (gateErr: unknown) {
        const message = gateErr instanceof Error ? gateErr.message : '미션 제어 게이트 차단'
        const isEpochStale = message.includes('CONTROL_GATE_STALE_EPOCH')
        const isUnapproved = message.includes('CONTROL_GATE_UNAPPROVED')
        const isExpired = message.includes('CONTROL_GATE_EXPIRED')
        return {
          success: false,
          verified: false,
          stage: 'FAILED',
          channel: input.channel,
          statusMessage: isEpochStale
            ? '워커가 관측한 제어 epoch가 미션의 최신 일시정지 상태와 일치하지 않으므로 외부 쓰기가 차단되었습니다.'
            : isUnapproved
            ? '미션 계획이 변경되었거나 승인되지 않아 새로운 외부 쓰기가 차단되었습니다.'
            : isExpired
            ? '미션 계약이 만료되어 새로운 외부 쓰기가 차단되었습니다.'
            : '해당 미션이 일시정지(PAUSED) 상태이거나 유효하지 않아 새로운 외부 쓰기가 차단되었습니다.',
          errorCode: isEpochStale
            ? 'CONTROL_GATE_STALE_EPOCH'
            : isUnapproved
            ? 'CONTROL_GATE_UNAPPROVED_CONTRACT'
            : isExpired
            ? 'CONTROL_GATE_EXPIRED'
            : 'CONTROL_GATE_BLOCKED',
        }
      }
    }

    // 2. Reject Placeholder or Missing Assets (ANI-940 Invariant: zero stock assets)
    // Threads supports text-only publish; Instagram strictly requires an approved image rendition
    const requiresImage = input.channel === 'INSTAGRAM'
    const hasImage = Boolean(input.imageUrl)
    const hasPlaceholder = hasImage && (
      input.imageUrl!.includes('unsplash.com') ||
      input.imageUrl!.includes('placeholder') ||
      input.imageUrl!.includes('dummy')
    )
    if ((requiresImage && !hasImage) || hasPlaceholder) {
      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: '승인된 정품 미디어 에셋이 필요합니다. 임의의 외부 스톡/플레이스홀더 이미지는 프로덕션 발행이 금지됩니다.',
        errorCode: 'MISSING_APPROVED_ASSET'
      }
    }

    // 2-1. Single-Point Execution Admission Gate (ANI-1022, ANI-1025)
    const channelMap: Record<string, 'instagram' | 'threads' | 'naver_blog' | 'daangn_business'> = {
      INSTAGRAM: 'instagram',
      THREADS: 'threads',
      NAVER_BLOG: 'naver_blog',
      DAANGN: 'daangn_business',
    }
    const actionKindMap: Record<string, 'feed_publish' | 'thread_publish' | 'blog_post' | 'business_news_post'> = {
      INSTAGRAM: 'feed_publish',
      THREADS: 'thread_publish',
      NAVER_BLOG: 'blog_post',
      DAANGN: 'business_news_post',
    }

    const admissionInput = {
      workspaceId: input.workspaceId,
      channel: channelMap[input.channel] || 'instagram',
      actionKind: actionKindMap[input.channel] || 'feed_publish',
      actorUserId: input.actorUserId,
      isAutonomousExecution: input.isAutonomousExecution,
      contentVersionId: input.contentVersionId,
      expectedFingerprint: input.expectedFingerprint,
      isPublicCustomer: input.isPublicCustomer,
    }
    const admission = await ExecutionAdmissionGate.evaluate(admissionInput)

    if (!admission.admitted) {
      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: admission.message,
        errorCode: admission.reasonCode,
      }
    }

    // 3. Meta Graph Channels (Instagram, Threads)
    if (input.channel === 'INSTAGRAM' || input.channel === 'THREADS') {
      const providerKey = input.channel.toLowerCase() as 'instagram' | 'threads'
      
      let accessToken: string | null = null
      let accountId: string | null = null

      try {
        const cred = await loadChannelCredentialByChannel(input.workspaceId, providerKey)
        accessToken = cred.accessToken
        accountId = cred.externalAccountId || null
      } catch (err) {
        console.warn(`[PublishingExecutor] Credential load warning for ${input.channel}:`, err)
      }

      if (!accessToken || !accountId) {
        return {
          success: false,
          verified: false,
          stage: 'FAILED',
          channel: input.channel,
          statusMessage: `${input.channel} 채널이 아직 공식 연동되지 않았습니다. [채널 연동] 메뉴에서 계정을 먼저 연결해 주세요.`,
          errorCode: 'CHANNEL_NOT_CONNECTED'
        }
      }

      let actionReq: any = null
      let attempt: any = null

      try {
        let permalink: string | null = null
        let publishedPostId: string | null = null
        let providerRequestId: string = `prov_req_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`

        const imageUrls = input.imageUrl ? [input.imageUrl] : []
        const channelKey = input.channel.toLowerCase() as 'instagram' | 'threads'
        const actionKind = input.channel === 'THREADS' ? 'thread_publish' : 'feed_publish'

        // Deterministic Idempotency Key (ANI-1045)
        const idempotencyKey = input.idempotencyKey || (
          input.contentVersionId
            ? `pub_${input.workspaceId}_${channelKey}_${input.contentVersionId}`
            : `pub_${input.workspaceId}_${channelKey}_${Date.now()}`
        )

        // 1. Create durable external_action_requests row BEFORE provider call (ANI-1020, ANI-1045)
        actionReq = await CanonicalActionLedgerService.createActionRequest({
          workspaceId: input.workspaceId,
          channel: channelKey,
          actionKind,
          targetExternalId: accountId,
          targetLabel: `@${accountId}`,
          exactPayload: {
            caption: input.caption,
            imageUrl: input.imageUrl,
          },
          contentVersionId: input.contentVersionId,
          approvalFingerprint: input.expectedFingerprint,
          idempotencyKey,
        })

        // Idempotency: if request already succeeded, return existing receipt without duplicate provider call
        if (actionReq.isExisting && actionReq.status === 'succeeded' && actionReq.resultUrl) {
          return {
            success: true,
            verified: true,
            stage: 'EXTERNAL_VERIFIED',
            channel: input.channel,
            publishedUrl: actionReq.resultUrl,
            externalPostId: actionReq.providerReference,
            receiptId: actionReq.receiptId,
            statusMessage: `공식 ${input.channel} 채널에 이미 정상 발행 및 검증이 완료된 원고입니다 (멱등성 확인).`,
          }
        }

        // No existing request may create a second provider attempt through this legacy path.
        // This also covers succeeded rows without receipts and in-flight/ambiguous attempts.
        if (actionReq.isExisting) {
          return {
            success: false,
            verified: false,
            stage: 'RESULT_UNKNOWN',
            channel: input.channel,
            errorCode: 'UNKNOWN_RESULT',
            statusMessage: `이전 ${input.channel} 게시 요청의 결과가 불확실한 상태(RESULT_UNKNOWN)입니다. 재시도 전 외부 상태 확인(Reconcile)이 필요합니다.`,
          }
        }

        // 2. Start attempt row immediately prior to provider invocation (ANI-1020)
        attempt = await CanonicalActionLedgerService.startAttempt({
          workspaceId: input.workspaceId,
          actionRequestId: actionReq.requestId,
          attemptNumber: 1,
        })

        // Initiate Canonical Proof Chain
        const proof = await ProofChainService.initiateProof({
          workspaceId: input.workspaceId,
          actionId: actionReq.requestId,
          channel: input.channel,
          idempotencyKey,
          requestPayload: { caption: input.caption, imageUrl: input.imageUrl },
        })

        // Pre-mutation Authoritative Re-check (fail-closed immediately before provider write)
        if (input.missionId) {
          await assertPublishMissionGateAllowed({
            supabase,
            workspaceId: input.workspaceId,
            missionId: input.missionId,
            workerObservedEpoch: input.workerObservedEpoch,
          })
        }

        const latestAdmission = await ExecutionAdmissionGate.evaluate(admissionInput)
        if (!latestAdmission.admitted) {
          return { success: false, verified: false, stage: 'FAILED', channel: input.channel,
            statusMessage: latestAdmission.message, errorCode: latestAdmission.reasonCode }
        }
        try {
          const latestCredential = await loadChannelCredentialByChannel(input.workspaceId, providerKey)
          if (latestCredential.externalAccountId !== accountId) throw new Error('채널 계정 변경')
          accessToken = latestCredential.accessToken
        } catch {
          return { success: false, verified: false, stage: 'FAILED', channel: input.channel,
            statusMessage: '현재 채널 권한을 확인할 수 없어 게시를 실행하지 않았습니다.', errorCode: 'EXECUTION_PREFLIGHT_BLOCKED' }
        }

        if (input.channel === 'INSTAGRAM') {
          const igProvider = createInstagramProvider()
          const result = await igProvider.publish({
            accountId,
            accessToken,
            caption: input.caption,
            imageUrls,
            isAiGenerated: true,
            onContainerCreated: async (containerId) => {
              providerRequestId = `container_${containerId}`
            },
          })
          if (result.providerPostId) {
            publishedPostId = result.providerPostId
            permalink = result.destinationUrl || `https://www.instagram.com/p/${publishedPostId}/`
          }
        } else {
          const threadsProvider = createThreadsProvider()
          const result = await threadsProvider.publish({
            accountId,
            accessToken,
            text: input.caption,
            imageUrls,
            onContainerCreated: async (containerId) => {
              providerRequestId = `container_${containerId}`
            },
          })
          if (result.providerPostId) {
            publishedPostId = result.providerPostId
            permalink = result.destinationUrl || `https://www.threads.net/post/${publishedPostId}`
          }
        }

        if (publishedPostId && permalink) {
          // Provider Accepted (Write receipt recorded)
          const providerWriteReceipt = {
            id: publishedPostId,
            permalink,
            providerRequestId,
            acceptedAt: new Date().toISOString(),
          }

          await ProofChainService.markProviderAccepted(proof.evidenceId, {
            objectId: publishedPostId,
            rawResponse: providerWriteReceipt,
          })

          // Independent Readback Verification (ANI-923, ANI-950, ANI-956 Invariant)
          // Calls actual Meta Graph GET API independently of the write response payload
          let readbackReceipt: {
            readbackRequestId?: string
            observedAt?: string
            captionDigest?: string
            authoritativePermalink?: string
          } | null = null

          const channelType = input.channel === 'THREADS' ? 'threads' : 'instagram'

          const readbackOutcome = await ProofChainService.verifyWithIndependentReadback(
            proof.evidenceId,
            async () => {
              const readback = await getPostReadback(publishedPostId!, accessToken!, {
                channel: channelType,
                fetcher: input.readbackFetcher,
              })

              if (!readback.isLive || !readback.permalink || !readback.postId) {
                return {
                  isLive: false,
                  authoritativeId: readback.postId || publishedPostId!,
                  permalink: readback.permalink,
                  contentSnapshot: readback.caption,
                  error: readback.error || 'Provider independent readback reported item not live or missing authoritative identifiers.',
                  readbackRequestId: readback.readbackRequestId,
                  observedAt: readback.observedAt,
                  captionDigest: readback.captionDigest,
                }
              }

              readbackReceipt = {
                readbackRequestId: readback.readbackRequestId,
                observedAt: readback.observedAt,
                captionDigest: readback.captionDigest,
                authoritativePermalink: readback.permalink,
              }

              return {
                isLive: true,
                authoritativeId: readback.postId,
                permalink: readback.permalink,
                contentSnapshot: readback.caption || input.caption,
                readbackRequestId: readback.readbackRequestId,
                observedAt: readback.observedAt,
                captionDigest: readback.captionDigest,
              }
            }
          )

          const capturedReadback = readbackReceipt as {
            readbackRequestId?: string
            observedAt?: string
            captionDigest?: string
            authoritativePermalink?: string
          } | null

          if (!readbackOutcome.verified) {
            // Provider write succeeded but independent readback could not verify live presence.
            // Mark external action as unknown_result to prevent duplicate writes and allow reconciliation (ANI-1045, ANI-1047)
            if (actionReq?.requestId) {
              try {
                await CanonicalActionLedgerService.markUnknownResult({
                  workspaceId: input.workspaceId,
                  actionRequestId: actionReq.requestId,
                  attemptId: attempt?.attemptId,
                  reason: readbackOutcome.errorReason || 'Provider write succeeded but independent readback could not verify live presence.',
                })
              } catch (markErr) {
                console.error('[PublishingExecutor] Failed to mark unknown_result on readback failure:', markErr)
              }
            }

            const isUnknown = readbackOutcome.chain?.stage === 'RESULT_UNKNOWN'

            return {
              success: false,
              verified: false,
              stage: isUnknown ? 'RESULT_UNKNOWN' : 'VERIFYING',
              channel: input.channel,
              externalPostId: publishedPostId,
              evidenceId: proof.evidenceId,
              providerRequestId,
              readbackRequestId: capturedReadback?.readbackRequestId,
              statusMessage: isUnknown
                ? '공급자 접수 후 외부 상태 확인 중 오류가 발생하여 상태가 불확실합니다 (RESULT_UNKNOWN).'
                : '공급자 접수는 완료되었으나 외부 라이브 상태 확인이 아직 완료되지 않았습니다.',
              errorCode: isUnknown ? 'READBACK_FAILED' : 'READBACK_PENDING',
            }
          }

          const verifiedUrl = capturedReadback?.authoritativePermalink || permalink

          // Record receipt in external_action_receipts with distinct providerRequestId & readbackRequestId (ANI-1020)
          const receiptOutcome = await CanonicalActionLedgerService.recordReceiptAndVerify({
            workspaceId: input.workspaceId,
            actionRequestId: actionReq.requestId,
            attemptId: attempt.attemptId,
            providerReference: publishedPostId,
            resultUrl: verifiedUrl,
            observedPayload: {
              channel: channelKey,
              publishedPostId,
              permalink: verifiedUrl,
              providerRequestId,
              readbackRequestId: capturedReadback?.readbackRequestId,
              captionDigest: capturedReadback?.captionDigest,
              observedAt: capturedReadback?.observedAt,
            },
          })

          return {
            success: true,
            verified: true,
            stage: 'EXTERNAL_VERIFIED',
            channel: input.channel,
            publishedUrl: verifiedUrl,
            externalPostId: publishedPostId,
            receiptId: receiptOutcome.receiptId,
            evidenceId: proof.evidenceId,
            providerRequestId,
            readbackRequestId: capturedReadback?.readbackRequestId,
            statusMessage: `공식 ${input.channel} 채널에 정상 실발행 및 외부 검증이 완료되었습니다.`
          }
        }

        return {
          success: false,
          verified: false,
          stage: 'FAILED',
          channel: input.channel,
          statusMessage: `${input.channel} 게시물 발행 요청이 공급자 측에서 승인되지 않았습니다.`,
          errorCode: 'PROVIDER_REJECTED'
        }
      } catch (err: unknown) {
        if (err instanceof ActionRequestConflictError) throw err
        console.error(`[PublishingExecutor] Fatal publish error:`, err)

        // Transition to unknown_result if provider might have received the call (ANI-1045)
        if (actionReq?.requestId) {
          try {
            await CanonicalActionLedgerService.markUnknownResult({
              workspaceId: input.workspaceId,
              actionRequestId: actionReq.requestId,
              attemptId: attempt?.attemptId,
              reason: String(err),
            })
          } catch (markErr) {
            console.error('[PublishingExecutor] Failed to mark unknown_result:', markErr)
          }
        }

        return {
          success: false,
          verified: false,
          stage: 'RESULT_UNKNOWN',
          channel: input.channel,
          statusMessage: `외부 채널 통신 중 오류가 발생하여 결과가 불확실합니다 (RESULT_UNKNOWN): ${String(err)}`,
          errorCode: 'UNKNOWN_RESULT',
        }
      }
    }

    // 4. Naver Blog / Daangn Browser Plane (ANI-627, ANI-940, ANI-955)
    if (input.channel === 'NAVER_BLOG') {
      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: NAVER_AUTOMATION_BLOCKED_MESSAGE,
        errorCode: 'POLICY_DISABLED',
      }
    }

    if (input.channel === 'DAANGN') {
      const targetUrl = 'https://business.daangn.com'
      const sessionRef =
        input.sessionRef || `session_${input.workspaceId}_${input.channel.toLowerCase()}`
      const actionRunId = input.idempotencyKey || `act_browser_${Date.now()}`

      const browserChannelKey = 'daangn_business'
      const browserActionKind = 'business_news_post'

      const browserActionReq = await CanonicalActionLedgerService.createActionRequest({
        workspaceId: input.workspaceId,
        channel: browserChannelKey,
        actionKind: browserActionKind,
        targetExternalId: sessionRef,
        targetLabel: sessionRef,
        exactPayload: {
          title: input.title || input.caption.slice(0, 30),
          caption: input.caption,
          imageUrl: input.imageUrl,
        },
        idempotencyKey: actionRunId,
      })

      const browserAttempt = await CanonicalActionLedgerService.startAttempt({
        workspaceId: input.workspaceId,
        actionRequestId: browserActionReq.requestId,
        attemptNumber: 1,
      })

      const task = await BrowserTaskService.createTask({
        workspaceId: input.workspaceId,
        channel: input.channel,
        sessionRef,
        actionRunId,
        targetUrl,
        operation: 'POST_PUBLISH',
        payload: {
          title: input.title || input.caption.slice(0, 30),
          caption: input.caption,
          imageUrl: input.imageUrl,
        },
      })

      if (!input.browserDriver) {
        return {
          success: false,
          verified: false,
          stage: 'AWAITING_BROWSER_EXECUTION',
          channel: input.channel,
          statusMessage: `${input.channel} 원고 초안 준비 완료. 클라우드 브라우저 에디터 실행 및 실제 포스팅 검증 대기 중입니다 (미완료).`,
          errorCode: 'AWAITING_BROWSER_EXECUTION',
          browserTaskId: task.task_id,
        }
      }

      // Pre-mutation Authoritative Re-check (fail-closed immediately before browser write)
      if (input.missionId) {
        await assertPublishMissionGateAllowed({
          supabase,
          workspaceId: input.workspaceId,
          missionId: input.missionId,
          workerObservedEpoch: input.workerObservedEpoch,
        })
      }

      const executedTask = await BrowserTaskService.executeTaskLifecycle(
        task,
        input.browserDriver,
        { autoSubmit: input.autoSubmit ?? false }
      )

      if (executedTask.state === 'SESSION_EXPIRED') {
        return {
          success: false,
          verified: false,
          stage: 'FAILED',
          channel: input.channel,
          statusMessage: `${input.channel} 브라우저 세션이 만료되었습니다. 다시 로그인해 주세요.`,
          errorCode: 'SESSION_EXPIRED',
          browserTaskId: executedTask.task_id,
        }
      }

      if (executedTask.state === 'OWNER_HANDOFF_REQUIRED') {
        return {
          success: false,
          verified: false,
          stage: 'FAILED',
          channel: input.channel,
          statusMessage: `${input.channel} 보안 검증(CAPTCHA/2FA)이 감지되어 점주 개입이 필요합니다.`,
          errorCode: 'OWNER_HANDOFF_REQUIRED',
          browserTaskId: executedTask.task_id,
        }
      }

      if (executedTask.state === 'AWAITING_APPROVAL') {
        return {
          success: false,
          verified: false,
          stage: 'AWAITING_BROWSER_EXECUTION',
          channel: input.channel,
          statusMessage: `${input.channel} 원고 작성 완료. 점주 발행 승인 대기 중입니다.`,
          errorCode: 'AWAITING_BROWSER_EXECUTION',
          browserTaskId: executedTask.task_id,
        }
      }

      if (executedTask.state === 'RESULT_UNKNOWN') {
        return {
          success: false,
          verified: false,
          stage: 'RESULT_UNKNOWN',
          channel: input.channel,
          publishedUrl: executedTask.evidence.publishedUrl,
          externalPostId: executedTask.evidence.externalPostId,
          statusMessage: `${input.channel} 게시글 제출 후 독립 readback 검증 실패로 상태가 불확실합니다 (RESULT_UNKNOWN).`,
          errorCode: 'READBACK_FAILED',
          browserTaskId: executedTask.task_id,
        }
      }

      if (executedTask.state === 'EXTERNAL_VERIFIED') {
        const receiptOutcome = await CanonicalActionLedgerService.recordReceiptAndVerify({
          workspaceId: input.workspaceId,
          actionRequestId: browserActionReq.requestId,
          attemptId: browserAttempt.attemptId,
          providerReference: executedTask.evidence.externalPostId || executedTask.task_id,
          resultUrl: executedTask.evidence.publishedUrl || targetUrl,
          observedPayload: {
            channel: browserChannelKey,
            caption: input.caption,
            imageUrl: input.imageUrl,
            browserTaskId: executedTask.task_id,
            readbackDigest: executedTask.evidence.readbackDigest,
            verifiedAt: executedTask.evidence.verifiedAt,
            verified: true,
          },
        })

        return {
          success: true,
          verified: true,
          stage: 'EXTERNAL_VERIFIED',
          channel: input.channel,
          publishedUrl: executedTask.evidence.publishedUrl,
          externalPostId: executedTask.evidence.externalPostId,
          receiptId: receiptOutcome.receiptId,
          statusMessage: `공식 ${input.channel} 브라우저 실행 및 독립 DOM 검증이 완료되었습니다.`,
          browserTaskId: executedTask.task_id,
        }
      }

      return {
        success: false,
        verified: false,
        stage: 'FAILED',
        channel: input.channel,
        statusMessage: executedTask.error_message || `${input.channel} 브라우저 실행 실패`,
        errorCode: executedTask.error_code || 'BROWSER_EXECUTION_FAILED',
        browserTaskId: executedTask.task_id,
      }
    }

    return {
      success: false,
      verified: false,
      stage: 'FAILED',
      channel: input.channel,
      statusMessage: `지원되지 않는 채널입니다: ${input.channel}`,
      errorCode: 'UNSUPPORTED_CHANNEL',
    }
  }
}
