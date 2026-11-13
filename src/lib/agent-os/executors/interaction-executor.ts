/**
 * Sohee V0.8.9 Interaction Canonical Executor (ANI-656, ANI-659)
 * 
 * Reuses existing Done runtimes:
 * - ANI-619: Meta Interaction Runtime (Instagram 댓글/DM, Threads 답글/Webhook)
 * - Inbound Ingestion / Customer Timeline
 * 
 * Invariants:
 * - Real DB queries against customer_conversations / leads (NO synthetic mock)
 * - Strict separation between 'DRAFT' and 'EXECUTE' modes
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { sendApprovedMetaResponse } from '@/features/channels/meta-response-provider'
import type { ClaimedResponse } from '@/features/channels/response-delivery-repository'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { randomUUID, createHash } from 'node:crypto'
import { ProofChainService } from '@/lib/evidence/proof-chain-service'

export interface CustomerInteraction {
  id: string
  customerName: string
  channel: string
  slot?: string
  treatment?: string
  /** 예약금 근거가 확인되기 전에는 '예약금 상태 미확인'. */
  depositStatus: string
  /** 금액을 모르면 null. 0원으로 단정하지 않는다. */
  depositAmount?: number | null
  lastMessage: string
  unread: boolean
}

/** customer_conversations.channel 은 소문자 코드다. 사장님 화면에 코드를 그대로 내보내지 않는다. */
const CONVERSATION_CHANNEL_LABEL: Record<string, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  naver_place: '네이버 플레이스',
}

const BOOKING_UNOBSERVED_NOTE = '예약 확정 건수는 예약 장부에서 확인해 주세요.'
const DEPOSIT_UNOBSERVED_NOTE = '수납 금액은 입금 확인 근거가 연결되면 보여드릴 수 있어요.'

export type InteractionIntentMode = 'DRAFT' | 'EXECUTE'

export type EvidenceMaturity =
  | 'DRAFT'
  | 'TRANSPORT_SUCCESS'
  | 'PROVIDER_ACCEPTED'
  | 'VERIFICATION_LIMITED'
  | 'EXTERNAL_VERIFIED'
  | 'VERIFY_FAILED'

export interface InteractionReplyParams {
  signal?: AbortSignal
  workspaceId: string
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_BLOG' | 'DAANGN'
  targetId: string
  replyText: string
  intentMode: InteractionIntentMode
  connectionId?: string
  externalAccountId?: string
  readbackVerifier?: () => Promise<{ isVerified: boolean; authoritativeId?: string }>
}

export interface InteractionReplyResult {
  success: boolean
  intentMode: InteractionIntentMode
  requiresApproval: boolean
  /** null = provider 호출 결과를 확인할 수 없어 미전송으로 단정할 수 없음. */
  externalMessageSent: boolean | null
  providerReference?: string
  statusMessage: string
  errorCode?: string
  draftText?: string
  evidenceMaturity?: EvidenceMaturity
  evidenceId?: string
  receiptId?: string
  rawProviderResponse?: unknown
  verified?: boolean
}

export class InteractionExecutor {
  /**
   * 1. Query real customer interactions from DB (ANI-938 Fail-Closed SSOT)
   * Strictly separates QUERY_FAILED from verified empty (EMPTY_VERIFIED).
   * customer_conversations 에는 예약 확정 상태·예약금 근거가 없으므로 확정 건수·수납 금액은
   * null(미관측)로 돌려준다. 없는 근거를 0원·'입금 대기'로 채우지 않는다.
   */
  public static async queryCustomerInteractions(
    workspaceId: string,
    signal?: AbortSignal,
    readClient?: Awaited<ReturnType<typeof createServerSupabaseClient>>
  ): Promise<{
    success: boolean
    status: 'READY' | 'EMPTY_VERIFIED' | 'QUERY_FAILED'
    /** null = 이 조회로는 확정 예약 건수를 알 수 없다. 0건으로 단정하지 않는다. */
    totalConfirmedBookings: number | null
    bookingState: 'OBSERVED' | 'NOT_OBSERVED' | 'ERROR'
    totalDepositCollected: string
    depositState: 'OBSERVED' | 'NOT_OBSERVED' | 'ERROR'
    channelsSummary: string
    customerList: CustomerInteraction[]
    errorCode?: string
  }> {
    try {
      signal?.throwIfAborted()
      const supabase = readClient ?? await createServerSupabaseClient()
      signal?.throwIfAborted()

      // Query from customer_conversations table or leads
      const query = supabase
        .from('customer_conversations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(10)
      const { data: convs, error } = await (signal ? query.abortSignal(signal) : query)
      signal?.throwIfAborted()

      if (error || !Array.isArray(convs)) {
        // Invariant: DB error must be QUERY_FAILED, never false-green success
        console.error('[InteractionExecutor] Database query error:', error)
        return {
          success: false,
          status: 'QUERY_FAILED',
          errorCode: 'DB_QUERY_ERROR',
          totalConfirmedBookings: null,
          bookingState: 'ERROR',
          totalDepositCollected: '조회 실패 (DB 오류)',
          depositState: 'ERROR',
          channelsSummary: '상담 데이터 조회 중 데이터베이스 오류가 발생했습니다.',
          customerList: []
        }
      }

      if (!convs || convs.length === 0) {
        // 상담이 없다는 사실만 확인됐다. 예약 확정·수납 금액은 이 표에 근거가 없다.
        return {
          success: true,
          status: 'EMPTY_VERIFIED',
          totalConfirmedBookings: null,
          bookingState: 'NOT_OBSERVED',
          totalDepositCollected: DEPOSIT_UNOBSERVED_NOTE,
          depositState: 'NOT_OBSERVED',
          channelsSummary: '연동된 채널의 활성 상담 내역이 없습니다.',
          customerList: []
        }
      }

      // customer_conversations 에는 예약 상태·예약금·시술·슬롯 컬럼이 없다.
      // 없는 값을 '입금 대기'·'0원'·기본 시술명으로 채우지 않고, 확인된 컬럼만 그대로 옮긴다.
      const customerList: CustomerInteraction[] = convs.map((c: any) => ({
        id: c.id,
        customerName: c.display_label || '고객님',
        channel: CONVERSATION_CHANNEL_LABEL[c.channel] || '채널 확인 필요',
        depositStatus: '예약금 상태 미확인',
        depositAmount: null,
        lastMessage: c.summary || '상담 요약이 아직 없습니다.',
        unread: Boolean(c.requires_human_review)
      }))

      return {
        success: true,
        status: 'READY',
        totalConfirmedBookings: null,
        bookingState: 'NOT_OBSERVED',
        totalDepositCollected: DEPOSIT_UNOBSERVED_NOTE,
        depositState: 'NOT_OBSERVED',
        channelsSummary: `연동 채널 실시간 상담 ${customerList.length}건. ${BOOKING_UNOBSERVED_NOTE}`,
        customerList
      }
    } catch (err) {
      signal?.throwIfAborted()
      console.error('[InteractionExecutor] Exception querying customers:', err)
      return {
        success: false,
        status: 'QUERY_FAILED',
        errorCode: 'QUERY_EXCEPTION',
        totalConfirmedBookings: null,
        bookingState: 'ERROR',
        totalDepositCollected: '조회 실패',
        depositState: 'ERROR',
        channelsSummary: '조회 중 런타임 예외가 발생했습니다.',
        customerList: []
      }
    }
  }

  /**
   * 2. Reply to Comment with Strict DRAFT vs EXECUTE Intent (ANI-656, ANI-659)
   * - DRAFT Mode: NO external API invocation. Generates draft & returns approval card state.
   * - EXECUTE Mode: Checks killswitch, calls sendApprovedMetaResponse, verifies providerReference.
   */
  public static async replyToComment(params: InteractionReplyParams): Promise<InteractionReplyResult> {
    params.signal?.throwIfAborted()
    // A. DRAFT Mode: "답변 써줘", "초안 작성해줘"
    if (params.intentMode === 'DRAFT') {
      return {
        success: true,
        intentMode: 'DRAFT',
        requiresApproval: true,
        externalMessageSent: false,
        evidenceMaturity: 'DRAFT',
        verified: false,
        draftText: params.replyText,
        statusMessage: '고객 맞춤 답변 초안이 작성되었습니다. 사장님의 확인 및 승인 후 실제 외부로 발송됩니다.'
      }
    }

    // B. EXECUTE Mode: "답변 보내줘", "발송해줘"
    try {
      const supabase = await createServerSupabaseClient()

      // 1. Killswitch Preflight Check
      const killCheck = await checkKillSwitchPreflight(supabase, {
        workspaceId: params.workspaceId,
        channel: params.channel,
        provider: params.channel.toLowerCase()
      })

      if (killCheck.blocked) {
        return {
          success: false,
          intentMode: 'EXECUTE',
          requiresApproval: false,
          externalMessageSent: false,
          evidenceMaturity: 'VERIFY_FAILED',
          verified: false,
          errorCode: 'KILLSWITCH_ACTIVE',
          statusMessage: `긴급 킬스위치가 활성화되어 있어 답변 전송이 차단되었습니다: ${killCheck.reason || '관리자 긴급 중단'}`
        }
      }

      // 2. Meta Provider Execution (Instagram / Threads)
      if (params.channel === 'INSTAGRAM' || params.channel === 'THREADS') {
        const responseKind = params.channel === 'INSTAGRAM' ? 'instagram_comment_reply' as const : 'threads_reply' as const
        const provider = params.channel === 'INSTAGRAM' ? 'instagram' as const : 'threads' as const

        let connectionId = params.connectionId;
        let externalAccountId = params.externalAccountId;

        if (!connectionId || !externalAccountId) {
          try {
            const { data: conn } = await supabase
              .from('channel_connections')
              .select('id, external_account_id')
              .eq('workspace_id', params.workspaceId)
              .eq('channel', provider)
              .maybeSingle();
            if (conn) {
              connectionId = connectionId || (conn.id ?? undefined);
              externalAccountId = externalAccountId || (conn.external_account_id ?? undefined);
            }
          } catch (cErr) {
            console.warn('[InteractionExecutor] Failed to resolve channel_connection:', cErr);
          }
        }

        const draftFingerprint = createHash('sha256').update(params.replyText).digest('hex')
        const idempotencyKey = createHash('sha256').update(`sohee:${params.workspaceId}:${params.targetId}:${draftFingerprint}`).digest('hex')

        const claim: ClaimedResponse = {
          attemptId: randomUUID(),
          status: 'pending',
          providerReference: null,
          errorCode: null,
          isNew: true,
          workspaceId: params.workspaceId.length === 36 ? params.workspaceId : '00000000-0000-0000-0000-000000000000',
          responseJobId: randomUUID(),
          connectionId: connectionId && connectionId.length === 36 ? connectionId : '00000000-0000-0000-0000-000000000000',
          provider,
          externalAccountId: externalAccountId || 'sohee_official',
          responseKind,
          externalTargetId: params.targetId,
          draftText: params.replyText,
          draftFingerprint,
          idempotencyKey,
          claimToken: randomUUID()
        }

        params.signal?.throwIfAborted()
        let sent: { providerReference: string }
        try {
          sent = await sendApprovedMetaResponse(claim, undefined, params.signal)
        } catch {
          // Provider 호출 진입 뒤 오류는 미전송의 증거가 아니다. 자동 재전송하지 않는다.
          return {
            success: false,
            intentMode: 'EXECUTE',
            requiresApproval: false,
            externalMessageSent: null,
            evidenceMaturity: 'VERIFICATION_LIMITED',
            verified: false,
            errorCode: 'RESULT_UNKNOWN',
            statusMessage: '전송 결과를 확인하지 못했어요. 중복 전송을 막기 위해 다시 보내지 않고 기존 전송 내역을 확인해야 해요.'
          }
        }

        // Evaluate Evidence Maturity (ANI-980)
        let evidenceMaturity: EvidenceMaturity = 'VERIFICATION_LIMITED'
        let verified = false

        if (params.readbackVerifier) {
          try {
            const rb = await params.readbackVerifier()
            if (rb.isVerified) {
              evidenceMaturity = 'EXTERNAL_VERIFIED'
              verified = true
            } else {
              evidenceMaturity = 'VERIFY_FAILED'
              verified = false
            }
          } catch {
            evidenceMaturity = 'VERIFY_FAILED'
            verified = false
          }
        } else {
          // Without independent readback, strictly restrict to VERIFICATION_LIMITED (or PROVIDER_ACCEPTED)
          evidenceMaturity = 'VERIFICATION_LIMITED'
          verified = false
        }

        let evidenceId: string | undefined
        try {
          const proof = await ProofChainService.initiateProof({
            workspaceId: params.workspaceId,
            actionId: `act_reply_${Date.now()}_${randomUUID().slice(0, 8)}`,
            channel: params.channel,
            idempotencyKey,
            requestPayload: { targetId: params.targetId, replyText: params.replyText },
          })
          evidenceId = proof.evidenceId

          if (evidenceMaturity === 'EXTERNAL_VERIFIED') {
            await ProofChainService.verifyWithIndependentReadback(proof.evidenceId, async () => ({
              isLive: true,
              authoritativeId: sent.providerReference,
              permalink: `https://${params.channel.toLowerCase()}.com/p/${sent.providerReference}`,
              contentSnapshot: params.replyText,
            }))
          } else {
            await ProofChainService.markVerificationLimited(proof.evidenceId, {
              objectId: sent.providerReference,
              rawResponse: { providerReference: sent.providerReference },
              reason: 'Independent readback unavailable for comment reply channel',
            })
          }
        } catch (proofErr) {
          console.warn('[InteractionExecutor] Proof chain creation warning:', proofErr)
        }

        const receiptId = randomUUID()
        try {
          const db = supabase as any
          await db.from('external_action_receipts').insert({
            id: receiptId,
            workspace_id: params.workspaceId,
            action_request_id: randomUUID(),
            channel: params.channel,
            action_kind: 'comment_reply',
            status: 'accepted',
            external_id: sent.providerReference,
            payload: { targetId: params.targetId, replyText: params.replyText },
            verified,
            evidence_maturity: evidenceMaturity,
            raw_response: { providerReference: sent.providerReference },
            created_at: new Date().toISOString()
          })
        } catch (receiptErr) {
          console.warn('[InteractionExecutor] Receipt persist warning:', receiptErr)
        }

        return {
          success: true,
          intentMode: 'EXECUTE',
          requiresApproval: false,
          externalMessageSent: true,
          providerReference: sent.providerReference,
          evidenceMaturity,
          evidenceId,
          receiptId,
          rawProviderResponse: { providerReference: sent.providerReference },
          verified,
          statusMessage: `댓글 답글이 실제 ${params.channel}에 전송되었습니다 (Ref: ${sent.providerReference}, 증거 성숙도: ${evidenceMaturity}).`
        }
      }

      // Unsupported direct reply channel: Fail-Closed (NO synthetic ref-${Date.now()})
      return {
        success: false,
        intentMode: 'EXECUTE',
        requiresApproval: false,
        externalMessageSent: false,
        evidenceMaturity: 'VERIFY_FAILED',
        verified: false,
        errorCode: 'UNSUPPORTED_REPLY_CHANNEL',
        statusMessage: `${params.channel} 채널은 현재 직접 자동 답글 API 어댑터가 연동되지 않았습니다 (CONNECT_REQUIRED).`
      }
    } catch (err: unknown) {
      params.signal?.throwIfAborted()
      console.error('[InteractionExecutor] Reply execution error:', err)
      return {
        success: false,
        intentMode: 'EXECUTE',
        requiresApproval: false,
        externalMessageSent: false,
        evidenceMaturity: 'VERIFY_FAILED',
        verified: false,
        errorCode: 'PROVIDER_DISCONNECTED',
        statusMessage: `채널 연결 정보를 확인해 주세요: ${String(err)}`
      }
    }
  }

  /**
   * 3. Send Direct Message (DM) with Strict DRAFT vs EXECUTE Intent (ANI-656, ANI-938)
   */
  public static async sendDirectMessage(params: InteractionReplyParams): Promise<InteractionReplyResult> {
    params.signal?.throwIfAborted()
    // A. DRAFT Mode: NO external API call
    if (params.intentMode === 'DRAFT') {
      return {
        success: true,
        intentMode: 'DRAFT',
        requiresApproval: true,
        externalMessageSent: false,
        evidenceMaturity: 'DRAFT',
        verified: false,
        draftText: params.replyText,
        statusMessage: '1:1 DM 답변 초안이 준비되었습니다. 사장님의 최종 승인 후 전송됩니다.'
      }
    }

    // B. EXECUTE Mode
    try {
      const supabase = await createServerSupabaseClient()

      const killCheck = await checkKillSwitchPreflight(supabase, {
        workspaceId: params.workspaceId,
        channel: params.channel,
        provider: params.channel.toLowerCase()
      })

      if (killCheck.blocked) {
        return {
          success: false,
          intentMode: 'EXECUTE',
          requiresApproval: false,
          externalMessageSent: false,
          evidenceMaturity: 'VERIFY_FAILED',
          verified: false,
          errorCode: 'KILLSWITCH_ACTIVE',
          statusMessage: `긴급 킬스위치 활성화로 DM 전송이 차단되었습니다: ${killCheck.reason || '관리자 차단'}`
        }
      }

      if (params.channel === 'INSTAGRAM') {
        let connectionId = params.connectionId;
        let externalAccountId = params.externalAccountId;

        if (!connectionId || !externalAccountId) {
          try {
            const { data: conn } = await supabase
              .from('channel_connections')
              .select('id, external_account_id')
              .eq('workspace_id', params.workspaceId)
              .eq('channel', 'instagram')
              .maybeSingle();
            if (conn) {
              connectionId = connectionId || (conn.id ?? undefined);
              externalAccountId = externalAccountId || (conn.external_account_id ?? undefined);
            }
          } catch (cErr) {
            console.warn('[InteractionExecutor] Failed to resolve channel_connection for DM:', cErr);
          }
        }

        const draftFingerprint = createHash('sha256').update(params.replyText).digest('hex')
        const idempotencyKey = createHash('sha256').update(`sohee:${params.workspaceId}:${params.targetId}:${draftFingerprint}`).digest('hex')

        const claim: ClaimedResponse = {
          attemptId: randomUUID(),
          status: 'pending',
          providerReference: null,
          errorCode: null,
          isNew: true,
          workspaceId: params.workspaceId.length === 36 ? params.workspaceId : '00000000-0000-0000-0000-000000000000',
          responseJobId: randomUUID(),
          connectionId: connectionId && connectionId.length === 36 ? connectionId : '00000000-0000-0000-0000-000000000000',
          provider: 'instagram',
          externalAccountId: externalAccountId || 'sohee_official',
          responseKind: 'instagram_dm',
          externalTargetId: params.targetId,
          draftText: params.replyText,
          draftFingerprint,
          idempotencyKey,
          claimToken: randomUUID()
        }

        params.signal?.throwIfAborted()
        let sent: { providerReference: string }
        try {
          sent = await sendApprovedMetaResponse(claim, undefined, params.signal)
        } catch {
          // Provider 호출 진입 뒤 오류는 미전송의 증거가 아니다. 자동 재전송하지 않는다.
          return {
            success: false,
            intentMode: 'EXECUTE',
            requiresApproval: false,
            externalMessageSent: null,
            evidenceMaturity: 'VERIFICATION_LIMITED',
            verified: false,
            errorCode: 'RESULT_UNKNOWN',
            statusMessage: '전송 결과를 확인하지 못했어요. 중복 전송을 막기 위해 다시 보내지 않고 기존 전송 내역을 확인해야 해요.'
          }
        }

        // Evaluate Evidence Maturity (ANI-980)
        let evidenceMaturity: EvidenceMaturity = 'VERIFICATION_LIMITED'
        let verified = false

        if (params.readbackVerifier) {
          try {
            const rb = await params.readbackVerifier()
            if (rb.isVerified) {
              evidenceMaturity = 'EXTERNAL_VERIFIED'
              verified = true
            } else {
              evidenceMaturity = 'VERIFY_FAILED'
              verified = false
            }
          } catch {
            evidenceMaturity = 'VERIFY_FAILED'
            verified = false
          }
        } else {
          // Without independent readback, strictly restrict to VERIFICATION_LIMITED (or PROVIDER_ACCEPTED)
          evidenceMaturity = 'VERIFICATION_LIMITED'
          verified = false
        }

        let evidenceId: string | undefined
        try {
          const proof = await ProofChainService.initiateProof({
            workspaceId: params.workspaceId,
            actionId: `act_dm_${Date.now()}_${randomUUID().slice(0, 8)}`,
            channel: params.channel,
            idempotencyKey,
            requestPayload: { targetId: params.targetId, replyText: params.replyText },
          })
          evidenceId = proof.evidenceId

          if (evidenceMaturity === 'EXTERNAL_VERIFIED') {
            await ProofChainService.verifyWithIndependentReadback(proof.evidenceId, async () => ({
              isLive: true,
              authoritativeId: sent.providerReference,
              permalink: `https://instagram.com/direct/t/${sent.providerReference}`,
              contentSnapshot: params.replyText,
            }))
          } else {
            await ProofChainService.markVerificationLimited(proof.evidenceId, {
              objectId: sent.providerReference,
              rawResponse: { providerReference: sent.providerReference },
              reason: 'Independent readback unavailable for DM channel',
            })
          }
        } catch (proofErr) {
          console.warn('[InteractionExecutor] Proof chain creation warning:', proofErr)
        }

        const receiptId = randomUUID()
        try {
          const db = supabase as any
          await db.from('external_action_receipts').insert({
            id: receiptId,
            workspace_id: params.workspaceId,
            action_request_id: randomUUID(),
            channel: params.channel,
            action_kind: 'dm',
            status: 'accepted',
            external_id: sent.providerReference,
            payload: { targetId: params.targetId, replyText: params.replyText },
            verified,
            evidence_maturity: evidenceMaturity,
            raw_response: { providerReference: sent.providerReference },
            created_at: new Date().toISOString()
          })
        } catch (receiptErr) {
          console.warn('[InteractionExecutor] Receipt persist warning:', receiptErr)
        }

        return {
          success: true,
          intentMode: 'EXECUTE',
          requiresApproval: false,
          externalMessageSent: true,
          providerReference: sent.providerReference,
          evidenceMaturity,
          evidenceId,
          receiptId,
          rawProviderResponse: { providerReference: sent.providerReference },
          verified,
          statusMessage: `인스타그램 DM이 성공적으로 발송되었습니다 (Ref: ${sent.providerReference}, 증거 성숙도: ${evidenceMaturity}).`
        }
      }

      // Unsupported DM channel: Fail-Closed (NO synthetic dm-${Date.now()})
      return {
        success: false,
        intentMode: 'EXECUTE',
        requiresApproval: false,
        externalMessageSent: false,
        evidenceMaturity: 'VERIFY_FAILED',
        verified: false,
        errorCode: 'UNSUPPORTED_DM_CHANNEL',
        statusMessage: `${params.channel} 채널은 현재 1:1 DM 자동 발송 API를 지원하지 않습니다 (CONNECT_REQUIRED).`
      }
    } catch (err: unknown) {
      params.signal?.throwIfAborted()
      console.error('[InteractionExecutor] DM execution error:', err)
      return {
        success: false,
        intentMode: 'EXECUTE',
        requiresApproval: false,
        externalMessageSent: false,
        evidenceMaturity: 'VERIFY_FAILED',
        verified: false,
        errorCode: 'PROVIDER_DISCONNECTED',
        statusMessage: `채널 연결 정보를 확인해 주세요: ${String(err)}`
      }
    }
  }
}
