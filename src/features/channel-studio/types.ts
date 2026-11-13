/**
 * Shared contract for the knowledge-grounded four-channel studio (ANI-1538).
 * Every parallel work stream codes against these types; change them only in the integration branch.
 */
export const STUDIO_CHANNELS = ['instagram', 'threads', 'naver_blog', 'daangn_business'] as const
export type StudioChannel = (typeof STUDIO_CHANNELS)[number]

export const STUDIO_CHANNEL_LABELS: Record<StudioChannel, string> = {
  instagram: '인스타그램',
  threads: '스레드',
  naver_blog: '네이버 블로그',
  daangn_business: '당근 비즈프로필',
}

export type GroundedFactKind = 'profile' | 'identity' | 'offering' | 'policy' | 'audience'

/** One business fact the owner has stored or confirmed. Never contains file originals or ids. */
export interface GroundedFact {
  kind: GroundedFactKind
  label: string
  value: string
}

export interface GroundedBusinessContext {
  businessName: string
  industry: string
  location: string
  facts: GroundedFact[]
  tone: { presetKey: string | null; brandVoice: string }
  /** Active knowledge version number; shown to the owner as "지식 v3" style text only. */
  knowledgeVersion: number
  /** Owner-readable notes such as "가격 정보가 없어요". */
  warnings: string[]
  /** Workspace knowledge epoch at the time context was compiled. */
  epoch?: number
  /** Source references that this context depends on. */
  dependencies?: Array<{ workspaceId: string; sourceId: string; revision: number }>
}

/** READY: spec passes. NEEDS_FIX: a spec rule fails. NEEDS_CHECK: unverified claim or unknown spec item. */
export type VariantStatus = 'READY' | 'NEEDS_FIX' | 'NEEDS_CHECK'

export interface ChannelDraftVariant {
  channel: StudioChannel
  /** Channel payload as produced by the transform generator (caption/text/title/blocks/hashtags/...). */
  payload: Record<string, unknown>
  status: VariantStatus
  /** Korean owner-facing label, never an English status code. */
  statusLabel: string
  /** Korean owner-facing reasons for NEEDS_FIX / NEEDS_CHECK. */
  issues: string[]
  /** Set after the draft is materialised for the vault; null when saving is not possible. */
  contentId: string | null
  versionId: string | null
  vaultSavable: boolean
  blockedReason: string | null
}

export interface ChannelDraftEditSnapshot {
  draft: ChannelDraftResult
  knowledgeVersion: number
}

export interface ChannelDraftEditRequest {
  workspaceId: string
  userId: string
  requestKey: string
  channel: StudioChannel
  edits: { title?: string; text?: string; caption?: string; hashtags?: string[] }
}

export interface ChannelDraftResult {
  /** Opaque client request key (idempotency). */
  requestKey: string
  topic: string
  createdAt: string
  /** e.g. ["지식 v3 기준", "가격 정보가 없어서 가격·할인 문구는 넣지 않았어요"] */
  basisNotes: string[]
  variants: ChannelDraftVariant[]
  imageNotice: string | null
}

export type ChannelDraftErrorCode =
  | 'KNOWLEDGE_UNAVAILABLE'
  | 'KNOWLEDGE_MISSING'
  | 'MODEL_FAILED'
  | 'MODEL_OUTPUT_INVALID'
  | 'DAILY_LIMIT_REACHED'
  | 'VALIDATION_FAILED'
  | 'PERSISTENCE_FAILED'
  | 'DRAFT_NOT_FOUND'
  | 'EDIT_CONFLICT'
  | 'INSUFFICIENT_CREDITS'
  | 'CREDIT_UNAVAILABLE'

export class ChannelDraftError extends Error {
  constructor(message: string, public readonly code: ChannelDraftErrorCode, public readonly status: number) {
    super(message)
    this.name = 'ChannelDraftError'
  }
}

export interface ChannelDraftRequest {
  workspaceId: string
  userId: string
  topic: string
  requestKey: string
  includeImage?: boolean
}
