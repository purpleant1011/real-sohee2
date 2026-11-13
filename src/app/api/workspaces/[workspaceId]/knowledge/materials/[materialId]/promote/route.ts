import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { promoteSuggestionsToFacts } from '@/features/sohee-materials/extraction-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; materialId: string }> },
) {
  try {
    const { workspaceId, materialId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json(
        {
          success: false,
          error: 'FORBIDDEN',
          message: '지식 승격 권한이 없습니다.',
        },
        { status: 403, headers: NO_STORE },
      )
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_REQUEST',
          message: '요청 본문이 올바르지 않습니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const { materialName, suggestions } = body || {}

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'EMPTY_SUGGESTIONS',
          message: '승격할 추천 지식을 최소 1개 이상 선택해 주세요.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const trimmedMaterialName = typeof materialName === 'string' ? materialName.trim() : ''
    if (!trimmedMaterialName) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_MATERIAL_NAME',
          message: '자료 이름이 올바르지 않습니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const result = await promoteSuggestionsToFacts({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      materialId,
      materialName: trimmedMaterialName,
      suggestions,
    })

    return NextResponse.json(
      {
        success: true,
        data: result,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-materials-promote] unexpected error:',
      error instanceof Error ? error.name : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'PROMOTION_FAILED',
        message: '추천 지식 승격 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
