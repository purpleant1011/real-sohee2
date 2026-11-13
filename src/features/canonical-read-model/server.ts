import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { normalizeChannelScopes } from '@/features/channels/dual-channel-verification'
import { getMetaRequiredScopes, type MetaCredentialCapability } from '@/features/channels/oauth/meta-oauth'
import { evaluateMetaAccessMode } from '@/features/channels/meta-access-gate'
import { isCapabilityKilled, isEngagementRolloutEnabled } from '@/features/capabilities/registry'
import { isMetaLiveAllowed } from '@/lib/safety/meta-live-allowlist'
import {
  CANONICAL_META_CAPABILITIES,
  evaluateCapabilityState,
} from '@/features/channels/meta-capability-registry'
import {
  createRenderFact,
  type WorkspaceCanonicalReadModel,
  type CanonicalChannelSummary,
  type CanonicalCapabilitySummary,
  type CanonicalEmployeeWorkItem,
} from './types'

export async function getWorkspaceCanonicalReadModel(
  workspaceId: string,
  providedClient?: any,
): Promise<WorkspaceCanonicalReadModel> {
  const client = providedClient ?? createAdminSupabaseClient()
  const nowIso = new Date().toISOString()

  // 1. Business Profile
  const { data: profile } = await client
    .from('business_profiles')
    .select('business_name, industry, summary, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const businessName = profile?.business_name
    ? createRenderFact(profile.business_name, 'AVAILABLE', {
        sourceId: 'business_profiles',
        observedAt: profile.updated_at,
        freshness: 'FRESH',
      })
    : createRenderFact('', 'UNKNOWN', { freshness: null })

  const industry = profile?.industry
    ? createRenderFact(profile.industry, 'AVAILABLE', {
        sourceId: 'business_profiles',
        observedAt: profile.updated_at,
        freshness: 'FRESH',
      })
    : createRenderFact('', 'UNKNOWN', { freshness: null })

  const summary = profile?.summary
    ? createRenderFact(profile.summary, 'AVAILABLE', {
        sourceId: 'business_profiles',
        observedAt: profile.updated_at,
        freshness: 'FRESH',
      })
    : createRenderFact('', 'UNKNOWN', { freshness: null })

  // 2. Credits (Sohee Credits SSOT: workspace_credit_states)
  let creditsAvailable = createRenderFact(0, 'NO_PROOF', { freshness: null })
  try {
    const { data: creditState, error: creditErr } = await client
      .from('workspace_credit_states')
      .select('total_available_credits, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!creditErr && creditState) {
      creditsAvailable = createRenderFact(creditState.total_available_credits ?? 0, 'AVAILABLE', {
        sourceId: 'workspace_credit_states',
        observedAt: creditState.updated_at,
        freshness: 'FRESH',
      })
    }
  } catch {
    // Non-blocking fallback preserves screen stability on read failure
    creditsAvailable = createRenderFact(0, 'NO_PROOF', { freshness: null })
  }

  // 3. Channels
  const { data: connections, error: connectionError } = await client
    .from('channel_connections')
    .select('id, channel, status, external_account_id, account_label, webhook_status, updated_at')
    .eq('workspace_id', workspaceId)

  const { data: credentials, error: credentialError } = await client
    .from('meta_channel_credentials')
    .select('channel_connection_id, provider, status, token_expires_at, granted_scopes')
    .eq('workspace_id', workspaceId)
  if (connectionError || credentialError) throw new Error('채널 권한 정보를 확인하지 못했습니다.')

  const channels: CanonicalChannelSummary[] = (connections || []).map((conn: any) => ({
    channel: conn.channel,
    connectionStatus: conn.status,
    externalAccountId: conn.external_account_id,
    accountLabel: conn.account_label,
    isAuthorized: conn.status === 'connected' || conn.status === 'authorized',
    isListening: conn.webhook_status === 'active' || conn.webhook_status === 'listening' || conn.webhook_status === 'healthy',
    lastVerifiedAt: conn.updated_at,
  }))

  // 4. Consents & Capabilities
  const { data: consents, error: consentError } = await client
    .from('channel_consents')
    .select('channel, consent_tier, status, capabilities')
    .eq('workspace_id', workspaceId)

  const { data: receipts, error: receiptError } = await client
    .from('external_action_receipts')
    .select('id, action_request_id, receipt_kind, provider_reference, observed_payload, recorded_at')
    .eq('workspace_id', workspaceId)
    .order('recorded_at', { ascending: false })

  const { data: requests, error: requestError } = await client
    .from('external_action_requests')
    .select('id, channel, action_kind, status, target_external_id')
    .eq('workspace_id', workspaceId)
  if (consentError || receiptError || requestError) throw new Error('채널 실행 근거를 확인하지 못했습니다.')

  const verifiedReceipts = (receipts || []).filter((receipt: any) =>
    receipt.receipt_kind === 'observed_result'
    && !!receipt.provider_reference
    && receipt.observed_payload?.readbackVerified === true)
  const proofCount = verifiedReceipts.length
  const runtimeCapabilities: Record<string, MetaCredentialCapability> = {
    instagram_feed_publish: 'publish',
    instagram_comment_reply: 'comment_reply',
    instagram_dm_reply: 'message',
    threads_post_publish: 'publish',
    threads_reply: 'reply',
  }

  const capabilities: CanonicalCapabilitySummary[] = CANONICAL_META_CAPABILITIES.map((cap) => {
    const conn = (connections || []).find((c: any) => c.channel === cap.channel)
    const hasConnection = !!conn && ['connected', 'authorized'].includes(conn.status)
    const credential = (credentials || []).find((row: any) =>
      row.channel_connection_id === conn?.id && row.provider === cap.channel && row.status === 'active')
    const expiry = credential?.token_expires_at == null ? Infinity : Date.parse(credential.token_expires_at)
    const grantedScopes = credential && expiry > Date.now() + 5 * 60_000 && Array.isArray(credential.granted_scopes)
      ? normalizeChannelScopes(cap.channel, credential.granted_scopes) : []
    const runtimeCapability = runtimeCapabilities[cap.id]
    const requiredScopes = runtimeCapability ? getMetaRequiredScopes(cap.channel, runtimeCapability) : [cap.requiredScope]
    const tokenScopes = requiredScopes.every(scope => grantedScopes.includes(scope)) ? grantedScopes : []
    const actionKind = cap.id === 'instagram_comment_reply' || cap.id === 'threads_reply'
      ? 'comment_reply' : cap.id === 'instagram_dm_reply' ? 'dm_reply' : cap.actionKind
    const proofs = verifiedReceipts.filter((receipt: any) => (requests || []).some((request: any) =>
      request.id === receipt.action_request_id && request.channel === cap.channel
      && request.status === 'succeeded' && [cap.actionKind, actionKind].includes(request.action_kind)
      && request.target_external_id === conn?.external_account_id))
    const access = evaluateMetaAccessMode({ channel: cap.channel, connectionStatus: hasConnection ? 'connected' : 'disconnected' })
    const rolloutAllowed = cap.consentScope === 'publish' ? isMetaLiveAllowed(workspaceId)
      : isEngagementRolloutEnabled('ENGAGEMENT_SEND_ENABLED', workspaceId)

    const activeConsent = (consents || []).find(
      (cs: any) => cs.channel === cap.channel && cs.status === 'ACTIVE'
    )
    const capsObj = (activeConsent?.capabilities as Record<string, boolean>) || {}
    const hasConsent = capsObj[cap.consentScope] === true

    const evalResult = evaluateCapabilityState(cap, {
      hasConnection,
      connectionStatus: conn?.status,
      tokenScopes,
      hasWebhookSubscription: ['active', 'listening', 'healthy'].includes(conn?.webhook_status),
      hasConsent,
      hasAutonomousConsent: activeConsent?.consent_tier === 'AUTONOMOUS_DELEGATION' && hasConsent,
      hasRuntimeTool: !!runtimeCapability,
      isKillSwitchBlocked: isCapabilityKilled(),
      accessGateAllowed: access.allowPublicCustomerDelegation && rolloutAllowed,
      proofCount: proofs.length,
      lastReceiptAt: proofs[0]?.recorded_at ?? null,
    })

    return {
      id: cap.id,
      channel: cap.channel,
      name: cap.name,
      state: evalResult.state,
      proofStatus: evalResult.proofStatus,
      isExecutable: evalResult.isExecutable,
      isProven: evalResult.isProven,
      isAutonomous: evalResult.isAutonomous,
      failureCode: evalResult.failureCode || null,
    }
  })

  // 5. Metrics (from channel_metric_collections)
  const { data: latestMetrics } = await client
    .from('channel_metric_collections')
    .select('id, collected_at, status')
    .eq('workspace_id', workspaceId)
    .order('collected_at', { ascending: false })
    .limit(1)

  const latestCollection = latestMetrics?.[0]
  let viewsFact = createRenderFact<number | null>(null, 'NO_PROOF')
  let likesFact = createRenderFact<number | null>(null, 'NO_PROOF')
  let commentsFact = createRenderFact<number | null>(null, 'NO_PROOF')

  if (latestCollection && latestCollection.status === 'succeeded') {
    const { data: valRows } = await client
      .from('channel_metric_values')
      .select('metric, value, state')
      .eq('collection_id', latestCollection.id)

    const valMap = new Map((valRows || []).map((r: any) => [r.metric, r]))
    const viewsRow = valMap.get('views') as any
    const likesRow = valMap.get('likes') as any
    const commentsRow = valMap.get('comments') as any

    if (viewsRow?.state === 'available') {
      viewsFact = createRenderFact(Number(viewsRow.value), 'AVAILABLE', {
        sourceId: latestCollection.id,
        observedAt: latestCollection.collected_at,
        freshness: 'FRESH',
      })
    }
    if (likesRow?.state === 'available') {
      likesFact = createRenderFact(Number(likesRow.value), 'AVAILABLE', {
        sourceId: latestCollection.id,
        observedAt: latestCollection.collected_at,
        freshness: 'FRESH',
      })
    }
    if (commentsRow?.state === 'available') {
      commentsFact = createRenderFact(Number(commentsRow.value), 'AVAILABLE', {
        sourceId: latestCollection.id,
        observedAt: latestCollection.collected_at,
        freshness: 'FRESH',
      })
    }
  }

  // 6. Inbox (channel_response_jobs)
  const { data: responseJobs } = await client
    .from('channel_response_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(20)

  const inbox: CanonicalEmployeeWorkItem[] = (responseJobs || []).map((job: any) => {
    let status: CanonicalEmployeeWorkItem['status'] = 'needs_action'
    if (job.status === 'draft') status = 'approval_required'
    if (job.status === 'sent') status = 'completed'
    if (job.status === 'failed') status = 'failed'

    let category: CanonicalEmployeeWorkItem['category'] = 'comment'
    if (job.response_kind === 'instagram_dm') category = 'dm'
    if (job.response_kind === 'threads_reply') category = 'reply'

    return {
      id: job.id,
      category,
      title: `${category.toUpperCase()} 자동 응답 업무`,
      summary: job.draft_text || '응답 초안 생성 대기 중',
      status,
      externalTargetId: job.external_target_id,
      occurredAt: job.created_at,
      completedAt: job.status === 'sent' ? job.updated_at : null,
    }
  })

  return {
    workspaceId,
    datasetMode: 'ACTUAL',
    businessName,
    industry,
    summary,
    creditsAvailable,
    channels,
    capabilities,
    metrics: {
      views: viewsFact,
      likes: likesFact,
      comments: commentsFact,
    },
    recentActionsCount: proofCount,
    inbox,
    generatedAt: nowIso,
  }
}
