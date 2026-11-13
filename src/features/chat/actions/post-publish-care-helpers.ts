import { z } from 'zod'

export const postPublishCareChannels = ['instagram', 'threads'] as const
export type PostPublishCareChannel = (typeof postPublishCareChannels)[number]

export const postPublishCareWritableKeys = ['comment_watch', 'reaction_report'] as const
export type PostPublishCareWritableKey = (typeof postPublishCareWritableKeys)[number]

export const loadPostPublishCareInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    channel: z.enum(postPublishCareChannels),
  })
  .strict()

export type LoadPostPublishCareInput = z.infer<typeof loadPostPublishCareInputSchema>

export const updatePostPublishCareInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    channel: z.enum(postPublishCareChannels),
    key: z.enum(postPublishCareWritableKeys),
    enabled: z.boolean(),
  })
  .strict()

export type UpdatePostPublishCareInput = z.infer<typeof updatePostPublishCareInputSchema>

export type PostPublishCareSetting = Readonly<{
  enabled: boolean
  available: boolean
  reason: string | null
}>

export type PostPublishCareReactionReport = Readonly<{
  enabled: boolean
  available: boolean
  reason: string | null
  needsSetup: boolean
}>

export type PostPublishCareAlwaysOnItem = Readonly<{
  active: boolean
  reason: string | null
}>

export type PostPublishCareAlwaysOn = Readonly<{
  dm: PostPublishCareAlwaysOnItem
  booking_inquiry: PostPublishCareAlwaysOnItem
}>

export type PostPublishCareState = Readonly<{
  workspaceId: string
  channel: PostPublishCareChannel
  comment_watch: PostPublishCareSetting
  reaction_report: PostPublishCareReactionReport
  always_on: PostPublishCareAlwaysOn
}>

export type PostPublishCareErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid_input'
  | 'unsupported'
  | 'needs_setup'
  | 'internal_error'

export type PostPublishCareResult =
  | { ok: true; state: PostPublishCareState }
  | { ok: false; code: PostPublishCareErrorCode }

export type RawEngagementPolicyRow = Readonly<{
  is_paused?: boolean | null
  auto_reply_enabled?: boolean | null
  autonomy_level?: string | null
}>

export type RawAutomationRuleRow = Readonly<{
  kind: string
  active: boolean
}>

export type RawCredentialRow = Readonly<{
  status?: string | null
  granted_scopes?: readonly string[] | string | null
}>

export function parseScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((s): s is string => typeof s === 'string')
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
    } catch {
      return raw.split(',').map((s) => s.trim())
    }
  }
  return []
}

export function deriveAlwaysOnState(params: {
  channel: PostPublishCareChannel
  credential: RawCredentialRow | null
}): PostPublishCareAlwaysOn {
  const { channel, credential } = params

  if (channel === 'threads') {
    const isThreadsActive = credential?.status === 'active'
    const scopes = parseScopes(credential?.granted_scopes)
    const hasRepliesScope = scopes.includes('threads_read_replies') || scopes.includes('threads_basic')
    const bookingActive = isThreadsActive && hasRepliesScope
    const bookingReason = !isThreadsActive
      ? '스레드 계정이 연동되어 있지 않아요'
      : !hasRepliesScope
        ? '스레드 답글 수신 권한(threads_read_replies)이 연동되어 있지 않아요'
        : null

    return Object.freeze({
      dm: Object.freeze({
        active: false,
        reason: '스레드는 DM 기능을 지원하지 않아요',
      }),
      booking_inquiry: Object.freeze({
        active: bookingActive,
        reason: bookingReason,
      }),
    })
  }

  // Instagram
  const isIgActive = credential?.status === 'active'
  const scopes = parseScopes(credential?.granted_scopes)
  const hasMessagesScope = scopes.includes('instagram_business_manage_messages')
  const hasCommentsScope = scopes.includes('instagram_business_manage_comments')

  const dmActive = isIgActive && hasMessagesScope
  const dmReason = !isIgActive
    ? '인스타그램 계정이 연동되어 있지 않아요'
    : !hasMessagesScope
      ? '인스타그램 DM 관리 권한(instagram_business_manage_messages)이 연동되어 있지 않아요'
      : null

  const bookingActive = isIgActive && (hasCommentsScope || hasMessagesScope)
  const bookingReason = !isIgActive
    ? '인스타그램 계정이 연동되어 있지 않아요'
    : !(hasCommentsScope || hasMessagesScope)
      ? '댓글 또는 DM 수신 권한이 연동되어 있지 않아요'
      : null

  return Object.freeze({
    dm: Object.freeze({
      active: dmActive,
      reason: dmReason,
    }),
    booking_inquiry: Object.freeze({
      active: bookingActive,
      reason: bookingReason,
    }),
  })
}

export function mapPostPublishCareState(params: {
  workspaceId: string
  channel: PostPublishCareChannel
  policy: RawEngagementPolicyRow | null
  rules: readonly RawAutomationRuleRow[] | null
  credential: RawCredentialRow | null
}): PostPublishCareState {
  const { workspaceId, channel, policy, rules, credential } = params

  const commentEnabled = policy ? !policy.is_paused : false

  const reportRule = rules?.find((rule) => rule.kind === 'daily_performance_report')
  const reportSetting: PostPublishCareReactionReport = reportRule
    ? Object.freeze({
        enabled: reportRule.active,
        available: true,
        reason: null,
        needsSetup: false,
      })
    : Object.freeze({
        enabled: false,
        available: false,
        reason: '자동화 설정(/app/account/automation)에서 성과 보고 규칙을 먼저 등록해 주세요',
        needsSetup: true,
      })

  const alwaysOn = deriveAlwaysOnState({ channel, credential })

  return Object.freeze({
    workspaceId,
    channel,
    comment_watch: Object.freeze({
      enabled: commentEnabled,
      available: true,
      reason: null,
    }),
    reaction_report: reportSetting,
    always_on: alwaysOn,
  })
}
