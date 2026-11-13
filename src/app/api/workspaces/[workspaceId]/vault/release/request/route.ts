export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createReleaseDependencies } from '@/features/vault/ui/release-panel/pg-dependencies'
import { ReleaseError, requestRelease } from '@/features/vault/ui/release-panel/release-service'

const schema = z.object({ itemIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{4,128}$/)).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict()
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const auth = await authorizeQuickRequest((await params).workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ success: false, error: '보관 항목을 다시 선택해 주세요' }, { status: 422 })
    const data = await requestRelease(auth.workspaceId, parsed.data.itemIds, createReleaseDependencies(auth.admin, auth.supabase), auth.userId)
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ReleaseError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[vault.release.request]', error)
    return NextResponse.json({ success: false, error: '발행 요청을 저장하지 못했어요. 잠시 후 다시 시도해 주세요' }, { status: 500 })
  }
}
