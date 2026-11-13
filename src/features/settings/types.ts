import type { WorkspaceRole } from '@/features/auth/workspace-context'

export const channelNames = ['instagram', 'threads', 'naver_blog', 'naver_place'] as const
export const channelStatuses = [
  'disconnected', 'connecting', 'connected', 'expired', 'missing_permission',
  'wrong_account', 'provider_error', 'error',
] as const
export const webhookStatuses = ['pending', 'healthy', 'stale', 'error'] as const
export const memberStatuses = ['active', 'invited', 'disabled'] as const

export type ChannelName = (typeof channelNames)[number]
export type ChannelStatus = (typeof channelStatuses)[number]
export type WebhookStatus = (typeof webhookStatuses)[number]
export type MemberStatus = (typeof memberStatuses)[number]

export type BusinessSettings = Readonly<{
  businessName: string
  industry: string
  location: string
  summary: string
}>

export type BrandSettings = Readonly<{
  voice: string
  keywords: readonly string[]
  prohibitedTerms: readonly string[]
}>

export type ChannelSetting = Readonly<{
  channel: ChannelName
  status: ChannelStatus
  accountLabel: string | null
  tokenExpiresAt: string | null
  webhookStatus: WebhookStatus
  lastWebhookAt: string | null
  lastErrorCode: string | null
}>

export type MemberSetting = Readonly<{
  memberId: string
  label: string
  role: WorkspaceRole
  status: MemberStatus
  current: boolean
}>

export type OperationalSettings = Readonly<{
  business: BusinessSettings
  brand: BrandSettings
  channels: readonly ChannelSetting[]
  members: readonly MemberSetting[]
  permissions: Readonly<{
    canEditProfiles: boolean
    canEditMembers: boolean
  }>
}>

export type SettingsLoadResult =
  | { data: OperationalSettings; error?: never }
  | { data?: never; error: { message: string } }

export type SettingsActionResult =
  | { ok: true; message: string }
  | {
      ok: false
      code: 'INVALID_INPUT' | 'FORBIDDEN' | 'UNAVAILABLE'
      message: string
      fieldErrors?: Record<string, string[]>
    }
