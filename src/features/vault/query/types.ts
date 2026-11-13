import type {
  VaultChannel,
  VaultItem,
} from '../types'

export type VaultPeriod = 'this_week' | 'next_week' | 'month' | 'unscheduled' | 'all'

export type VaultStatusFilter = 'held' | 'needs_reapproval' | 'invalidated' | 'on_hold'

export type VaultSortField = 'target_date' | 'held_at' | 'created_at'
export type VaultSortOrder = 'asc' | 'desc'

export interface VaultListQueryParams {
  period?: VaultPeriod
  ym?: string // YYYY-MM (used when period=month or as reference month)
  channel?: VaultChannel
  status?: VaultStatusFilter
  sort?: VaultSortField
  order?: VaultSortOrder
  cursor?: string
  limit?: number
  view?: 'user' | 'admin'
}

/**
 * User-facing DTO.
 * Excludes UUIDs, SHA fingerprints, and raw English status codes.
 * Contains user-friendly labels produced by the server.
 */
export interface VaultItemUserDto {
  /** Public reference or index key for UI rendering (never raw internal UUID) */
  item_ref: string
  /** Channel key for choosing UI behavior only; never rendered as text (use channel_label). */
  channel: VaultChannel
  /** Human-readable channel label: e.g. "인스타그램", "스레드" */
  channel_label: string
  /** Human-readable status label: e.g. "발행 준비 완료 · 외부 게시 전", "재확인 필요" */
  status_label: string
  /** Human-readable hold reason label: e.g. "Meta 앱 심사 대기", "채널 연결 필요" */
  hold_reason_label: string | null
  /** Planned publication date: YYYY-MM-DD or null if unscheduled */
  target_date: string | null
  /** Date when item was held */
  held_at: string | null
  /** Date when item was created */
  created_at: string
  /** Date when item was last updated */
  updated_at: string
}

/** Media facts a preview and its channel check need. Digests, storage paths and URLs are never included. */
export interface VaultItemDetailMediaDto {
  type: 'image' | 'video'
  mime_type: string | null
  size_bytes: number | null
}

/**
 * User-facing detail DTO for the preview and edit sheet (read-only).
 * `content` comes from the same reader the copy bundle uses, so the preview and the exported text cannot drift.
 * Booleans replace raw approval and release-gate codes; status wording stays in `status_label`.
 */
export interface VaultItemDetailDto extends VaultItemUserDto {
  content: { title: string | null; body: string; tags: string[] }
  media: VaultItemDetailMediaDto[]
  settings: { category: string | null; coupon: string | null }
  /** True while the approval is lifted (edited) or waiting for a recheck. */
  needs_reapproval: boolean
  /** True when the owner paused this item. */
  is_user_held: boolean
  /** True while the item is in the 30-day restore window. */
  is_deleted: boolean
  /** When the owner deleted it (restore window start), otherwise null. */
  deleted_at: string | null
}

/**
 * Admin-facing DTO.
 * Contains all raw database fields (UUIDs, fingerprints, raw enums)
 * plus user-friendly labels.
 */
export interface VaultItemAdminDto extends VaultItem {
  channelLabel: string
  statusLabel: string
  holdReasonLabel: string | null
}

export interface PaginatedResult<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  totalCount?: number
}

export interface VaultCalendarDaySummary {
  total: number
  channels: Partial<Record<VaultChannel, number>>
}

export interface VaultCalendarDto {
  ym: string
  days: Record<string, VaultCalendarDaySummary>
  unscheduled_count: number
}

export interface VaultSummaryDto {
  /** Shared server truth: missing means older clients; a failed lookup blocks release. */
  intervention?: { blocked: boolean; label: string | null; detail: string | null }
  /** 보관 N건 (approval_state = 'APPROVED') */
  stored_count: number
  /** 재확인 필요 M건 (approval_state = 'NEEDS_REAPPROVAL') */
  needs_reapproval_count: number
  /** 무효 건수 (approval_state = 'INVALIDATED') */
  invalidated_count: number
  /** 전체 활성 보관함 항목 건수 (deleted_at IS NULL) */
  total_count: number
  /** 보관 상태 항목에 연결된 external_actions(external_action_requests 등) 건수 (실제 COUNT) */
  external_action_count: number
  /** 0건이 아닐 때 경고 메시지, 0건이면 null */
  external_action_warning: string | null
  /** 이번 주(KST) 일정에 해당하는 보관함 항목 건수 */
  this_week_count?: number
}
