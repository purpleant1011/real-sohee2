import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { computeMobileApprovalFingerprint } from '@/features/mobile-approvals/fingerprint'
import { readConversationDetail } from '@/features/mobile-inbox/server/read-detail'
import { safeDecodeThreadKey } from '@/features/mobile-inbox/detail-model'
import type { InboxClient } from '@/features/mobile-inbox/server/inbox-source'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const schema = z.object({ draftText: z.string().max(2200).refine(v => v.trim().length > 0), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(), expectedUpdatedAt: z.string().datetime({ offset: true }).nullable() }).strict()
export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string; threadKey: string }> }) {
  const { workspaceId, threadKey } = await context.params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) { auth.headers.set('Cache-Control', 'no-store'); return auth }
  if (auth.workspaceId !== workspaceId) return NextResponse.json({ error: '대화를 확인하지 못했어요.' }, { status: 404, headers })
  const match = /^(dm|comment):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(safeDecodeThreadKey(threadKey))
  const body = schema.safeParse(await request.json().catch(() => null))
  if (!match || !body.success || (match[1] === 'dm' && body.data.draftText.length > 1000)) return NextResponse.json({ error: '답안 내용을 확인해 주세요.' }, { status: 422, headers })
  const kind = match[1].toLowerCase() as 'dm' | 'comment'
  const parentId = match[2].toLowerCase()
  try {
    const current = kind === 'dm'
      ? await auth.supabase.from('instagram_dm_drafts').select('workspace_id,draft_text,updated_at').eq('workspace_id', workspaceId).eq('thread_id', parentId).maybeSingle()
      : await auth.supabase.from('comment_reply_drafts').select('workspace_id,draft_text,updated_at').eq('workspace_id', workspaceId).eq('comment_id', parentId).maybeSingle()
    if (current.error || (current.data && current.data.workspace_id !== workspaceId)) throw new Error('Draft unavailable')
    const old = current.data as { draft_text: string; updated_at: string } | null
    const fingerprint = old ? computeMobileApprovalFingerprint(kind === 'dm' ? { kind, workspaceId, threadId: parentId, draftText: old.draft_text } : { kind, workspaceId, commentId: parentId, draftText: old.draft_text }) : null
    if (fingerprint !== body.data.expectedFingerprint || (old?.updated_at ?? null) !== body.data.expectedUpdatedAt) return NextResponse.json({ error: '다른 곳에서 답안이 바뀌었어요. 최신 내용을 확인해 주세요.', code: 'DRAFT_CONFLICT' }, { status: 409, headers })
    const result = await auth.admin.rpc('save_mobile_reply_draft', { p_workspace_id: workspaceId, p_kind: kind, p_parent_id: parentId, p_text: body.data.draftText, p_expected_updated_at: old?.updated_at ?? null, p_expected_text: old?.draft_text ?? null, p_actor_id: auth.userId })
    if (result.error || typeof result.data?.saved !== 'boolean') throw new Error('Draft save unavailable')
    if (!result.data.saved) return NextResponse.json({ error: '답안이 바뀌었거나 지금은 수정할 수 없어요.', code: result.data.code }, { status: result.data.code === 'FORBIDDEN' ? 403 : result.data.code === 'NOT_FOUND' ? 404 : 409, headers })
    const readback = await readConversationDetail(auth.supabase as unknown as InboxClient, { workspaceId, userId: auth.userId }, `${kind}:${parentId}`, { now: () => new Date().toISOString() })
    if (readback.status !== 'ok' || readback.detail.thread.draft?.text !== body.data.draftText || !readback.detail.fingerprint) throw new Error('Draft readback mismatch')
    return NextResponse.json({ saved: true, fingerprint: readback.detail.fingerprint }, { headers })
  } catch { return NextResponse.json({ error: '답안 저장 상태를 확인하지 못했어요. 재전송하지 말고 다시 확인해 주세요.' }, { status: 503, headers }) }
}
