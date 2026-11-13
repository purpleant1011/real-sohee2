import 'server-only'

export type WebhookHealthStatus = 'LISTENING' | 'PENDING' | 'DEGRADED' | 'ERROR'

export interface SubscriptionHealthContext {
  channel: 'instagram' | 'threads'
  connectionStatus: string
  subscribedFields: readonly string[]
  lastWebhookAt: string | null
  lastProviderEventAt: string | null
  recentErrorCount: number
}

export interface SubscriptionHealthResult {
  channel: 'instagram' | 'threads'
  status: WebhookHealthStatus
  isListening: boolean
  lagSeconds: number | null
  subscribedFields: readonly string[]
  reason: string
  evaluatedAt: string
}

export function evaluateSubscriptionHealth(
  context: SubscriptionHealthContext,
  referenceNowMs: number = Date.now(),
): SubscriptionHealthResult {
  const evaluatedAt = new Date(referenceNowMs).toISOString()
  const { channel, subscribedFields, lastWebhookAt, recentErrorCount } = context

  if (context.connectionStatus !== 'connected') {
    return {
      channel,
      status: 'PENDING',
      isListening: false,
      lagSeconds: null,
      subscribedFields,
      reason: '채널 계정이 연결되지 않았습니다.',
      evaluatedAt,
    }
  }

  if (recentErrorCount >= 3) {
    return {
      channel,
      status: 'ERROR',
      isListening: false,
      lagSeconds: null,
      subscribedFields,
      reason: `최근 웹훅 수신/처리 오류가 ${recentErrorCount}회 발생했습니다.`,
      evaluatedAt,
    }
  }

  if (!lastWebhookAt) {
    return {
      channel,
      status: 'PENDING',
      isListening: false,
      lagSeconds: null,
      subscribedFields,
      reason: '연결은 확인되었으나 실제 Provider 웹훅 이벤트가 아직 수신되지 않았습니다.',
      evaluatedAt,
    }
  }

  const lastWebhookMs = new Date(lastWebhookAt).getTime()
  const lagSeconds = Math.max(0, Math.floor((referenceNowMs - lastWebhookMs) / 1000))

  // Stale threshold: 24 hours (86,400 seconds)
  if (lagSeconds > 86400) {
    return {
      channel,
      status: 'DEGRADED',
      isListening: false,
      lagSeconds,
      subscribedFields,
      reason: `최근 웹훅 수신이 지연/중단되었습니다 (마지막 수신: ${Math.floor(lagSeconds / 3600)}시간 전).`,
      evaluatedAt,
    }
  }

  return {
    channel,
    status: 'LISTENING',
    isListening: true,
    lagSeconds,
    subscribedFields,
    reason: '웹훅이 정상 구독되어 이벤트를 실시간 수신 중(LISTENING)입니다.',
    evaluatedAt,
  }
}

export type WebhookHealthState = 'NOT_CONFIGURED' | 'PENDING' | 'HEALTHY' | 'STALE' | 'DEGRADED' | 'FAILED'

export interface SubscriptionHealthDbParams {
  channel: 'instagram' | 'threads'
  connectionStatus: string
  lastWebhookAt: string | null
  providerEventCount: number
  recentErrorCount: number
  referenceNowMs?: number
}

export interface SubscriptionHealthDbResult {
  channel: 'instagram' | 'threads'
  status: WebhookHealthState
  isListening: boolean
  lagSeconds: number | null
  providerEventCount: number
  recentErrorCount: number
  reason: string
  evaluatedAt: string
}

export function evaluateSubscriptionHealthWithDb(
  params: SubscriptionHealthDbParams,
): SubscriptionHealthDbResult {
  const referenceNowMs = params.referenceNowMs ?? Date.now()
  const evaluatedAt = new Date(referenceNowMs).toISOString()
  const { channel, connectionStatus, lastWebhookAt, providerEventCount, recentErrorCount } = params

  if (connectionStatus !== 'connected') {
    return {
      channel,
      status: 'NOT_CONFIGURED',
      isListening: false,
      lagSeconds: null,
      providerEventCount,
      recentErrorCount,
      reason: `${channel.toUpperCase()} 채널 계정이 연결되지 않았습니다.`,
      evaluatedAt,
    }
  }

  // False-Green 원천 차단: providerEventCount가 0이거나 lastWebhookAt이 없으면 무조건 PENDING
  if (providerEventCount === 0 || !lastWebhookAt) {
    return {
      channel,
      status: 'PENDING',
      isListening: false,
      lagSeconds: null,
      providerEventCount,
      recentErrorCount,
      reason: '실제 공급자 서명 웹훅 이벤트가 아직 수신되지 않았습니다 (수신 대기 중).',
      evaluatedAt,
    }
  }

  if (recentErrorCount >= 3) {
    return {
      channel,
      status: 'FAILED',
      isListening: false,
      lagSeconds: null,
      providerEventCount,
      recentErrorCount,
      reason: `최근 웹훅 수신/처리 오류가 임계치를 초과했습니다 (${recentErrorCount}회 발생).`,
      evaluatedAt,
    }
  }

  const lastWebhookMs = new Date(lastWebhookAt).getTime()
  const lagSeconds = Math.max(0, Math.floor((referenceNowMs - lastWebhookMs) / 1000))

  // Stale threshold: 24 hours (86,400 seconds)
  if (lagSeconds > 86400) {
    return {
      channel,
      status: 'STALE',
      isListening: false,
      lagSeconds,
      providerEventCount,
      recentErrorCount,
      reason: `최근 웹훅 수신이 지연/중단되었습니다 (마지막 수신: ${Math.floor(lagSeconds / 3600)}시간 전).`,
      evaluatedAt,
    }
  }

  return {
    channel,
    status: 'HEALTHY',
    isListening: true,
    lagSeconds,
    providerEventCount,
    recentErrorCount,
    reason: '공급자 서명 웹훅 이벤트가 정상 수신 및 구독 중(HEALTHY)입니다.',
    evaluatedAt,
  }
}

