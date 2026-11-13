import 'server-only'
import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { parseInteractionDraftSnapshot } from '@/features/engagement/interaction-draft-contract'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
import { computeDmApprovalFingerprint, checkIsDmExpired } from '@/features/engagement/dm/options-generator'

const uuid = z.string().uuid()
const stepSchema = z.object({ id: uuid, workspace_id: uuid, job_id: uuid,
  capability_id: z.enum(['comment.reply_draft', 'dm.reply_draft']), status: z.literal('completed'), output_payload: z.unknown() })
const jobSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, status: z.literal('succeeded') })
const draftSchema = z.object({ id: uuid, workspace_id: uuid, comment_id: uuid.optional(), thread_id: uuid.optional(), draft_text: z.string().max(2200) })
const commentSchema = z.object({ id: uuid, workspace_id: uuid, channel: z.enum(['instagram', 'threads']), status: z.string(), comment_text: z.string().max(20_000) })
const dmSchema = z.object({ id: uuid, workspace_id: uuid, channel: z.literal('instagram'), status: z.string(), expires_at: z.string().datetime({ offset: true }) })
const sourceSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, text: z.string().max(20_000) })
type ReviewReason = 'SOURCE_CHANGED' | 'DRAFT_CHANGED' | 'TARGET_CLOSED' | 'DM_WINDOW_EXPIRED'

/** Fresh read-only review. This never generates, edits, approves, or sends a draft. */
export async function loadInteractionDraftReview(input: {
  client: ServerSupabaseClient; workspaceId: string; threadId: string; stepId: string
}) {
  const workspaceId = uuid.parse(input.workspaceId)
  const threadId = uuid.parse(input.threadId)
  const stepId = uuid.parse(input.stepId)
  const result = await input.client.from('conversation_job_steps').select('id,workspace_id,job_id,capability_id,status,output_payload')
    .eq('workspace_id', workspaceId).eq('id', stepId).maybeSingle()
  const parsedStep = stepSchema.safeParse(result.data)
  if (result.error || !parsedStep.success) throw new Error('INTERACTION_REVIEW_UNAVAILABLE')
  const step = parsedStep.data
  if (step.id !== stepId || step.workspace_id !== workspaceId) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
  const jobResult = await input.client.from('conversation_jobs').select('id,workspace_id,thread_id,status')
    .eq('workspace_id', workspaceId).eq('thread_id', threadId).eq('id', step.job_id).eq('status', 'succeeded').maybeSingle()
  const job = jobSchema.safeParse(jobResult.data)
  if (jobResult.error) throw new Error('INTERACTION_REVIEW_UNAVAILABLE')
  if (!job.success || job.data.id !== step.job_id || job.data.workspace_id !== workspaceId || job.data.thread_id !== threadId) {
    throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
  }
  const snapshot = parseInteractionDraftSnapshot(step.output_payload, workspaceId)
  if ((snapshot.targetKind === 'dm') !== (step.capability_id === 'dm.reply_draft')) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
  const fingerprint = snapshot.targetKind === 'dm' ? computeDmApprovalFingerprint : computeApprovalFingerprint
  if (snapshot.fingerprint !== fingerprint(workspaceId, snapshot.targetId, snapshot.draftText)) throw new Error('INTERACTION_DRAFT_INVALID')
  let sourceText: string | null = null
  let sourceRef: string | null = null
  let reason: ReviewReason | null = null
  let saved: z.infer<typeof draftSchema> | null
  if (snapshot.targetKind === 'comment') {
    const [target, draft] = await Promise.all([
      input.client.from('social_comments').select('id,workspace_id,channel,status,comment_text')
        .eq('workspace_id', workspaceId).eq('id', snapshot.targetId).maybeSingle(),
      input.client.from('comment_reply_drafts').select('id,workspace_id,comment_id,draft_text')
        .eq('workspace_id', workspaceId).eq('comment_id', snapshot.targetId).maybeSingle(),
    ])
    if (target.error || draft.error) throw new Error('INTERACTION_REVIEW_UNAVAILABLE')
    const comment = commentSchema.parse(target.data)
    if (comment.workspace_id !== workspaceId || comment.id !== snapshot.targetId || comment.channel !== snapshot.channel) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
    sourceText = comment.comment_text
    sourceRef = computeApprovalFingerprint(workspaceId, comment.id, comment.comment_text)
    if (!['NEW', 'CLASSIFIED', 'DRAFTED', 'APPROVED'].includes(comment.status)) reason = 'TARGET_CLOSED'
    saved = draft.data === null ? null : draftSchema.parse(draft.data)
  } else {
    const [target, draft, latest] = await Promise.all([
      input.client.from('instagram_dm_threads').select('id,workspace_id,channel,status,expires_at')
        .eq('workspace_id', workspaceId).eq('id', snapshot.targetId).maybeSingle(),
      input.client.from('instagram_dm_drafts').select('id,workspace_id,thread_id,draft_text')
        .eq('workspace_id', workspaceId).eq('thread_id', snapshot.targetId).maybeSingle(),
      input.client.from('instagram_dm_messages').select('id,workspace_id,thread_id,text')
        .eq('workspace_id', workspaceId).eq('thread_id', snapshot.targetId).eq('sender_type', 'customer')
        .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    ])
    if (target.error || draft.error || latest.error) throw new Error('INTERACTION_REVIEW_UNAVAILABLE')
    const thread = dmSchema.parse(target.data)
    if (thread.workspace_id !== workspaceId || thread.id !== snapshot.targetId) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
    const source = latest.data === null ? null : sourceSchema.parse(latest.data)
    if (source && (source.workspace_id !== workspaceId || source.thread_id !== snapshot.targetId)) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
    sourceText = source?.text ?? null
    sourceRef = source?.id ?? null
    if (thread.status !== 'NEEDS_REPLY') reason = 'TARGET_CLOSED'
    else if (checkIsDmExpired(thread.expires_at)) reason = 'DM_WINDOW_EXPIRED'
    saved = draft.data === null ? null : draftSchema.parse(draft.data)
  }
  if (saved && (saved.workspace_id !== workspaceId
    || (snapshot.targetKind === 'comment' ? saved.comment_id : saved.thread_id) !== snapshot.targetId)) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
  if (!reason && sourceRef !== snapshot.sourceRef) reason = 'SOURCE_CHANGED'
  if (!reason && (!saved || saved.id !== snapshot.draftId || fingerprint(workspaceId, snapshot.targetId, saved.draft_text) !== snapshot.fingerprint)) reason = 'DRAFT_CHANGED'
  return { snapshot, sourceText, currentDraftText: saved?.draft_text ?? null, canSend: reason === null, reason, observedAt: new Date().toISOString() }
}
