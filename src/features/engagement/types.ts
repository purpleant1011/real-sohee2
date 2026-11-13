export type SocialChannel = 'instagram' | 'threads'

export type CommentClassification =
  | 'THANKS'
  | 'GREETING'
  | 'QUESTION'
  | 'COMPLAINT'
  | 'SENSITIVE'
  | 'SPAM'
  | 'NEEDS_HUMAN'

export type CommentStatus =
  | 'RECEIVED'
  | 'CLASSIFIED'
  | 'DRAFTED'
  | 'APPROVED'
  | 'SENDING'
  | 'SENT'
  | 'DISMISSED'
  | 'NEEDS_CHECK'
  | 'FAILED'

export interface SocialComment {
  id: string
  workspace_id: string
  channel_connection_id: string
  channel: SocialChannel
  provider_comment_id: string
  provider_media_id: string
  author_handle: string
  author_id?: string | null
  comment_text: string
  comment_created_at: string
  classification: CommentClassification | null
  confidence: number | null
  status: CommentStatus
  failure_reason?: string | null
  created_at: string
  updated_at: string
}

export interface EngagementCommentItem extends SocialComment {
  channel_label: string
  account_label?: string | null
  status_label: string
  classification_label: string | null
  draft: CommentReplyDraft | null
}

export interface EngagementCommentsResponse {
  items: EngagementCommentItem[]
  nextCursor?: string
  send_enabled: boolean
  cycle_enabled: boolean
  auto_replied_today_count?: number
}

export interface CommentReplyDraft {
  id: string
  workspace_id: string
  comment_id: string
  draft_text: string
  approved_fingerprint: string | null
  approved_by: string | null
  approved_at: string | null
  is_auto_approved: boolean
  created_at: string
  updated_at: string
}

export type AutonomyLevel = 'L1_MANUAL' | 'L2_ASSISTED' | 'L3_AUTONOMOUS'

export interface EngagementPolicy {
  id: string
  workspace_id: string
  channel: SocialChannel
  auto_reply_enabled: boolean
  is_paused: boolean
  allowed_classes: CommentClassification[]
  min_confidence: number
  daily_cap: number
  quiet_hours_enabled: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  max_comment_age_days: number
  autonomy_level?: AutonomyLevel
  default_tone?: 'witty' | 'polite' | 'friendly'
  auto_post_enabled?: boolean
  auto_post_frequency_per_week?: number
  created_at: string
  updated_at: string
}

export interface EngagementAudit {
  id: string
  workspace_id: string
  comment_id: string | null
  channel: SocialChannel
  actor: 'system' | 'owner' | 'manager'
  actor_user_id: string | null
  action: 'auto_reply' | 'manual_send' | 'dismiss' | 'regenerate_draft' | 'edit_draft' | 'policy_update'
  policy_snapshot: Record<string, unknown> | null
  provider_reply_id: string | null
  readback_verified: boolean
  details: Record<string, unknown>
  created_at: string
}

export interface ClassifyCommentResult {
  classification: CommentClassification
  confidence: number
  reasoning?: string
}

export interface DraftReplyResult {
  draftText: string
  isFallback: boolean
  fingerprint: string
}

export interface DecideAutoReplyParams {
  policy: EngagementPolicy
  comment: SocialComment
  sentCountToday: number
  now?: Date
  connectedAccountHandle?: string
  connectedAccountId?: string
}

export interface AutoReplyDecision {
  shouldAutoReply: boolean
  reason: string
}

export interface SendReplyResult {
  sent: boolean
  providerReplyId?: string
  status: CommentStatus
  reason?: string
}
