import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { simulateKnowledgeResponse } from '@/features/sohee-knowledge/simulate-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  req: NextRequest,
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

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'INVALID_JSON', message: '잘못된 요청 형식입니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'INVALID_BODY', message: '잘못된 요청 형식입니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    const { query, type } = body

    if (typeof query !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '질문 내용은 1자 이상 500자 이하여야 합니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const trimmedQuery = query.trim()
    if (trimmedQuery.length < 1 || trimmedQuery.length > 500) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '질문 내용은 1자 이상 500자 이하여야 합니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    if (type !== undefined && type !== 'faq' && type !== 'marketing') {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '유효하지 않은 시뮬레이션 타입입니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const result = await simulateKnowledgeResponse({
      workspaceId: auth.workspaceId,
      query: trimmedQuery,
      type,
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
      '[knowledge-simulate] failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'SIMULATE_FAILED',
        message: '지식 시뮬레이션 응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
