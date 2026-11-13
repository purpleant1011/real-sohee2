export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { applyVaultEdit, VaultEditError } from '@/features/vault/edit'
import { SupabaseVaultEditRepository } from '@/features/vault/edit/repository'
import { recordVaultFunnelEvent } from '@/features/vault/funnel'
import { VAULT_WRITE_FORBIDDEN_MESSAGE } from '@/features/vault/permissions'
import { getVaultItemDetail } from '@/features/vault/query/item-detail'

const image = z.object({ position: z.number().int().nonnegative(), type: z.literal('image'), mimeType: z.string().startsWith('image/'), sizeBytes: z.number().int().nonnegative(), renditionContentDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const schema = z.object({ expectedVersion: z.string().trim().min(1), operation: z.enum(['edit', 'replace_shared_image', 'reapprove', 'hold', 'resume', 'delete', 'restore']), changes: z.object({ title: z.string().max(10000).optional(), text: z.string().max(100000).optional(), hashtags: z.array(z.string().max(200)).max(100).optional(), settings: z.object({ category: z.string().nullable(), visibility: z.string().min(1), coupon: z.string().nullable() }).strict().optional(), targetDate: z.iso.date().nullable().optional(), image: z.object({ oldDigest: z.string().regex(/^[a-f0-9]{64}$/), replacement: image }).strict().optional() }).strict().optional() }).strict()

/** Read-only detail for the preview and edit sheet. Uses the signed-in user's own session so row-level access applies. */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string; itemRef: string }> }) {
  const { workspaceId, itemRef } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    const data = await getVaultItemDetail(new SupabaseVaultEditRepository(auth.supabase), { workspaceId: auth.workspaceId, itemRef })
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof VaultEditError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[vault.detail] request failed', error)
    return NextResponse.json({ success: false, error: '보관 글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string; itemRef: string }> }) {
  const { workspaceId, itemRef } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager', forbiddenMessage: VAULT_WRITE_FORBIDDEN_MESSAGE })
    if (isResponse(auth)) return auth
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('expectedVersion' in body) || typeof body.expectedVersion !== 'string' || !body.expectedVersion.trim()) return NextResponse.json({ error: '최신 내용을 불러온 뒤 다시 시도해 주세요.' }, { status: 400 })
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: '수정할 내용을 확인해 주세요.' }, { status: 422 })
    const result = await applyVaultEdit(
      new SupabaseVaultEditRepository(auth.admin),
      { workspaceId: auth.workspaceId, actorId: auth.userId, actorRole: auth.role, itemRef, ...parsed.data, now: new Date() },
      {
        recordFunnelEvent: async (ev) => {
          await recordVaultFunnelEvent(
            {
              workspaceId: ev.workspaceId,
              userId: ev.userId,
              event: ev.event,
              channel: ev.channel,
              properties: ev.properties,
            },
            { admin: auth.admin },
          )
        },
      },
    )
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof VaultEditError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[vault.edit] request failed', error)
    return NextResponse.json({ error: '보관 글을 변경하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
