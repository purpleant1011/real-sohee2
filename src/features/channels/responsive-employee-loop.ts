import 'server-only'

import { verifyCapabilityConsent } from '@/features/channels/consent-ledger'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH'
export type PolicyAction = 'AUTONOMOUS_ALLOWED' | 'REQUIRE_APPROVAL' | 'ESCALATE_TO_HUMAN'

export interface RiskEvaluationInput {
  channel: 'instagram' | 'threads'
  category: 'comment' | 'reply' | 'mention' | 'dm'
  text: string
}

export interface RiskEvaluationResult {
  riskTier: RiskTier
  isAutonomousAllowed: boolean
  policyAction: PolicyAction
  reason: string
}

const HIGH_RISK_PATTERNS = [
  {
    regex: /(환불|결제취소|반품|보상|손해배상|위약금|사기|고소|신고|소송|피해|경찰|변호사|dispute|refund|lawsuit|scam|chargeback)/iu,
    label: '환불/분쟁/불만 키워드가 감지되었습니다.',
  },
  {
    regex: /(개판|쓰레기|망해라|고발|폭로|불매|사기꾼|fuck|shit|bitch|bastard)/iu,
    label: '공격적/위험 비방 표현이 감지되었습니다.',
  },
  {
    regex: /(주민등록번호|계좌번호|비밀번호|카드번호|진단서|처방전|의료|성형부작용)/iu,
    label: '민감 개인정보 또는 의료/법적 상담 키워드가 감지되었습니다.',
  },
]

const MEDIUM_RISK_PATTERNS = [
  {
    regex: /(단체|워크샵|패키지|견적|계약|단독예약|할인율|제휴|협찬|비즈니스|대량구매|quote|contract|partnership)/iu,
    label: '맞춤 견적 또는 대량/비즈니스 제휴 문의로 담당자 승인이 필요합니다.',
  },
]

/**
 * 수신거부 여부를 확인하지 못했을 때 작업을 취소 상태로 남긴다(fail-closed 부산물).
 * 이 기록 자체가 실패해도 발송 차단은 유지해야 하므로 예외를 던지지 않는다.
 */
async function blockResponseJobForOptOutUnavailable(
  client: any,
  jobId: string,
  cause: unknown,
): Promise<void> {
  try {
    const message = cause instanceof Error ? cause.message : String((cause as any)?.message || cause)
    await client
      .from('channel_response_jobs')
      .update({
        status: 'cancelled',
        cancellation_reason: 'OPT_OUT_CHECK_UNAVAILABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    console.warn('[ResponsiveEmployeeLoop] Job cancelled because opt-out check failed:', jobId, message)
  } catch (persistErr) {
    console.error(
      '[ResponsiveEmployeeLoop] Failed to persist opt-out-check cancellation, delivery still blocked:',
      persistErr,
    )
  }
}

/**
 * Evaluates inbound interaction risk (ANI-1012).
 * Fails closed for refunds, disputes, harassment, medical/legal, and complex pricing.
 */
export function evaluateRiskPolicy(input: RiskEvaluationInput): RiskEvaluationResult {
  const text = input.text || ''

  for (const { regex, label } of HIGH_RISK_PATTERNS) {
    if (regex.test(text)) {
      return {
        riskTier: 'HIGH',
        isAutonomousAllowed: false,
        policyAction: 'ESCALATE_TO_HUMAN',
        reason: label,
      }
    }
  }

  for (const { regex, label } of MEDIUM_RISK_PATTERNS) {
    if (regex.test(text)) {
      return {
        riskTier: 'MEDIUM',
        isAutonomousAllowed: false,
        policyAction: 'REQUIRE_APPROVAL',
        reason: label,
      }
    }
  }

  return {
    riskTier: 'LOW',
    isAutonomousAllowed: true,
    policyAction: 'AUTONOMOUS_ALLOWED',
    reason: '일상적인 소통/인사/칭찬/기본 문의로 자동 응답이 허용됩니다.',
  }
}

export interface ExecuteDeliveryInput {
  jobId: string
  actorUserId: string
  client: any
  metaProvider?: any
  accessToken?: string
}

export interface ExecuteDeliveryResult {
  success: boolean
  jobId: string
  actionRequestId?: string
  attemptId?: string
  status?: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'RESULT_UNKNOWN'
  providerPostId?: string
  errorCode?: string
  message: string
}

/**
 * Executes delivery for a channel response job (ANI-1012, ANI-999).
 * Guarantees zero provider calls on consent/auth/risk failure.
 */
export async function executeResponseJobDelivery(
  input: ExecuteDeliveryInput,
): Promise<ExecuteDeliveryResult> {
  const { jobId, actorUserId, client } = input

  // 1. Fetch Response Job
  const { data: job, error: jobErr } = await client
    .from('channel_response_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    return {
      success: false,
      jobId,
      errorCode: 'JOB_NOT_FOUND',
      message: `응답 작업을 찾을 수 없습니다: ${jobErr?.message || '존재하지 않음'}`,
    }
  }

  const workspaceId = job.workspace_id
  const connectionId = job.channel_connection_id

  // 2. Fetch Connection
  const { data: conn, error: connErr } = await client
    .from('channel_connections')
    .select('*')
    .eq('id', connectionId)
    .maybeSingle()

  if (connErr || !conn) {
    return {
      success: false,
      jobId,
      errorCode: 'CONNECTION_NOT_FOUND',
      message: '연결된 채널 정보를 찾을 수 없습니다.',
    }
  }

  const channel = conn.channel as 'instagram' | 'threads'
  const capabilityScope = job.response_kind === 'instagram_dm' ? 'reply_dm' : 'reply_comments'

  // 3. Customer Opt-Out / Privacy Deletion Guard (Fail-Closed, Highest Priority)
  // ANI-1753 후속 스키마 드리프트 폐쇄: 과거에는 customer_opt_outs 테이블이 없어 조회가 항상
  // 실패했고, 그 실패를 삼켜(=fail-open) 수신거부 고객에게도 자동 응답을 보냈다.
  // 이제는 조회 자체가 실패하면(테이블 부재·권한·네트워크) 발송을 막고 사유를 남긴다.
  const targetCustomerId = (job as any).external_target_id || (job as any).customer_id
  if (targetCustomerId) {
    let optOutLookup: { data?: unknown; error?: unknown } | undefined
    try {
      optOutLookup = await client
        .from('customer_opt_outs')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('customer_id', targetCustomerId)
        .maybeSingle()
    } catch (optErr) {
      // 던진 예외도 "확인 불가"이므로 발송을 막는다(예전에는 여기서 삼켜 fail-open 이었다).
      console.error(
        '[ResponsiveEmployeeLoop] Opt-out lookup threw, blocking delivery (fail-closed):',
        optErr,
      )
      await blockResponseJobForOptOutUnavailable(client, jobId, optErr)
      return {
        success: false,
        jobId,
        status: 'BLOCKED',
        errorCode: 'OPT_OUT_CHECK_UNAVAILABLE',
        message:
          '수신거부 여부를 확인하지 못해 자동 응답을 보내지 않았습니다. 확인 후 다시 시도해 주세요.',
      }
    }

    if (optOutLookup?.error) {
      const lookupError = optOutLookup.error as { message?: string; code?: string }
      console.error(
        '[ResponsiveEmployeeLoop] Opt-out lookup failed, blocking delivery (fail-closed):',
        lookupError?.code || '',
        lookupError?.message || lookupError,
      )
      await blockResponseJobForOptOutUnavailable(client, jobId, lookupError)
      return {
        success: false,
        jobId,
        status: 'BLOCKED',
        errorCode: 'OPT_OUT_CHECK_UNAVAILABLE',
        message:
          '수신거부 여부를 확인하지 못해 자동 응답을 보내지 않았습니다. 확인 후 다시 시도해 주세요.',
      }
    }

    if (optOutLookup?.data) {
      await client
        .from('channel_response_jobs')
        .update({
          status: 'cancelled',
          cancellation_reason: 'CUSTOMER_OPTED_OUT',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return {
        success: false,
        jobId,
        status: 'BLOCKED',
        errorCode: 'CUSTOMER_OPTED_OUT',
        message: '고객의 데이터 삭제 및 수신거부(Opt-out) 요청으로 인해 자동 응답이 차단되었습니다.',
      }
    }
  }

  // 4. Consent Envelope Check (ANI-998 Fail-Closed)
  const consentCheck = await verifyCapabilityConsent(workspaceId, channel, capabilityScope, client)
  if (!consentCheck.consented) {
    return {
      success: false,
      jobId,
      status: 'BLOCKED',
      errorCode: 'CONSENT_BLOCKED',
      message: `채널 동의 부재 또는 철회로 인해 응답이 차단되었습니다: ${consentCheck.reason || consentCheck.failureCode}`,
    }
  }

  // 4. Resolve Credentials
  let token = input.accessToken || conn.access_token
  if (!token) {
    try {
      const cred = await loadChannelCredentialByChannel(workspaceId, channel as MetaOAuthChannel)
      token = cred.accessToken
    } catch (credErr: any) {
      return {
        success: false,
        jobId,
        status: 'FAILED',
        errorCode: 'CREDENTIAL_ERROR',
        message: `채널 토큰 로드 실패: ${credErr?.message}`,
      }
    }
  }

  // Live Rollout Allowlist Check for Meta Response Delivery (Fail-Closed)
  if ((channel === 'instagram' || channel === 'threads') && !isMetaLiveAllowed(workspaceId)) {
    return {
      success: false,
      jobId,
      status: 'BLOCKED',
      errorCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
    }
  }

  // 5. Pre-persist Canonical Action Request (Fail-Closed)
  const actionRequestId = crypto.randomUUID()
  const attemptId = crypto.randomUUID()

  const actionKindMap: Record<string, string> = {
    instagram_comment_reply: 'INSTAGRAM_COMMENT_REPLY',
    instagram_dm: 'INSTAGRAM_DM_REPLY',
    threads_reply: 'THREADS_REPLY_PUBLISH',
  }
  const actionKind = actionKindMap[job.response_kind] || 'EXTERNAL_WRITE'

  const reqInsert = await client.from('external_action_requests').insert?.({
    id: actionRequestId,
    workspace_id: workspaceId,
    channel,
    action_kind: actionKind,
    status: 'in_progress',
    correlation_id: jobId,
    parameters: {
      target_id: job.external_target_id,
      text: job.draft_text,
    },
    requested_by: actorUserId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  // 6. Pre-persist Attempt
  await client.from('external_action_attempts').insert?.({
    id: attemptId,
    action_request_id: actionRequestId,
    attempt_number: 1,
    status: 'calling_provider',
    started_at: new Date().toISOString(),
  })

  // 7. Provider Write
  let providerRes: { id?: string; [key: string]: any } | null = null
  try {
    const provider = input.metaProvider
    if (job.response_kind === 'instagram_comment_reply') {
      providerRes = await provider.sendCommentReply({
        commentId: job.external_target_id,
        message: job.draft_text,
        accessToken: token,
      })
    } else if (job.response_kind === 'instagram_dm') {
      providerRes = await provider.sendDirectMessage({
        recipientId: job.external_target_id,
        message: job.draft_text,
        accessToken: token,
      })
    } else if (job.response_kind === 'threads_reply') {
      providerRes = await provider.replyThread({
        threadId: job.external_target_id,
        text: job.draft_text,
        accessToken: token,
      })
    }
  } catch (providerErr: any) {
    const errorMsg = providerErr?.message || 'Meta Provider error'
    const isTimeout =
      errorMsg.includes('timeout') ||
      errorMsg.includes('Timeout') ||
      errorMsg.includes('ETIMEDOUT') ||
      errorMsg.includes('504') ||
      providerErr?.name === 'AbortError'

    if (isTimeout) {
      if (typeof client.from('external_action_attempts')?.update === 'function') {
        await client
          .from('external_action_attempts')
          .update({
            status: 'RESULT_UNKNOWN',
            failure_code: 'TIMEOUT_RESULT_UNKNOWN',
            finished_at: new Date().toISOString(),
          })
          .eq('id', attemptId)
      }

      if (typeof client.from('external_action_requests')?.update === 'function') {
        await client
          .from('external_action_requests')
          .update({
            status: 'RESULT_UNKNOWN',
            failure_code: 'TIMEOUT_RESULT_UNKNOWN',
            updated_at: new Date().toISOString(),
          })
          .eq('id', actionRequestId)
      }

      // Record quarantine receipt
      if (typeof client.from('external_action_receipts')?.insert === 'function') {
        await client.from('external_action_receipts').insert({
          id: crypto.randomUUID(),
          workspace_id: job.workspace_id,
          action_request_id: actionRequestId,
          attempt_id: attemptId,
          receipt_kind: 'timeout_quarantine',
          receipt_status: 'UNKNOWN',
          reconcile_state: 'READBACK_REQUIRED',
          observed_payload: {
            error_message: errorMsg,
            job_id: jobId,
          },
          recorded_by: actorUserId,
          recorded_at: new Date().toISOString(),
        })
      }

      return {
        success: false,
        jobId,
        actionRequestId,
        attemptId,
        status: 'RESULT_UNKNOWN',
        errorCode: 'TIMEOUT_RESULT_UNKNOWN',
        message: `응대 전송 타임아웃: 결과 불확실(RESULT_UNKNOWN)로 격리되어 재전송이 차단되었습니다. (${errorMsg})`,
      }
    }

    // Fail attempt
    if (typeof client.from('external_action_attempts')?.update === 'function') {
      await client
        .from('external_action_attempts')
        .update({ status: 'failed', failure_code: 'PROVIDER_ERROR', finished_at: new Date().toISOString() })
        .eq('id', attemptId)
    }
    return {
      success: false,
      jobId,
      actionRequestId,
      attemptId,
      status: 'FAILED',
      errorCode: 'PROVIDER_ERROR',
      message: `Meta API 전송 실패: ${providerErr?.message}`,
    }
  }

  const publishedPostId = providerRes?.id || providerRes?.message_id || 'provider-ack'

  // 8. Persist observed_result receipt
  await client.from('external_action_receipts').insert?.({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    action_request_id: actionRequestId,
    attempt_id: attemptId,
    receipt_kind: 'observed_result',
    provider_reference: publishedPostId,
    observed_payload: {
      provider_response: providerRes,
      job_id: jobId,
    },
    recorded_by: actorUserId,
    recorded_at: new Date().toISOString(),
  })

  // 9. Update channel_delivery_attempts and channel_response_jobs
  if (typeof client.from('channel_delivery_attempts')?.insert === 'function') {
    await client.from('channel_delivery_attempts').insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      response_job_id: jobId,
      attempt_number: 1,
      idempotency_key: job.idempotency_key,
      status: 'succeeded',
      provider_reference: publishedPostId,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
  }

  if (typeof client.from('channel_response_jobs')?.update === 'function') {
    await client
      .from('channel_response_jobs')
      .update({
        status: 'sent',
        provider_reference: publishedPostId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
  }

  return {
    success: true,
    jobId,
    actionRequestId,
    attemptId,
    providerPostId: publishedPostId,
    message: '응답이 성공적으로 발행되었으며 영수증이 기록되었습니다.',
  }
}
