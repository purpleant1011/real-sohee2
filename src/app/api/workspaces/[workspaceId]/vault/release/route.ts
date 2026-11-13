export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createReleaseDependencies } from '@/features/vault/ui/release-panel/pg-dependencies'
import { releaseStatus } from '@/features/vault/ui/release-panel/release-service'

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const auth = await authorizeQuickRequest((await params).workspaceId)
    if (isResponse(auth)) return auth
    const data = await releaseStatus(auth.workspaceId, createReleaseDependencies(auth.admin, auth.supabase))
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[vault.release.status]', error)
    return NextResponse.json({ success: false, error: '연결 상태를 가져오지 못했어요. 잠시 후 다시 시도해 주세요' }, { status: 500 })
  }
}
