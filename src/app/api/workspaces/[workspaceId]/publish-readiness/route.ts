export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { getPublishReadiness } from '@/features/publish-readiness/service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const readiness = await getPublishReadiness(auth.admin, auth.workspaceId, new Date())

    return NextResponse.json(
      { success: true, data: readiness },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[publish-readiness.get]', error)
    return NextResponse.json(
      { success: false, error: '준비 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
