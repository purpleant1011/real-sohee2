export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createReleaseDependencies } from '@/features/vault/ui/release-panel/pg-dependencies'
import { preflightRelease, ReleaseError } from '@/features/vault/ui/release-panel/release-service'

export async function POST(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const auth = await authorizeQuickRequest((await params).workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth
    const data = await preflightRelease(auth.workspaceId, auth.userId, createReleaseDependencies(auth.admin, auth.supabase))
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ReleaseError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[vault.release.preflight]', error)
    return NextResponse.json({ success: false, error: '재검사를 진행하지 못했어요. 잠시 후 다시 시도해 주세요' }, { status: 500 })
  }
}
