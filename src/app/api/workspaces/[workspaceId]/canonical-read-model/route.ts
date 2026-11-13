import { NextRequest, NextResponse } from 'next/server'
import { getWorkspaceCanonicalReadModel } from '@/features/canonical-read-model/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params

    // Cross-tenant guard (E2E-F F-2): refuse a non-member before building the read model.
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    // Credential metadata is service-role-only. Project only after membership authorization.
    const readModel = await getWorkspaceCanonicalReadModel(auth.workspaceId, auth.admin)
    return NextResponse.json({ success: true, data: readModel })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch canonical read model' },
      { status: 500 }
    )
  }
}
