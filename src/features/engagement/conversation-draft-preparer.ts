import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { ToolExecutionResult } from '@/features/tool-runtime/types'
import { SupabaseEngagementRepository } from './repository'
import { SupabaseInstagramDmRepository } from './dm/repository'
import { computeApprovalFingerprint } from './draft'
import { computeDmApprovalFingerprint, checkIsDmExpired } from './dm/options-generator'
import { parseInteractionDraftSnapshot, type InteractionDraftRequest, type InteractionDraftRevisionTarget } from './interaction-draft-contract'

const uuid = z.string().uuid()
const time = z.string().datetime({ offset: true })
const sourceComment = z.object({ id: uuid, workspace_id: uuid, channel: z.enum(['instagram', 'threads']),
  comment_text: z.string(), author_handle: z.string().nullable().optional(), status: z.string() })
const sourceDm = z.object({ id: uuid, workspace_id: uuid, channel: z.literal('instagram'), status: z.string(),
  customer_name: z.string().nullable().optional(), customer_handle: z.string(), expires_at: time })
const sourceMessage = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, text: z.string(), sent_at: time })
const draftSchema = z.object({ id: uuid, workspace_id: uuid, comment_id: uuid.optional(), thread_id: uuid.optional(),
  draft_text: z.string(), updated_at: time })
const requestSchema = z.object({ targetKind: z.enum(['comment', 'dm']), targetId: uuid,
  draftText: z.string().trim().min(1).max(2200), sourceRef: z.string().min(1).max(100) })

/** Saves the existing domain draft only. No approval service, provider send, or second model is invoked. */
export function createConversationDraftPreparer(input: {
  client: ServerSupabaseClient; workspaceId: string; userId: string; jobId?: string
  authorize(): Promise<'owner' | 'manager' | null>
  revisionTarget?: InteractionDraftRevisionTarget
  now?: () => Date
}) {
  const workspaceId = uuid.parse(input.workspaceId)
  const userId = uuid.parse(input.userId)
  const comments = new SupabaseEngagementRepository(input.client)
  const dm = new SupabaseInstagramDmRepository(input.client)
  return async (raw: InteractionDraftRequest): Promise<ToolExecutionResult> => {
    const toolId = raw.targetKind === 'dm' ? 'dm.reply_draft' : 'comment.reply_draft'
    const fail = (code: string, message: string, status: 'BLOCKED' | 'FAILED' = 'BLOCKED'): ToolExecutionResult =>
      ({ success: false, toolId, status, error: { code, message } })
    const parsed = requestSchema.safeParse(raw)
    if (!parsed.success) return fail('MALFORMED_ARGUMENTS', '답안의 대상과 원문 기준을 확인해 주세요.')
    const request = parsed.data
    const admitted = await input.authorize()
    if (admitted !== 'owner' && admitted !== 'manager') return fail('UNAUTHORIZED_SCOPE', '답안 저장은 가게 관리자 권한이 필요해요.')
    const revision = input.revisionTarget
    if (revision && (revision.targetKind !== request.targetKind || revision.targetId !== request.targetId)) {
      return fail('INTERACTION_TARGET_MISMATCH', '선택한 답안과 수정 대상이 달라 작업을 멈췄어요.')
    }
    let writeStarted = false
    try {
      let channel: 'instagram' | 'threads'
      let label: string
      let existing: z.infer<typeof draftSchema> | null
      if (request.targetKind === 'comment') {
        const [target, draft] = await Promise.all([
          input.client.from('social_comments').select('id,workspace_id,channel,comment_text,author_handle,status')
            .eq('workspace_id', workspaceId).eq('id', request.targetId).maybeSingle(),
          input.client.from('comment_reply_drafts').select('id,workspace_id,comment_id,draft_text,updated_at')
            .eq('workspace_id', workspaceId).eq('comment_id', request.targetId).maybeSingle(),
        ])
        if (target.error || draft.error) return fail('INTERACTION_READ_UNAVAILABLE', '답안과 원문을 확인하지 못했어요.', 'FAILED')
        const comment = sourceComment.safeParse(target.data)
        if (!comment.success || comment.data.workspace_id !== workspaceId || comment.data.id !== request.targetId) return fail('INTERACTION_TARGET_UNAVAILABLE', '현재 가게의 댓글을 확인해 주세요.')
        if (!['NEW', 'CLASSIFIED', 'DRAFTED', 'APPROVED'].includes(comment.data.status)) return fail('INTERACTION_TARGET_CLOSED', '이미 처리했거나 확인이 필요한 댓글이라 답안을 바꾸지 않았어요.')
        if (computeApprovalFingerprint(workspaceId, request.targetId, comment.data.comment_text) !== request.sourceRef) return fail('INTERACTION_SOURCE_CHANGED', '댓글 원문이 바뀌었어요. 최신 내용으로 다시 검토해 주세요.')
        channel = comment.data.channel
        label = comment.data.author_handle || '방문 고객'
        existing = draft.data === null ? null : draftSchema.parse(draft.data)
      } else {
        if (request.draftText.length > 1000) return fail('DM_DRAFT_TOO_LONG', 'DM 답안은 1,000자 이내로 준비해 주세요.')
        const [target, draft, latest] = await Promise.all([
          input.client.from('instagram_dm_threads').select('id,workspace_id,channel,status,customer_name,customer_handle,expires_at')
            .eq('workspace_id', workspaceId).eq('id', request.targetId).maybeSingle(),
          input.client.from('instagram_dm_drafts').select('id,workspace_id,thread_id,draft_text,updated_at')
            .eq('workspace_id', workspaceId).eq('thread_id', request.targetId).maybeSingle(),
          input.client.from('instagram_dm_messages').select('id,workspace_id,thread_id,text,sent_at')
            .eq('workspace_id', workspaceId).eq('thread_id', request.targetId).eq('sender_type', 'customer')
            .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
        ])
        if (target.error || draft.error || latest.error) return fail('INTERACTION_READ_UNAVAILABLE', '대화 원문과 답안을 확인하지 못했어요.', 'FAILED')
        const thread = sourceDm.safeParse(target.data)
        const source = sourceMessage.safeParse(latest.data)
        if (!thread.success || !source.success || thread.data.workspace_id !== workspaceId || source.data.workspace_id !== workspaceId
          || source.data.thread_id !== request.targetId || thread.data.id !== request.targetId) return fail('INTERACTION_TARGET_UNAVAILABLE', '현재 가게의 수신 대화를 확인해 주세요.')
        if (thread.data.status !== 'NEEDS_REPLY' || checkIsDmExpired(thread.data.expires_at, input.now?.() ?? new Date())) return fail('DM_REPLY_WINDOW_UNAVAILABLE', '이미 처리했거나 답장 가능 시간이 지난 대화예요.')
        if (source.data.id !== request.sourceRef || !source.data.text.trim()) return fail('INTERACTION_SOURCE_CHANGED', '최신 고객 메시지를 확인한 뒤 다시 준비해 주세요.')
        channel = 'instagram'; label = thread.data.customer_name || thread.data.customer_handle || '문의 고객'
        existing = draft.data === null ? null : draftSchema.parse(draft.data)
      }
      if (existing && (existing.workspace_id !== workspaceId
        || (request.targetKind === 'comment' ? existing.comment_id : existing.thread_id) !== request.targetId)) return fail('INTERACTION_DRAFT_SCOPE_MISMATCH', '현재 가게의 답안을 확인하지 못했어요.')
      const fingerprint = request.targetKind === 'comment' ? computeApprovalFingerprint : computeDmApprovalFingerprint
      let stored = existing
      let reused = Boolean(existing)
      if (existing && revision && (revision.draftId !== existing.id || revision.fingerprint !== fingerprint(workspaceId, request.targetId, existing.draft_text)
        || revision.sourceRef !== request.sourceRef)) return fail('INTERACTION_DRAFT_CHANGED', '다른 곳에서 답안이나 원문이 변경됐어요. 최신 버전을 다시 선택해 주세요.')
      const shouldWrite = !existing || (Boolean(revision) && existing.draft_text !== request.draftText)
      if (shouldWrite) {
        const actor = await input.authorize()
        if (actor !== 'owner' && actor !== 'manager') return fail('UNAUTHORIZED_SCOPE', '현재 답안 저장 권한을 확인하지 못해 작업을 멈췄어요.')
        writeStarted = true
        const rawStored = request.targetKind === 'comment'
          ? existing ? await comments.updateDraft(workspaceId, request.targetId, request.draftText, existing.updated_at)
            : await comments.saveDraft(workspaceId, request.targetId, request.draftText, fingerprint(workspaceId, request.targetId, request.draftText))
          : existing ? await dm.updateDraft(workspaceId, request.targetId, request.draftText, null, existing.updated_at)
            : await dm.saveDraft(workspaceId, request.targetId, [{ id: 'conversation-draft', label: '대화에서 준비한 답안', draftText: request.draftText }], 'conversation-draft', request.draftText, null, { ifAbsent: true })
        stored = draftSchema.parse(rawStored); reused = false
        if (stored.workspace_id !== workspaceId || stored.draft_text !== request.draftText
          || (request.targetKind === 'comment' ? stored.comment_id : stored.thread_id) !== request.targetId) throw new Error('INTERACTION_DRAFT_WRITE_MISMATCH')
        const details = { draftFingerprint: fingerprint(workspaceId, request.targetId, stored.draft_text), draftLength: stored.draft_text.length,
          ...(input.jobId ? { conversationJobId: input.jobId } : {}) }
        if (request.targetKind === 'comment') await comments.recordAudit({ workspace_id: workspaceId, comment_id: request.targetId, channel,
          actor, actor_user_id: userId, action: existing ? 'edit_draft' : 'regenerate_draft', policy_snapshot: null,
          provider_reply_id: null, readback_verified: false, details })
        else {
          const audit = await dm.recordAudit({ workspace_id: workspaceId, thread_id: request.targetId, actor, actor_user_id: userId,
            action: existing ? 'edit_draft' : 'generate_draft', provider_message_id: null, readback_verified: false, details })
          if (!audit.recorded) throw new Error('DRAFT_AUDIT_UNCONFIRMED')
        }
      }
      if (!stored) throw new Error('INTERACTION_DRAFT_UNAVAILABLE')
      const snapshot = parseInteractionDraftSnapshot({ kind: 'interaction_draft', workspaceId, targetKind: request.targetKind,
        targetId: request.targetId, draftId: stored.id, draftText: stored.draft_text,
        fingerprint: fingerprint(workspaceId, request.targetId, stored.draft_text), sourceRef: request.sourceRef,
        channel, customerLabel: label.slice(0, 300), preparedAt: stored.updated_at, reused, requiresUserApproval: true }, workspaceId)
      return { success: true, toolId, status: 'COMPLETED', data: { ...snapshot },
        logs: [reused ? '기존 답안을 덮어쓰지 않고 검토할 초안을 불러왔어요. 아직 발송하지 않았어요.' : '기존 업무 원장에 답안을 저장했어요. 발송은 사용자의 별도 승인이 필요해요.'] }
    } catch {
      if (writeStarted) return { success: false, toolId, status: 'RESULT_UNKNOWN',
        error: { code: 'INTERACTION_DRAFT_RESULT_UNKNOWN', message: '초안 저장이나 이력을 확인 중이에요. 다시 생성하지 말고 현재 초안을 먼저 확인해 주세요.' } }
      return fail('INTERACTION_DRAFT_UNAVAILABLE', '답안 저장이나 이력 확인을 마치지 못했어요. 중복 실행하지 말고 현재 초안을 확인해 주세요.', 'FAILED')
    }
  }
}
