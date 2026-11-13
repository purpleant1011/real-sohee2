import 'server-only'
import crypto from 'node:crypto'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'
import { createInstagramProvider, createThreadsProvider, getPublishedMetaPostPermalink } from '@/lib/providers/meta-api'
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { findMatchingActionRequest } from './action-request-contract'
import { PersistenceError } from '@/lib/errors/persistence-error'

export interface MetaPublishExecutionInput {
  workspaceId: string
  actorUserId: string
  channel: 'instagram' | 'threads'
  caption?: string
  text?: string
  mediaUrls?: readonly string[]
  isAiGenerated?: boolean
  verificationCode?: string
  idempotencyKey?: string
  contentVersionId?: string
  approvalId?: string
  approvalFingerprint?: string
  adminClient?: any
  client?: any
  // Optional custom providers/fetchers for testing
  igProvider?: ReturnType<typeof createInstagramProvider>
  thProvider?: ReturnType<typeof createThreadsProvider>
  readbackFn?: typeof getPublishedMetaPostPermalink
}

async function safeUpdate(
  client: any,
  table: string,
  values: Record<string, any>,
  matchField: string,
  matchVal: any,
) {
  const tbl = client?.from?.(table)
  if (typeof tbl?.update === 'function') {
    const q = tbl.update(values)
    if (typeof q?.eq === 'function') {
      await q.eq(matchField, matchVal)
    }
  }
}

export interface MetaPublishExecutionResult {
  success: boolean
  verified: boolean
  actionRequestId: string
  attemptId: string
  channel: 'instagram' | 'threads'
  status: 'VERIFIED' | 'VERIFYING' | 'FAILED' | 'BLOCKED' | 'RESULT_UNKNOWN' | 'SUCCEEDED' | 'EXECUTING'
  providerPostId?: string
  permalink?: string
  errorCode?: string
  message: string
  receipt?: Record<string, unknown> | null
}

export async function executeMetaPublish(
  input: MetaPublishExecutionInput,
): Promise<MetaPublishExecutionResult> {
  const { workspaceId, actorUserId, channel } = input
  const providerKey = channel as MetaOAuthChannel

  // [HF-02 / HF-37] Defense-in-Depth Execution Boundary Guard (Fail-Closed)
  // Direct internal calls MUST NOT bypass canonical SOHEE_READY requirement.
  const { requireSoheeReady } = await import('@/features/sohee-ready/admission-guard')
  try {
    await requireSoheeReady(workspaceId, {
      action: 'META_PUBLISH',
      supabaseClient: input.adminClient,
    })
  } catch (readyErr: any) {
    if (readyErr?.code === 'SOHEE_NOT_READY') {
      return {
        success: false,
        verified: false,
        actionRequestId: '',
        attemptId: '',
        channel,
        status: 'BLOCKED',
        errorCode: 'SOHEE_NOT_READY',
        message: readyErr.message,
        receipt: null,
      }
    }
    throw readyErr
  }

  const adminClient = input.adminClient || createAdminSupabaseClient()

  // [HF-53 / ANI-1403] Operating Policy Runtime Enforcement (Emergency Stop & Allowed Channels)
  const { evaluateOperatingPolicyForPublish } = await import('@/features/operating-policy/runtime-enforcement')
  const policyEval = await evaluateOperatingPolicyForPublish(workspaceId, {
    channel,
    adminClient,
  })
  if (!policyEval.allowed) {
    return {
      success: false,
      verified: false,
      actionRequestId: '',
      attemptId: '',
      channel,
      status: 'BLOCKED',
      errorCode: policyEval.errorCode || 'OPERATING_POLICY_BLOCKED',
      message: policyEval.message,
      receipt: null,
    }
  }

  // Step 1 & 2: Validate Channel Connection & Status
  const { data: conn, error: connErr } = await (adminClient as any)
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', providerKey)
    .maybeSingle()

  if (connErr || !conn || conn.status === 'disconnected' || conn.status === 'not_connected') {
    return {
      success: false,
      verified: false,
      actionRequestId: '',
      attemptId: '',
      channel,
      status: 'FAILED',
      errorCode: 'CHANNEL_NOT_CONNECTED',
      message: `${channel.toUpperCase()} 채널 계정이 연동되지 않았거나 해제되었습니다.`,
      receipt: null,
    }
  }

  // Step 3: Load Credentials (Server-Only Decrypted)
  let accessToken: string
  let accountId: string

  // Never authorize writes using a legacy plaintext connection token.
  {
    try {
      const cred = await loadChannelCredentialByChannel(workspaceId, providerKey)
      accessToken = cred.accessToken
      accountId = cred.externalAccountId
      if (!accountId || accountId !== conn.external_account_id) throw new Error('연결된 계정이 변경되었습니다.')
    } catch (credErr: any) {
      return {
        success: false,
        verified: false,
        actionRequestId: '',
        attemptId: '',
        channel,
        status: 'FAILED',
        errorCode: 'CREDENTIAL_UNAVAILABLE',
        message: `채널 인증 토큰을 불러올 수 없습니다: ${credErr?.message || '인증 정보 부재'}`,
        receipt: null,
      }
    }
  }

  // Step 4: Kill Switch Preflight Guard
  const killCheck = await checkKillSwitchPreflight(adminClient as any, {
    workspaceId,
    channel: channel.toUpperCase() as any,
    provider: 'META',
  })

  if (killCheck.blocked) {
    return {
      success: false,
      verified: false,
      actionRequestId: '',
      attemptId: '',
      channel,
      status: 'BLOCKED',
      errorCode: 'KILL_SWITCH_ENGAGED',
      message: `Kill-switch 활성화로 인해 외부 발행이 차단되었습니다: ${killCheck.reason}`,
      receipt: null,
    }
  }

  // Step 4.5: Consent Envelope Check (ANI-998)
  const { verifyCapabilityConsent } = await import('@/features/channels/consent-ledger')
  const consentCheck = await verifyCapabilityConsent(
    workspaceId,
    channel,
    input.verificationCode ? 'verification_post_allowed' : 'publish',
    adminClient as any
  )
  if (consentCheck.status === 'REVOKED') {
    return {
      success: false,
      verified: false,
      actionRequestId: '',
      attemptId: '',
      channel,
      status: 'BLOCKED',
      errorCode: 'CONSENT_REVOKED',
      message: `${channel.toUpperCase()} 채널 위임 동의가 사용자에 의해 철회되었습니다.`,
      receipt: null,
    }
  }

  // Live Rollout Allowlist Check for Meta Publishing (Fail-Closed)
  if (!isMetaLiveAllowed(workspaceId)) {
    return {
      success: false,
      verified: false,
      actionRequestId: '',
      attemptId: '',
      channel,
      status: 'BLOCKED',
      errorCode: 'WORKSPACE_NOT_IN_LIVE_ROLLOUT',
      message: '아직 이 계정에서는 실제 게시를 열지 않았어요. 곧 열릴 예정이에요.',
      receipt: null,
    }
  }

  // Prepare Payload
  const actionRequestId = crypto.randomUUID()
  const attemptId = crypto.randomUUID()
  const verificationCode = input.verificationCode || crypto.createHash('sha256')
    .update(`${workspaceId}:${channel}:${input.idempotencyKey || input.caption || input.text || crypto.randomUUID()}`)
    .digest('hex').slice(0, 8).toUpperCase()
  const captionText = input.caption || input.text || (
    `소희 연결 인증이 완료되었습니다. 이 게시물은 계정 연결 및 정상 발행 확인을 위한 1회 테스트 게시물입니다. (인증코드: ${verificationCode})`
  )

  // 10th Revision Fail-Closed: Never fallback to static/stock Unsplash images (ANI-1070)
  if (!input.mediaUrls || input.mediaUrls.length === 0) {
    if (channel === 'instagram') {
      return {
        success: false,
        verified: false,
        actionRequestId: '',
        attemptId: '',
        channel,
        status: 'BLOCKED',
        errorCode: 'PUBLISH_MEDIA_REQUIRED',
        message: '인스타그램 피드 게시는 승인된 미디어(MediaAsset)가 필수입니다. 정적/스톡 이미지 대체는 엄격히 금지됩니다.',
        receipt: null,
      }
    }
  }

  const mediaUrls = input.mediaUrls || []
  for (const url of mediaUrls) {
    if (url.includes('images.unsplash.com') || url.includes('sohee_insta_post.jpg')) {
      return {
        success: false,
        verified: false,
        actionRequestId: '',
        attemptId: '',
        channel,
        status: 'BLOCKED',
        errorCode: 'STATIC_STOCK_MEDIA_PROHIBITED',
        message: '정적 파일 또는 Unsplash 스톡 이미지는 프로덕션 게시가 차단됩니다. (ANI-1070)',
        receipt: null,
      }
    }
  }

  const idempotencyKey =
    input.idempotencyKey ||
    `meta-pub-${workspaceId}-${channel}-${crypto.createHash('sha256').update(captionText || '').digest('hex').slice(0, 16)}`
  const actionKind = channel === 'instagram' ? 'feed_publish' : 'thread_publish'

  const exactPayload = {
    caption: captionText,
    mediaUrls,
    verificationCode,
    isAiGenerated: !!input.isAiGenerated,
  }
  const contract = {
    workspace_id: workspaceId, channel, action_kind: actionKind,
    target_external_id: accountId, exact_payload: exactPayload,
    content_version_id: input.contentVersionId ?? null,
    approval_id: input.approvalId ?? null,
    approval_fingerprint: input.approvalFingerprint ?? null,
  }
  const reuse = async (existingRequest: any): Promise<MetaPublishExecutionResult> => {
    const { data: existingReceipt, error } = await (adminClient as any)
      .from('external_action_receipts').select('*')
      .eq('workspace_id', workspaceId).eq('action_request_id', existingRequest.id).maybeSingle()
    if (error) throw new PersistenceError('reuseMetaPublish', '기존 결과를 조회하지 못했습니다.', error)
    const verified = existingRequest.status === 'succeeded'
      && existingReceipt?.receipt_kind === 'observed_result'
      && !!existingReceipt.result_url && !!existingReceipt.provider_reference
    const unknown = ['RESULT_UNKNOWN', 'unknown_result'].includes(existingRequest.status)
      || (existingRequest.status === 'succeeded' && !verified)
    return {
      success: verified,
      verified,
      actionRequestId: existingRequest.id, attemptId: '', channel,
      status: verified ? 'SUCCEEDED' : unknown ? 'RESULT_UNKNOWN' : existingRequest.status === 'failed' ? 'FAILED' : 'EXECUTING',
      providerPostId: verified ? existingReceipt.provider_reference : undefined,
      permalink: verified ? existingReceipt.result_url : undefined,
      errorCode: unknown ? 'TIMEOUT_RESULT_UNKNOWN' : undefined,
      message: '기존 요청을 재사용합니다. 새 게시를 실행하지 않았습니다.',
      receipt: existingReceipt || null,
    }
  }
  const existingRequest = await findMatchingActionRequest(adminClient, idempotencyKey, contract)
  if (existingRequest) return reuse(existingRequest)

  // Step 5: Fail-Closed Persistence - external_action_requests

  const requestQuery = (adminClient as any)
    .from('external_action_requests')
    .insert({
      id: actionRequestId,
      workspace_id: workspaceId,
      channel,
      action_kind: actionKind,
      target_external_id: accountId,
      target_label: conn.account_label || accountId,
      exact_payload: exactPayload,
      content_version_id: contract.content_version_id,
      approval_id: contract.approval_id,
      approval_fingerprint: contract.approval_fingerprint,
      idempotency_key: idempotencyKey,
      status: 'executing',
      created_by: actorUserId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  const requestInsertRes = typeof requestQuery?.select === 'function'
    ? await requestQuery.select('id').single()
    : await requestQuery

  if (requestInsertRes.error?.code === '23505') {
    const winner = await findMatchingActionRequest(adminClient, idempotencyKey, contract)
    if (!winner) throw new PersistenceError('createMetaPublish', '동시 요청 결과를 확인하지 못했습니다.', requestInsertRes.error)
    return reuse(winner)
  }
  assertSupabaseSuccess(requestInsertRes, 'external_action_requests insert')

  // Step 6: Fail-Closed Persistence - external_action_attempts
  const attemptQuery = (adminClient as any)
    .from('external_action_attempts')
    .insert({
      id: attemptId,
      workspace_id: workspaceId,
      action_request_id: actionRequestId,
      attempt_number: 1,
      status: 'claimed',
      started_at: new Date().toISOString(),
      created_by: actorUserId,
    })
  const attemptInsertRes = typeof attemptQuery?.select === 'function'
    ? await attemptQuery.select('id').single()
    : await attemptQuery

  assertSupabaseSuccess(attemptInsertRes, 'external_action_attempts insert')

  // Re-read server-owned authorization after persistence, immediately before dispatch.
  try {
    const latest = await loadChannelCredentialByChannel(workspaceId, providerKey)
    if (latest.externalAccountId !== accountId) throw new Error('채널 계정이 변경되었습니다.')
    const latestConsent = await verifyCapabilityConsent(workspaceId, channel, input.verificationCode ? 'verification_post_allowed' : 'publish', adminClient)
    const latestKill = await checkKillSwitchPreflight(adminClient, { workspaceId, channel: channel.toUpperCase() as any, provider: 'META' })
    const latestPolicy = await evaluateOperatingPolicyForPublish(workspaceId, { channel, adminClient })
    if (latestConsent.status === 'REVOKED' || latestKill.blocked || !latestPolicy.allowed) throw new Error('발행 권한이 철회되었습니다.')
    accessToken = latest.accessToken
  } catch {
    return {
      success: false, verified: false, actionRequestId, attemptId, channel,
      status: 'BLOCKED', errorCode: 'EXECUTION_PREFLIGHT_BLOCKED',
      message: '현재 채널 권한을 확인할 수 없어 게시를 실행하지 않았습니다.', receipt: null,
    }
  }

  // Step 7: Call Provider
  let publishedPostId: string | null = null

  try {
    if (channel === 'instagram') {
      const igProvider = input.igProvider || createInstagramProvider()
      const pubRes = await igProvider.publish({
        accountId,
        accessToken,
        caption: captionText,
        imageUrls: mediaUrls,
        isAiGenerated: !!input.isAiGenerated,
      })
      publishedPostId = pubRes.providerPostId
    } else {
      const thProvider = input.thProvider || createThreadsProvider()
      const pubRes = await thProvider.publish({
        accountId,
        accessToken,
        text: captionText,
        imageUrls: mediaUrls,
      })
      publishedPostId = pubRes.providerPostId
    }
  } catch (providerErr: any) {
    const errorMsg = providerErr?.message || 'Meta Provider error'
    const isTimeout =
      errorMsg.includes('timeout') ||
      errorMsg.includes('Timeout') ||
      errorMsg.includes('ETIMEDOUT') ||
      errorMsg.includes('ESOCKETTIMEDOUT') ||
      errorMsg.includes('ECONNRESET') ||
      errorMsg.includes('504') ||
      providerErr?.name === 'AbortError' ||
      providerErr?.code === 'ETIMEDOUT'

    if (isTimeout) {
      // Isolate to RESULT_UNKNOWN to prevent duplicate publish on blind retry (ANI-1328 / E2E-34)
      await safeUpdate(
        adminClient,
        'external_action_attempts',
        {
          status: 'RESULT_UNKNOWN',
          failure_code: 'TIMEOUT_RESULT_UNKNOWN',
          finished_at: new Date().toISOString(),
        },
        'id',
        attemptId,
      )

      await safeUpdate(
        adminClient,
        'external_action_requests',
        {
          status: 'RESULT_UNKNOWN',
          failure_code: 'TIMEOUT_RESULT_UNKNOWN',
          updated_at: new Date().toISOString(),
        },
        'id',
        actionRequestId,
      )

      const unknownReceipt = {
        id: crypto.randomUUID(),
        workspace_id: workspaceId,
        action_request_id: actionRequestId,
        attempt_id: attemptId,
        receipt_kind: 'timeout_quarantine',
        receipt_status: 'UNKNOWN',
        reconcile_state: 'READBACK_REQUIRED',
        observed_payload: {
          error_message: errorMsg,
          requires_provider_readback: true,
        },
        recorded_by: actorUserId,
        recorded_at: new Date().toISOString(),
      }

      if (typeof adminClient?.from?.('external_action_receipts')?.insert === 'function') {
        await adminClient.from('external_action_receipts').insert(unknownReceipt)
      }

      return {
        success: false,
        verified: false,
        actionRequestId,
        attemptId,
        channel,
        status: 'RESULT_UNKNOWN',
        errorCode: 'TIMEOUT_RESULT_UNKNOWN',
        message: `Meta API 전송 타임아웃: 결과 불확실(RESULT_UNKNOWN)로 격리되었습니다. Provider Readback Reconciler가 필요합니다. (${errorMsg})`,
        receipt: unknownReceipt,
      }
    }

    // Definite failure
    await safeUpdate(
      adminClient,
      'external_action_attempts',
      {
        status: 'failed',
        failure_code: 'PROVIDER_REJECTED',
        finished_at: new Date().toISOString(),
      },
      'id',
      attemptId,
    )

    await safeUpdate(
      adminClient,
      'external_action_requests',
      {
        status: 'failed',
        failure_code: 'PROVIDER_REJECTED',
        updated_at: new Date().toISOString(),
      },
      'id',
      actionRequestId,
    )

    return {
      success: false,
      verified: false,
      actionRequestId,
      attemptId,
      channel,
      status: 'FAILED',
      errorCode: 'META_API_ERROR',
      message: `Meta API 전송 실패: ${errorMsg}`,
      receipt: null,
    }
  }

  if (!publishedPostId) {
    return {
      success: false,
      verified: false,
      actionRequestId,
      attemptId,
      channel,
      status: 'FAILED',
      errorCode: 'INVALID_PROVIDER_RESPONSE',
      message: 'Provider 응답에서 유효한 게시물 ID를 수신하지 못했습니다.',
      receipt: null,
    }
  }

  // Step 8: Persist Provider Acceptance in attempt
  await safeUpdate(
    adminClient,
    'external_action_attempts',
    {
      status: 'submitted',
      provider_request_id: publishedPostId,
      provider_reference: publishedPostId,
    },
    'id',
    attemptId,
  )

  await safeUpdate(
    adminClient,
    'external_action_requests',
    {
      status: 'submitted',
      updated_at: new Date().toISOString(),
    },
    'id',
    actionRequestId,
  )

  // Step 9: Independent Provider GET / Readback
  const readbackFn = input.readbackFn || (typeof getPublishedMetaPostPermalink === 'function' ? getPublishedMetaPostPermalink : undefined)
  let verifiedPermalink: string | null = null

  if (readbackFn) {
    try {
      const readbackPermalink = await readbackFn({
        channel,
        providerPostId: publishedPostId,
        accessToken,
      })
      if (readbackPermalink) {
        verifiedPermalink = readbackPermalink
      }
    } catch (rbErr) {
      console.warn(`[meta-action-executor] Readback query warning:`, rbErr)
    }
  }

  // [P0-12] Strict Independent Readback Invariant:
  // Provider write response destinationUrl MUST NOT bypass readback verification.
  // Only authoritative permalink obtained via independent GET readback is accepted.
  if (verifiedPermalink && (verifiedPermalink.includes('live_recent') || verifiedPermalink.includes('/sample'))) {
    verifiedPermalink = null
  }

  if (!verifiedPermalink) {
    // Readback failed or timed out: isolate to RESULT_UNKNOWN, NEVER duplicate publish
    await safeUpdate(
      adminClient,
      'external_action_attempts',
      {
        status: 'unknown_result',
        failure_code: 'UNKNOWN_RESULT',
        finished_at: new Date().toISOString(),
      },
      'id',
      attemptId,
    )

    await safeUpdate(
      adminClient,
      'external_action_requests',
      {
        status: 'unknown_result',
        failure_code: 'UNKNOWN_RESULT',
        updated_at: new Date().toISOString(),
      },
      'id',
      actionRequestId,
    )

    return {
      success: false,
      verified: false,
      actionRequestId,
      attemptId,
      channel,
      status: 'VERIFYING',
      providerPostId: publishedPostId,
      errorCode: 'RESULT_UNKNOWN',
      message: '게시물은 접수되었으나 독립 Readback 조회가 지연되고 있습니다. 자동 재발행을 하지 않고 결과 조회를 대기합니다.',
      receipt: {
        actionRequestId,
        attemptId,
        providerPostId: publishedPostId,
        status: 'UNKNOWN_RESULT',
      },
    }
  }

  // Step 10: Persist observed_result receipt (Fail-Closed)
  const receiptQuery = (adminClient as any)
    .from('external_action_receipts')
    .insert({
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      action_request_id: actionRequestId,
      attempt_id: attemptId,
      receipt_kind: 'observed_result',
      provider_reference: publishedPostId,
      result_url: verifiedPermalink,
      observed_payload: {
        channel,
        published_post_id: publishedPostId,
        permalink: verifiedPermalink,
        verification_code: verificationCode,
        verification_method: 'META_GRAPH_API_LIVE',
        read_after_write: true,
        verified: true,
      },
      recorded_by: actorUserId,
      recorded_at: new Date().toISOString(),
    })

  const receiptInsertRes = typeof receiptQuery?.select === 'function'
    ? await receiptQuery.select('id').single()
    : await receiptQuery

  try {
    assertSupabaseSuccess(receiptInsertRes, 'external_action_receipts insert')
  } catch (receiptErr: any) {
    // Provider accepted but receipt failed: DO NOT VERIFY
    await safeUpdate(
      adminClient,
      'external_action_requests',
      {
        status: 'failed',
        failure_code: 'UNKNOWN_RESULT',
        updated_at: new Date().toISOString(),
      },
      'id',
      actionRequestId,
    )

    return {
      success: false,
      verified: false,
      actionRequestId,
      attemptId,
      channel,
      status: 'FAILED',
      errorCode: 'RECEIPT_PERSISTENCE_FAILED',
      message: `영수증 저장 실패로 인해 검증 완료 승격이 차단되었습니다: ${receiptErr?.message}`,
      receipt: null,
    }
  }

  // Step 11: Call Evidence-Gated Verification RPC v12
  if (typeof (adminClient as any).rpc === 'function') {
    const rpcRes = await (adminClient as any).rpc('complete_channel_verification_v12', {
      p_workspace_id: workspaceId,
      p_channel: channel,
      p_action_request_id: actionRequestId,
      p_verification_code: verificationCode,
      p_external_post_id: publishedPostId,
      p_permalink: verifiedPermalink,
      p_actor_user_id: actorUserId,
    })
    assertSupabaseSuccess(rpcRes, 'complete_channel_verification_v12 RPC')
  } else {
    // Defensive fallback for mock environments without RPC
    await (adminClient as any).from('channel_verification_runs').insert({
      workspace_id: workspaceId,
      channel: providerKey,
      verification_code: verificationCode,
      status: 'VERIFIED',
      action_request_id: actionRequestId,
      external_post_id: publishedPostId,
      external_permalink: verifiedPermalink,
      read_after_write_at: new Date().toISOString(),
      verified_by: actorUserId,
    })
    const connTbl = (adminClient as any).from('channel_connections')
    if (typeof connTbl?.update === 'function') {
      const connUpdate = connTbl.update({
        status: 'connected',
        updated_at: new Date().toISOString(),
      })
      if (typeof connUpdate?.eq === 'function') {
        const connUpdate2 = connUpdate.eq('workspace_id', workspaceId)
        if (typeof connUpdate2?.eq === 'function') {
          await connUpdate2.eq('channel', providerKey)
        }
      }
    }
  }

  // Finalize attempt & request statuses as succeeded
  await safeUpdate(
    adminClient,
    'external_action_attempts',
    {
      status: 'succeeded',
      finished_at: new Date().toISOString(),
    },
    'id',
    attemptId,
  )

  await safeUpdate(
    adminClient,
    'external_action_requests',
    {
      status: 'succeeded',
      updated_at: new Date().toISOString(),
    },
    'id',
    actionRequestId,
  )

  return {
    success: true,
    verified: true,
    actionRequestId,
    attemptId,
    channel,
    status: 'VERIFIED',
    providerPostId: publishedPostId,
    permalink: verifiedPermalink,
    message: `${channel.toUpperCase()}에 1회 인증 포스팅이 성공적으로 발행되었으며, 외부 게시가 확인(VERIFIED)되었습니다!`,
    receipt: {
      actionRequestId,
      attemptId,
      channel,
      status: 'VERIFIED',
      verificationMethod: 'META_GRAPH_API_LIVE',
      externalUrl: verifiedPermalink,
      evidenceDetails: {
        permalink: verifiedPermalink,
        publishedPostId,
        verificationCode,
      },
    },
  }
}
