import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { listWorkspaceMaterials } from '@/features/sohee-materials/materials-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** 워크스페이스에 등록된 자료 목록 (knowledge_items + knowledge_sources) 조회. */
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    const data = await listWorkspaceMaterials(auth.workspaceId)
    return NextResponse.json({ success: true, data }, { headers: NO_STORE })
  } catch (error) {
    console.error('[knowledge-materials] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json(
      {
        success: false,
        error: 'MATERIALS_UNAVAILABLE',
        message: '자료 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
