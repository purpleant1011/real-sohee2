export const VAULT_FUNNEL_EVENTS = [
  'preview_opened',
  'vault_saved',
  'vault_edited',
  'reapproved',
  'release_requested',
  'publish_verified',
] as const

export type VaultFunnelEventName = (typeof VAULT_FUNNEL_EVENTS)[number]

export const VAULT_FUNNEL_CHANNELS = [
  'instagram',
  'threads',
  'naver_blog',
  'daangn_business',
] as const

export type VaultFunnelChannel = (typeof VAULT_FUNNEL_CHANNELS)[number]

export const VAULT_STAGE_LABELS: Record<VaultFunnelEventName, string> = {
  preview_opened: '미리보기 열림',
  vault_saved: '보관 완료',
  vault_edited: '보관 내용 수정 (승인 무효)',
  reapproved: '재승인 완료',
  release_requested: '발행 요청',
  publish_verified: '게시 확인',
}

/**
 * Payload fields permitted in vault funnel events.
 * Strictly metadata, identifiers, and hashes only.
 * NEVER raw content, text bodies, or titles (privacy safe).
 */
export interface VaultFunnelPayload {
  channel?: VaultFunnelChannel
  contentId?: string
  versionId?: string
  vaultItemId?: string
  targetDate?: string | null
  fingerprint?: string
  previousFingerprint?: string
  reason?: string
  idempotencyKey?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface VaultFunnelEventInput {
  workspaceId: string
  userId: string | null
  event: VaultFunnelEventName
  channel: VaultFunnelChannel
  properties?: VaultFunnelPayload
  dedupeKey?: string
}

export interface RawFunnelEventRow {
  id: string
  workspace_id: string
  user_id: string | null
  event: string
  occurred_at: string
  properties: Record<string, unknown>
  dedupe_key: string | null
}

export type StageMetricStatus = 'VERIFIED' | 'NOT_VERIFIED' | 'EMPTY'

export interface VaultFunnelStageMetric {
  event: VaultFunnelEventName
  label: string
  count: number
  previousStageCount: number
  conversionRate: number | null // null when previousStageCount is 0, never a fake 0.0 or 100.0%
  status: StageMetricStatus
}

export type ReadModelStatus = 'OK' | 'EMPTY' | 'ERROR' | 'UNKNOWN'

export interface VaultFunnelReadModel {
  status: ReadModelStatus
  workspaceId: string
  channel: VaultFunnelChannel | 'ALL'
  period: { from: string; to: string }
  totalEvents: number
  stages: VaultFunnelStageMetric[]
  overallConversionRate: number | null
  error?: string
}
