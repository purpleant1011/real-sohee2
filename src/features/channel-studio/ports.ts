import type { ChannelDraftEditSnapshot, ChannelDraftResult, ChannelDraftVariant, GroundedBusinessContext, StudioChannel } from './types'

/**
 * Persistence port. Implemented by the DB stream (SupabaseChannelDraftRepository) and injected by the
 * generation service, so the service never imports Supabase directly.
 */
export interface SaveChannelDraftInput {
  workspaceId: string
  userId: string
  requestKey: string
  topic: string
  knowledgeVersion: number
  basisNotes: string[]
  imageNotice: string | null
  imageIds: string[]
  /** Variants without contentId/versionId; the repository materialises them for the vault. */
  variants: Array<Omit<ChannelDraftVariant, 'contentId' | 'versionId' | 'vaultSavable' | 'blockedReason'> & { savableReason: string | null }>
}

export interface ChannelDraftRepository {
  /** Atomically claim a workspace request before any model call, enforcing the daily cost cap. */
  reserve(input: Omit<SaveChannelDraftInput, 'variants' | 'imageIds'>): Promise<{ kind: 'acquired' } | { kind: 'pending' } | { kind: 'existing'; result: ChannelDraftResult } | { kind: 'limit' }>
  /** Remove only an incomplete reservation owned by this request; never delete finished drafts. */
  release(workspaceId: string, requestKey: string, userId: string): Promise<void>
  /** Same workspace + requestKey returns the stored result (idempotent replay). Other workspaces never match. */
  findByRequestKey(workspaceId: string, requestKey: string): Promise<ChannelDraftResult | null>
  /** Includes the persisted knowledge version for revalidating an edit against current active facts. */
  findEditSnapshot(workspaceId: string, requestKey: string): Promise<ChannelDraftEditSnapshot | null>
  /** Compare-and-set one variant and materialise its new vault version in a single transaction. Null means stale. */
  updateVariant(workspaceId: string, requestKey: string, channel: StudioChannel, expected: ChannelDraftVariant, next: ChannelDraftVariant, userId: string): Promise<ChannelDraftResult | null>
  /** Drafts created by this workspace since `sinceIso` (daily cost guard). */
  countSince(workspaceId: string, sinceIso: string): Promise<number>
  /**
   * Stores the draft once per (workspaceId, requestKey) and creates the content rows the vault save API needs.
   * A concurrent duplicate returns the first stored result instead of inserting twice.
   */
  save(input: SaveChannelDraftInput): Promise<ChannelDraftResult>
  /** Recent drafts for the owner's list. */
  listRecent(workspaceId: string, limit: number): Promise<ChannelDraftResult[]>
}

/** Core stream exports (knowledge-context.ts / claim-guard.ts) implement these shapes. */
export interface KnowledgeContextLoader {
  (workspaceId: string): Promise<GroundedBusinessContext>
}

export interface ClaimCheck {
  status: 'OK' | 'UNKNOWN'
  /** Korean owner-facing reasons, empty when OK. */
  issues: string[]
}

export interface ClaimChecker {
  (channel: StudioChannel, payload: Record<string, unknown>, ctx: GroundedBusinessContext): ClaimCheck
}

/** Builds the factual base draft fed to generateChannelVariants (facts only, no invented claims). */
export interface BaseDraftBuilder {
  (ctx: GroundedBusinessContext, topic: string): string
}
