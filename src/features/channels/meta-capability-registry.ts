import 'server-only'

export type CapabilityState =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'AUTHORIZED'
  | 'LISTENING'
  | 'EXECUTABLE'
  | 'PROVEN'
  | 'AUTONOMOUS'

export type ProofStatus = 'NO_PROOF' | 'NOT_VERIFIED' | 'PROVEN'

export interface CapabilityDefinition {
  id: string
  channel: 'instagram' | 'threads'
  name: string
  metaPermission: string
  requiredScope: string
  webhookField?: string
  consentScope: string
  runtimeTool: string
  actionKind: string
  providerReadback: boolean
}

export interface CapabilityEvaluationContext {
  hasConnection: boolean
  connectionStatus?: string
  tokenScopes: string[]
  hasWebhookSubscription: boolean
  hasConsent: boolean
  hasAutonomousConsent: boolean
  hasRuntimeTool: boolean
  isKillSwitchBlocked: boolean
  accessGateAllowed: boolean
  proofCount: number
  lastReceiptAt?: string | null
}

export interface CapabilityEvaluationResult {
  capabilityId: string
  channel: 'instagram' | 'threads'
  state: CapabilityState
  proofStatus: ProofStatus
  isExecutable: boolean
  isProven: boolean
  isAutonomous: boolean
  failureCode?: string
  lastSuccessAt?: string | null
  evaluatedAt: string
}

export const CANONICAL_META_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: 'instagram_feed_publish',
    channel: 'instagram',
    name: 'Instagram 피드/릴스 발행',
    metaPermission: 'instagram_business_content_publish',
    requiredScope: 'instagram_business_content_publish',
    consentScope: 'publish',
    runtimeTool: 'publishPost',
    actionKind: 'INSTAGRAM_POST_PUBLISH',
    providerReadback: true,
  },
  {
    id: 'instagram_comment_reply',
    channel: 'instagram',
    name: 'Instagram 댓글 자동 답글',
    metaPermission: 'instagram_business_manage_comments',
    requiredScope: 'instagram_business_manage_comments',
    webhookField: 'comments',
    consentScope: 'reply_comments',
    runtimeTool: 'sendCommentReply',
    actionKind: 'INSTAGRAM_COMMENT_REPLY',
    providerReadback: true,
  },
  {
    id: 'instagram_dm_reply',
    channel: 'instagram',
    name: 'Instagram DM 응답',
    metaPermission: 'instagram_business_manage_messages',
    requiredScope: 'instagram_business_manage_messages',
    webhookField: 'messages',
    consentScope: 'reply_dm',
    runtimeTool: 'sendDirectMessage',
    actionKind: 'INSTAGRAM_DM_REPLY',
    providerReadback: true,
  },
  {
    id: 'instagram_insights',
    channel: 'instagram',
    name: 'Instagram 인사이트 수집',
    metaPermission: 'instagram_business_manage_insights',
    requiredScope: 'instagram_business_manage_insights',
    consentScope: 'insights',
    runtimeTool: 'collectInsights',
    actionKind: 'INSTAGRAM_INSIGHTS_READ',
    providerReadback: false,
  },
  {
    id: 'threads_post_publish',
    channel: 'threads',
    name: 'Threads 게시물 발행',
    metaPermission: 'threads_content_publish',
    requiredScope: 'threads_content_publish',
    consentScope: 'publish',
    runtimeTool: 'publishThread',
    actionKind: 'THREADS_POST_PUBLISH',
    providerReadback: true,
  },
  {
    id: 'threads_reply',
    channel: 'threads',
    name: 'Threads 멘션/답글 응답',
    metaPermission: 'threads_manage_replies',
    requiredScope: 'threads_manage_replies',
    webhookField: 'replies',
    consentScope: 'reply_comments',
    runtimeTool: 'replyThread',
    actionKind: 'THREADS_REPLY_PUBLISH',
    providerReadback: true,
  },
  {
    id: 'threads_mentions',
    channel: 'threads',
    name: 'Threads 멘션 모니터링',
    metaPermission: 'threads_manage_mentions',
    requiredScope: 'threads_manage_mentions',
    webhookField: 'mentions',
    consentScope: 'read_comments',
    runtimeTool: 'readMentions',
    actionKind: 'THREADS_MENTIONS_READ',
    providerReadback: false,
  },
  {
    id: 'threads_insights',
    channel: 'threads',
    name: 'Threads 인사이트 수집',
    metaPermission: 'threads_manage_insights',
    requiredScope: 'threads_manage_insights',
    consentScope: 'insights',
    runtimeTool: 'collectInsights',
    actionKind: 'THREADS_INSIGHTS_READ',
    providerReadback: false,
  },
] as const

/**
 * Evaluates state progression for a Meta capability (ANI-1009):
 * CONNECTED -> AUTHORIZED -> LISTENING -> EXECUTABLE -> PROVEN -> AUTONOMOUS
 */
export function evaluateCapabilityState(
  capability: CapabilityDefinition,
  context: CapabilityEvaluationContext,
): CapabilityEvaluationResult {
  const evaluatedAt = new Date().toISOString()
  const baseRes: Omit<CapabilityEvaluationResult, 'state' | 'proofStatus' | 'isExecutable' | 'isProven' | 'isAutonomous'> = {
    capabilityId: capability.id,
    channel: capability.channel,
    evaluatedAt,
    lastSuccessAt: context.lastReceiptAt || null,
  }

  // 1. Connection check
  if (!context.hasConnection || context.connectionStatus === 'disconnected') {
    return {
      ...baseRes,
      state: 'DISCONNECTED',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'CHANNEL_DISCONNECTED',
    }
  }

  // 2. Token Scope (Authorization) check
  const hasScope = context.tokenScopes.includes(capability.requiredScope)
  if (!hasScope) {
    const isScopeDrift = context.tokenScopes.length > 0
    return {
      ...baseRes,
      state: 'CONNECTED',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: isScopeDrift ? 'SCOPE_DRIFT' : 'META_PERMISSION_MISSING',
    }
  }

  // 3. Webhook Subscription check (if capability has a webhook field)
  if (capability.webhookField && !context.hasWebhookSubscription) {
    return {
      ...baseRes,
      state: 'AUTHORIZED',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'WEBHOOK_SUBSCRIPTION_MISSING',
    }
  }

  // 4. Executable criteria: Consent + Runtime Tool + Killswitch Clear + Access Gate
  if (!context.hasConsent) {
    return {
      ...baseRes,
      state: 'LISTENING',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'CONSENT_MISSING',
    }
  }

  if (!context.hasRuntimeTool) {
    return {
      ...baseRes,
      state: 'LISTENING',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'RUNTIME_TOOL_MISSING',
    }
  }

  if (context.isKillSwitchBlocked) {
    return {
      ...baseRes,
      state: 'LISTENING',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'KILL_SWITCH_ACTIVE',
    }
  }

  if (!context.accessGateAllowed) {
    return {
      ...baseRes,
      state: 'LISTENING',
      proofStatus: 'NO_PROOF',
      isExecutable: false,
      isProven: false,
      isAutonomous: false,
      failureCode: 'ACCESS_GATE_BLOCKED',
    }
  }

  // 5. Proof check
  const isProven = context.proofCount > 0
  const proofStatus: ProofStatus = isProven ? 'PROVEN' : 'NO_PROOF'

  if (!isProven) {
    return {
      ...baseRes,
      state: 'EXECUTABLE',
      proofStatus: 'NO_PROOF',
      isExecutable: true,
      isProven: false,
      isAutonomous: false,
    }
  }

  // 6. Autonomous check
  if (context.hasAutonomousConsent) {
    return {
      ...baseRes,
      state: 'AUTONOMOUS',
      proofStatus: 'PROVEN',
      isExecutable: true,
      isProven: true,
      isAutonomous: true,
    }
  }

  return {
    ...baseRes,
    state: 'PROVEN',
    proofStatus: 'PROVEN',
    isExecutable: true,
    isProven: true,
    isAutonomous: false,
  }
}
