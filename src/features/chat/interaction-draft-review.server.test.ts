import { describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { computeApprovalFingerprint } from '@/features/engagement/draft'
import { loadInteractionDraftReview } from './interaction-draft-review.server'
vi.mock('server-only', () => ({}))
const ws = '20000000-0000-4000-8000-000000000001'
const threadId = '30000000-0000-4000-8000-000000000001'
const stepId = '40000000-0000-4000-8000-000000000001'
const jobId = '50000000-0000-4000-8000-000000000001'
const targetId = '60000000-0000-4000-8000-000000000001'
const draftId = '70000000-0000-4000-8000-000000000001'
const sourceText = '가격을 알려주세요.'
const draftText = '상담 후 안내드릴게요.'
const snapshot = { kind: 'interaction_draft', workspaceId: ws, targetKind: 'comment', targetId, draftId, draftText,
  fingerprint: computeApprovalFingerprint(ws, targetId, draftText), sourceRef: computeApprovalFingerprint(ws, targetId, sourceText),
  channel: 'threads', customerLabel: '문의 고객', preparedAt: '2026-10-29T12:00:00Z', reused: false, requiresUserApproval: true }
function database(overrides: Record<string, unknown> = {}) {
  const rows: Record<string, unknown> = {
    conversation_job_steps: { id: stepId, workspace_id: ws, job_id: jobId, capability_id: 'comment.reply_draft', status: 'completed', output_payload: snapshot },
    conversation_jobs: { id: jobId, workspace_id: ws, thread_id: threadId, status: 'succeeded' },
    social_comments: { id: targetId, workspace_id: ws, channel: 'threads', status: 'DRAFTED', comment_text: sourceText },
    comment_reply_drafts: { id: draftId, workspace_id: ws, comment_id: targetId, draft_text: draftText }, ...overrides,
  }
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain
    chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
    return chain
  })
  return { client: { from } as unknown as ServerSupabaseClient, from }
}
const scope = { workspaceId: ws, threadId, stepId }
describe('fresh native reply draft review', () => {
  it('reads current source and canonical draft without creating or approving anything', async () => {
    const result = await loadInteractionDraftReview({ ...database(), ...scope })
    expect(result).toMatchObject({ snapshot, sourceText, currentDraftText: draftText, canSend: true, reason: null })
  })
  it('blocks approval of the old snapshot after a human draft edit', async () => {
    const db = database({ comment_reply_drafts: { id: draftId, workspace_id: ws, comment_id: targetId, draft_text: '사람이 수정한 답안' } })
    expect(await loadInteractionDraftReview({ ...db, ...scope })).toMatchObject({ canSend: false, reason: 'DRAFT_CHANGED', currentDraftText: '사람이 수정한 답안' })
  })
  it('blocks approval after the source comment changes', async () => {
    const db = database({ social_comments: { id: targetId, workspace_id: ws, channel: 'threads', status: 'DRAFTED', comment_text: '변경된 질문' } })
    expect(await loadInteractionDraftReview({ ...db, ...scope })).toMatchObject({ canSend: false, reason: 'SOURCE_CHANGED', sourceText: '변경된 질문' })
  })
  it('rejects a job from another conversation before reading customer data', async () => {
    const db = database({ conversation_jobs: { id: jobId, workspace_id: ws, thread_id: '31000000-0000-4000-8000-000000000001', status: 'succeeded' } })
    await expect(loadInteractionDraftReview({ ...db, ...scope })).rejects.toThrow('INTERACTION_REVIEW_SCOPE_MISMATCH')
    expect(db.from).not.toHaveBeenCalledWith('social_comments')
  })
  it('does not offer another send for an already handled source', async () => {
    const db = database({ social_comments: { id: targetId, workspace_id: ws, channel: 'threads', status: 'SENT', comment_text: sourceText } })
    expect(await loadInteractionDraftReview({ ...db, ...scope })).toMatchObject({ canSend: false, reason: 'TARGET_CLOSED' })
  })
})
