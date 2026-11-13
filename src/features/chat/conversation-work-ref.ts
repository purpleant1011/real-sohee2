import { z } from 'zod'
import { workspaceRoleSchema } from '@/features/auth/workspace-context'
import type { ConversationAuthorityDatabase } from './conversation-authority'

export type ConversationWorkRef = Readonly<{
  workspaceId: string; contentId: string; versionId: string; versionNumber: number
  fingerprint: string; title: string; channel: string; summary: string; readOnly: true; returnHref: string
}>
const uuid = z.string().uuid()
const versionSchema = z.object({ id: uuid, workspace_id: uuid, content_id: uuid, version_number: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i), caption: z.string().max(20_000) })
const itemSchema = z.object({ id: uuid, workspace_id: uuid, current_version_id: uuid, title: z.string().max(300), channel: z.string().max(80), status: z.string() })

/** The opaque version reference is never authority: revalidate membership, tenant and current version. */
export async function resolveConversationWorkRef(db: ConversationAuthorityDatabase, input: {
  workspaceId: string; userId: string; workRef: string
}): Promise<ConversationWorkRef | null> {
  if (!z.object({ workspaceId: uuid, userId: uuid, workRef: uuid }).safeParse(input).success) return null
  try {
    const [membership, version] = await Promise.all([
      db.from('workspace_members').select('role, status').eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle(),
      db.from('content_versions').select('id, workspace_id, content_id, version_number, fingerprint, caption').eq('workspace_id', input.workspaceId).eq('id', input.workRef).maybeSingle(),
    ])
    const member = z.object({ role: workspaceRoleSchema, status: z.literal('active') }).safeParse(membership.data)
    const snapshot = versionSchema.safeParse(version.data)
    if (membership.error || version.error || !member.success || !snapshot.success
      || snapshot.data.workspace_id !== input.workspaceId || snapshot.data.id !== input.workRef) return null
    const result = await db.from('content_items').select('id, workspace_id, current_version_id, title, channel, status')
      .eq('workspace_id', input.workspaceId).eq('id', snapshot.data.content_id).maybeSingle()
    const item = itemSchema.safeParse(result.data)
    if (result.error || !item.success || item.data.status === 'archived' || item.data.workspace_id !== input.workspaceId
      || item.data.id !== snapshot.data.content_id || item.data.current_version_id !== snapshot.data.id) return null
    return Object.freeze({ workspaceId: input.workspaceId, contentId: item.data.id, versionId: snapshot.data.id,
      versionNumber: snapshot.data.version_number, fingerprint: snapshot.data.fingerprint, title: item.data.title,
      channel: item.data.channel, summary: snapshot.data.caption, readOnly: true, returnHref: `/app/work/${item.data.id}` })
  } catch { return null }
}
