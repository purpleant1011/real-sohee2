export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { VAULT_WRITE_FORBIDDEN_MESSAGE } from '@/features/vault/permissions'
import { decodeReleaseRef, releaseRef } from '@/features/vault/ui/release-panel/release-service'
import { publishReleasedItems } from '@/features/vault/publish/batch-publish'
import { createBatchPublishDependencies } from '@/features/vault/publish/pg-dependencies'

const schema = z.object({ itemRefs: z.array(z.string().regex(/^[A-Za-z0-9_-]{22}$/)).min(1).max(10).refine(ids => new Set(ids).size === ids.length).optional() }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const auth = await authorizeQuickRequest((await params).workspaceId, { requireRole: 'manager', forbiddenMessage: VAULT_WRITE_FORBIDDEN_MESSAGE })
    if (isResponse(auth)) return auth
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success || parsed.data.itemRefs?.some(ref => releaseRef(decodeReleaseRef(ref)) !== ref)) {
      return NextResponse.json({ success: false, error: '보관 항목을 다시 선택해 주세요' }, { status: 422 })
    }
    const data = await publishReleasedItems({ workspaceId: auth.workspaceId, actorId: auth.userId,
      itemIds: parsed.data.itemRefs?.map(decodeReleaseRef), now: new Date() }, createBatchPublishDependencies(auth.admin))
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[vault.publish]', error)
    return NextResponse.json({ success: false, error: '게시 결과를 확인하지 못했어요. 잠시 후 다시 시도해 주세요' }, { status: 500 })
  }
}
