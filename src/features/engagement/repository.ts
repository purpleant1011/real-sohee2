import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommentClassification,
  CommentReplyDraft,
  CommentStatus,
  EngagementAudit,
  EngagementPolicy,
  SocialChannel,
  SocialComment,
} from './types'

export interface EngagementRepository {
  findCommentById(workspaceId: string, commentId: string): Promise<SocialComment | null>
  listComments(
    workspaceId: string,
    options?: {
      status?: CommentStatus
      channel?: SocialChannel
      limit?: number
      cursor?: string
    }
  ): Promise<{ comments: SocialComment[]; nextCursor?: string }>
  upsertComment(
    comment: Omit<SocialComment, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SocialComment>
  updateCommentStatus(
    workspaceId: string,
    commentId: string,
    status: CommentStatus,
    failureReason?: string | null
  ): Promise<void>
  updateCommentClassification(
    workspaceId: string,
    commentId: string,
    classification: CommentClassification,
    confidence: number
  ): Promise<void>
  findDraftByCommentId(workspaceId: string, commentId: string): Promise<CommentReplyDraft | null>
  saveDraft(
    workspaceId: string,
    commentId: string,
    draftText: string,
    fingerprint: string
  ): Promise<CommentReplyDraft>
  updateDraft(
    workspaceId: string,
    commentId: string,
    draftText: string,
    expectedUpdatedAt?: string
  ): Promise<CommentReplyDraft>
  approveDraft(
    workspaceId: string,
    commentId: string,
    fingerprint: string,
    approvedBy?: string | null,
    isAutoApproved?: boolean
  ): Promise<CommentReplyDraft>
  findPolicy(workspaceId: string, channel: SocialChannel): Promise<EngagementPolicy | null>
  upsertPolicy(
    workspaceId: string,
    policy: Partial<EngagementPolicy> & { channel: SocialChannel }
  ): Promise<EngagementPolicy>
  recordAudit(audit: Omit<EngagementAudit, 'id' | 'created_at'>): Promise<void>
  countAutoRepliesSentToday(
    workspaceId: string,
    channel: SocialChannel,
    date?: Date
  ): Promise<number>
  listUnprocessedComments(workspaceId: string, limit?: number): Promise<SocialComment[]>
}

export class SupabaseEngagementRepository implements EngagementRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findCommentById(workspaceId: string, commentId: string): Promise<SocialComment | null> {
    const { data, error } = await (this.client as any)
      .from('social_comments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', commentId)
      .maybeSingle()

    if (error || !data) return null
    return data as SocialComment
  }

  async listComments(
    workspaceId: string,
    options?: {
      status?: CommentStatus
      channel?: SocialChannel
      limit?: number
      cursor?: string
    }
  ): Promise<{ comments: SocialComment[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100)
    let query = (this.client as any)
      .from('social_comments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('comment_created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (options?.status) {
      query = query.eq('status', options.status)
    }
    if (options?.channel) {
      query = query.eq('channel', options.channel)
    }
    if (options?.cursor) {
      query = query.lt('comment_created_at', options.cursor)
    }

    const { data, error } = await query
    if (error || !data) return { comments: [] }

    const rows = data as SocialComment[]
    let nextCursor: string | undefined
    if (rows.length > limit) {
      const extra = rows.pop()!
      nextCursor = extra.comment_created_at
    }

    return { comments: rows, nextCursor }
  }

  async upsertComment(
    comment: Omit<SocialComment, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SocialComment> {
    const { data, error } = await (this.client as any)
      .from('social_comments')
      .upsert(
        {
          workspace_id: comment.workspace_id,
          channel_connection_id: comment.channel_connection_id,
          channel: comment.channel,
          provider_comment_id: comment.provider_comment_id,
          provider_media_id: comment.provider_media_id,
          author_handle: comment.author_handle,
          author_id: comment.author_id,
          comment_text: comment.comment_text,
          comment_created_at: comment.comment_created_at,
          classification: comment.classification,
          confidence: comment.confidence,
          status: comment.status,
          failure_reason: comment.failure_reason,
        },
        {
          onConflict: 'workspace_id,channel,provider_comment_id',
          ignoreDuplicates: true,
        }
      )
      .select('*')
      .single()

    if (error || !data) {
      const existing = await (this.client as any)
        .from('social_comments')
        .select('*')
        .eq('workspace_id', comment.workspace_id)
        .eq('channel', comment.channel)
        .eq('provider_comment_id', comment.provider_comment_id)
        .maybeSingle()

      if (existing?.data) {
        return existing.data as SocialComment
      }

      throw new Error(`댓글 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as SocialComment
  }

  async updateCommentStatus(
    workspaceId: string,
    commentId: string,
    status: CommentStatus,
    failureReason?: string | null
  ): Promise<void> {
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }
    if (failureReason !== undefined) {
      updatePayload.failure_reason = failureReason
    }

    const { error } = await (this.client as any)
      .from('social_comments')
      .update(updatePayload)
      .eq('workspace_id', workspaceId)
      .eq('id', commentId)

    if (error) {
      throw new Error(`댓글 상태 변경에 실패했습니다: ${error.message}`)
    }
  }

  async updateCommentClassification(
    workspaceId: string,
    commentId: string,
    classification: CommentClassification,
    confidence: number
  ): Promise<void> {
    const { error } = await (this.client as any)
      .from('social_comments')
      .update({
        classification,
        confidence,
        status: 'CLASSIFIED',
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', commentId)

    if (error) {
      throw new Error(`댓글 분류 정보 저장에 실패했습니다: ${error.message}`)
    }
  }

  async findDraftByCommentId(
    workspaceId: string,
    commentId: string
  ): Promise<CommentReplyDraft | null> {
    const { data, error } = await (this.client as any)
      .from('comment_reply_drafts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('comment_id', commentId)
      .maybeSingle()

    if (error || !data) return null
    return data as CommentReplyDraft
  }

  async saveDraft(
    workspaceId: string,
    commentId: string,
    draftText: string,
    _fingerprint: string
  ): Promise<CommentReplyDraft> {
    const { data, error } = await (this.client as any)
      .from('comment_reply_drafts')
      .upsert(
        {
          workspace_id: workspaceId,
          comment_id: commentId,
          draft_text: draftText,
          approved_fingerprint: null,
          approved_by: null,
          approved_at: null,
          is_auto_approved: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,comment_id', ignoreDuplicates: true }
      )
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`답글 초안 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }

    await this.updateCommentStatus(workspaceId, commentId, 'DRAFTED')
    return data as CommentReplyDraft
  }

  async updateDraft(
    workspaceId: string,
    commentId: string,
    draftText: string,
    expectedUpdatedAt?: string
  ): Promise<CommentReplyDraft> {
    // Invariant 2: Any edit after approval invalidates approval!
    let query = (this.client as any)
      .from('comment_reply_drafts')
      .update({
        draft_text: draftText,
        approved_fingerprint: null,
        approved_by: null,
        approved_at: null,
        is_auto_approved: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('comment_id', commentId)
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select('*').single()

    if (error || !data) {
      throw new Error(`답글 수정에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }

    await this.updateCommentStatus(workspaceId, commentId, 'DRAFTED')
    return data as CommentReplyDraft
  }

  async approveDraft(
    workspaceId: string,
    commentId: string,
    fingerprint: string,
    approvedBy?: string | null,
    isAutoApproved = false
  ): Promise<CommentReplyDraft> {
    const now = new Date().toISOString()
    const { data, error } = await (this.client as any)
      .from('comment_reply_drafts')
      .update({
        approved_fingerprint: fingerprint,
        approved_by: approvedBy ?? null,
        approved_at: now,
        is_auto_approved: isAutoApproved,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('comment_id', commentId)
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`답글 승인에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }

    await this.updateCommentStatus(workspaceId, commentId, 'APPROVED')
    return data as CommentReplyDraft
  }

  async findPolicy(workspaceId: string, channel: SocialChannel): Promise<EngagementPolicy | null> {
    const { data, error } = await (this.client as any)
      .from('engagement_policies')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .maybeSingle()

    if (error || !data) return null
    return data as EngagementPolicy
  }

  async upsertPolicy(
    workspaceId: string,
    policy: Partial<EngagementPolicy> & { channel: SocialChannel }
  ): Promise<EngagementPolicy> {
    const payload = {
      workspace_id: workspaceId,
      channel: policy.channel,
      auto_reply_enabled: policy.auto_reply_enabled ?? false,
      is_paused: policy.is_paused ?? false,
      allowed_classes: policy.allowed_classes ?? ['THANKS', 'GREETING'],
      min_confidence: policy.min_confidence ?? 0.85,
      daily_cap: policy.daily_cap ?? 5,
      quiet_hours_enabled: policy.quiet_hours_enabled ?? false,
      quiet_hours_start: policy.quiet_hours_start ?? null,
      quiet_hours_end: policy.quiet_hours_end ?? null,
      max_comment_age_days: policy.max_comment_age_days ?? 7,
      autonomy_level: policy.autonomy_level ?? 'L1_MANUAL',
      default_tone: policy.default_tone ?? 'friendly',
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await (this.client as any)
      .from('engagement_policies')
      .upsert(payload, { onConflict: 'workspace_id,channel', ignoreDuplicates: true })
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`자동 답글 정책 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as EngagementPolicy
  }

  async recordAudit(audit: Omit<EngagementAudit, 'id' | 'created_at'>): Promise<void> {
    const { error } = await (this.client as any)
      .from('engagement_audit')
      .insert({
        workspace_id: audit.workspace_id,
        comment_id: audit.comment_id,
        channel: audit.channel,
        actor: audit.actor,
        actor_user_id: audit.actor_user_id,
        action: audit.action,
        policy_snapshot: audit.policy_snapshot,
        provider_reply_id: audit.provider_reply_id,
        readback_verified: audit.readback_verified,
        details: audit.details,
      })

    if (error) {
      console.error('[EngagementAudit] Failed to record audit log:', error)
      throw new Error(`감사 로그 기록 실패: ${error.message}`)
    }
  }

  async countAutoRepliesSentToday(
    workspaceId: string,
    channel: SocialChannel,
    date = new Date()
  ): Promise<number> {
    // Start of day in KST (UTC+9)
    const kstOffsetMs = 9 * 60 * 60 * 1000
    const kstNow = new Date(date.getTime() + kstOffsetMs)
    kstNow.setUTCHours(0, 0, 0, 0)
    const startOfDayUtcIso = new Date(kstNow.getTime() - kstOffsetMs).toISOString()

    const { count, error } = await (this.client as any)
      .from('engagement_audit')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .eq('action', 'auto_reply')
      .gte('created_at', startOfDayUtcIso)

    if (error) return 0
    return count ?? 0
  }

  async listUnprocessedComments(workspaceId: string, limit = 20): Promise<SocialComment[]> {
    const { data, error } = await (this.client as any)
      .from('social_comments')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['RECEIVED', 'CLASSIFIED', 'DRAFTED'])
      .order('comment_created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []
    return data as SocialComment[]
  }
}
