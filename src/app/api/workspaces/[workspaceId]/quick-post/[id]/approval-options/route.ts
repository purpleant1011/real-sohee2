export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { ensureQuickPostVaultVersions, getQuickPostApprovalOptions, QuickPostVaultError } from '@/features/quick-start/quick-post-vault-contract'
import { readQuickPostApprovalReadiness } from '@/features/quick-start/quick-post-approval-readiness'

export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const { workspaceId, id } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  try {
    await ensureQuickPostVaultVersions(auth.admin, auth.workspaceId, auth.userId, id)
    const readiness = await readQuickPostApprovalReadiness(auth.admin, auth.workspaceId)
    const options = await getQuickPostApprovalOptions(auth.admin, auth.workspaceId, id, readiness)
    return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof QuickPostVaultError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[quick-post] approval options unavailable', error)
    return NextResponse.json({ error: '승인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
}
