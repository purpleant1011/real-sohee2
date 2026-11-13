import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { createConversationDraftPreparer } from './conversation-draft-preparer'
import { computeApprovalFingerprint } from './draft'
const mocks = vi.hoisted(() => ({ save: vi.fn(), update: vi.fn(), audit: vi.fn(), dmSave: vi.fn(), dmUpdate: vi.fn(), dmAudit: vi.fn() }))
vi.mock('./repository', () => ({ SupabaseEngagementRepository: class { saveDraft = mocks.save; updateDraft = mocks.update; recordAudit = mocks.audit } }))
vi.mock('./dm/repository', () => ({ SupabaseInstagramDmRepository: class { saveDraft = mocks.dmSave; updateDraft = mocks.dmUpdate; recordAudit = mocks.dmAudit } }))
const ws = '20000000-0000-4000-8000-000000000001'
const target = '30000000-0000-4000-8000-000000000001'
const draftId = '40000000-0000-4000-8000-000000000001'
const source = { id: target, workspace_id: ws, channel: 'threads', comment_text: '가격 문의합니다.', author_handle: 'reader', status: 'DRAFTED' }
const saved = { id: draftId, workspace_id: ws, comment_id: target, draft_text: '상담 후 안내드릴게요.', updated_at: '2026-10-29T12:00:00Z' }
function database(comment: unknown = source, draft: unknown = null, rows: Record<string, unknown> = {}) {
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'order', 'limit']) query[method] = () => query
    query.maybeSingle = async () => ({ data: table in rows ? rows[table] : table === 'social_comments' ? comment : draft, error: null })
    return query
  })
  return { client: { from } as unknown as ServerSupabaseClient, from }
}
beforeEach(() => { vi.clearAllMocks(); mocks.save.mockResolvedValue(saved); mocks.update.mockResolvedValue(saved); mocks.audit.mockResolvedValue(undefined) })
const request = { targetKind: 'comment' as const, targetId: target, draftText: saved.draft_text,
  sourceRef: computeApprovalFingerprint(ws, target, source.comment_text) }
function factory(db = database(), extra: Record<string, unknown> = {}) {
  return createConversationDraftPreparer({ client: db.client, workspaceId: ws,
    userId: '90000000-0000-4000-8000-000000000001', authorize: async () => 'manager' as const,
    now: () => new Date('2026-10-29T12:00:00Z'), ...extra })
}

const dmSourceId = '50000000-0000-4000-8000-000000000001'
const dmThread = { id: target, workspace_id: ws, channel: 'instagram', status: 'NEEDS_REPLY', customer_handle: 'visitor', expires_at: '2026-10-30T10:00:00Z' }
const dmMessage = { id: dmSourceId, workspace_id: ws, thread_id: target, text: '상담 가능한가요?', sent_at: '2026-10-29T10:00:00Z' }
const dmRequest = { targetKind: 'dm' as const, targetId: target, draftText: saved.draft_text, sourceRef: dmSourceId }
function dmDatabase(thread: unknown = dmThread, message: unknown = dmMessage) {
  return database(null, null, { instagram_dm_threads: thread, instagram_dm_messages: message, instagram_dm_drafts: null })
}
describe('canonical reply drafts prepared from conversation', () => {
  it('saves an in-window DM against the exact latest inbound message, without sending', async () => {
    mocks.dmSave.mockResolvedValueOnce({ ...saved, comment_id: undefined, thread_id: target })
    mocks.dmAudit.mockResolvedValueOnce({ recorded: true })
    const result = await factory(dmDatabase())(dmRequest)
    expect(result).toMatchObject({ success: true, status: 'COMPLETED', data: { targetKind: 'dm', draftId, sourceRef: dmSourceId, requiresUserApproval: true } })
    expect(mocks.dmSave).toHaveBeenCalledWith(ws, target, expect.any(Array), 'conversation-draft', saved.draft_text, null, { ifAbsent: true })
    expect(result.proposal).toBeUndefined()
  })
  it.each([
    { name: 'expired window', thread: { ...dmThread, expires_at: '2026-10-28T10:00:00Z' }, message: dmMessage },
    { name: 'already sent', thread: { ...dmThread, status: 'SENT' }, message: dmMessage },
    { name: 'new customer message', thread: dmThread, message: { ...dmMessage, id: '50000000-0000-4000-8000-000000000002' } },
    { name: 'foreign scope', thread: dmThread, message: { ...dmMessage, workspace_id: '21000000-0000-4000-8000-000000000001' } },
  ])('rejects an unsafe DM draft before mutation: $name', async ({ thread, message }) => {
    const result = await factory(dmDatabase(thread, message))(dmRequest)
    expect(result.success).toBe(false)
    expect(mocks.dmSave).not.toHaveBeenCalled()
    expect(mocks.dmAudit).not.toHaveBeenCalled()
  })
  it('holds a saved DM draft when the native audit receipt is unconfirmed', async () => {
    mocks.dmSave.mockResolvedValueOnce({ ...saved, comment_id: undefined, thread_id: target })
    mocks.dmAudit.mockResolvedValueOnce({ recorded: false })
    expect(await factory(dmDatabase())(dmRequest)).toMatchObject({ success: false, status: 'RESULT_UNKNOWN' })
  })
  it('saves the actual domain draft and returns a review snapshot, never a send or synthetic approval', async () => {
    const result = await factory()(request)
    expect(result).toMatchObject({ success: true, status: 'COMPLETED', data: { kind: 'interaction_draft',
      draftId, targetId: target, targetKind: 'comment', draftText: saved.draft_text, requiresUserApproval: true } })
    expect(mocks.save).toHaveBeenCalledWith(ws, target, saved.draft_text, expect.any(String))
    expect(result.proposal).toBeUndefined()
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actor: 'manager', actor_user_id: '90000000-0000-4000-8000-000000000001' }))
  })
  it('rejects a changed source or another workspace before any write', async () => {
    expect((await factory()({ ...request, sourceRef: '0'.repeat(64) })).success).toBe(false)
    expect((await factory(database({ ...source, workspace_id: '21000000-0000-4000-8000-000000000001' }))(request)).success).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not silently replace an existing human draft without an explicit revision target', async () => {
    const result = await factory(database(source, saved))({ ...request, draftText: '모델이 새로 제안한 문안' })
    expect(result.data).toMatchObject({ reused: true, draftText: saved.draft_text })
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('uses a verified selected draft and timestamp CAS for an explicit revision', async () => {
    mocks.update.mockResolvedValueOnce({ ...saved, draft_text: '상담 후 자세히 안내드리겠습니다.' })
    const result = await factory(database(source, saved), { revisionTarget: { targetKind: 'comment', targetId: target,
      draftId, fingerprint: computeApprovalFingerprint(ws, target, saved.draft_text), sourceRef: request.sourceRef } })
      ({ ...request, draftText: '상담 후 자세히 안내드리겠습니다.' })
    expect(result.success).toBe(true)
    expect(mocks.update).toHaveBeenCalledWith(ws, target, '상담 후 자세히 안내드리겠습니다.', saved.updated_at)
  })
  it('keeps a post-mutation audit failure unknown instead of inviting another draft write', async () => {
    mocks.audit.mockRejectedValueOnce(new Error('audit unavailable'))
    const result = await factory()(request)
    expect(result).toMatchObject({ success: false, status: 'RESULT_UNKNOWN' })
    expect(mocks.save).toHaveBeenCalledOnce()
  })
  it('does not treat a lost write response as confirmed failure with no effects', async () => {
    mocks.save.mockRejectedValueOnce(new Error('response lost'))
    expect(await factory()(request)).toMatchObject({ success: false, status: 'RESULT_UNKNOWN' })
  })
  it('rechecks the current actor before mutation and never fixes the role to owner', async () => {
    const authorize = vi.fn().mockResolvedValueOnce('manager').mockResolvedValue(null)
    const result = await factory(database(), { authorize })(request)
    expect(result.success).toBe(false); expect(mocks.save).not.toHaveBeenCalled()
  })
})
