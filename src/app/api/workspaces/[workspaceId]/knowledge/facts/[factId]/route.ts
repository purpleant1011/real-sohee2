import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import {
  expireFact,
  updateFactContent,
} from '@/features/sohee-knowledge/facts-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 팩트 내용 인라인 수정 (PATCH)
 */
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string; factId: string }> },
) {
  try {
    const { workspaceId, factId } = await props.params

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
          message: '지식을 수정할 권한이 없습니다.',
        },
        { status: 403, headers: NO_STORE },
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

    const { content } = body

    if (typeof content !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '내용은 필수입니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const trimmedContent = content.trim()
    if (trimmedContent.length < 1 || trimmedContent.length > 12000) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '내용은 1자 이상 12,000자 이하여야 합니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

    const fact = await updateFactContent({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      factId,
      content: trimmedContent,
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          fact,
          ...fact,
        },
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    const status = message.includes('Fact not found') ? 404 : 500
    console.error('[knowledge-facts:patch] failed:', message)
    return NextResponse.json(
      {
        success: false,
        error: status === 404 ? 'FACT_NOT_FOUND' : 'FACT_UPDATE_FAILED',
        message:
          status === 404
            ? '수정할 지식을 찾을 수 없습니다.'
            : '지식을 수정하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status, headers: NO_STORE },
    )
  }
}

/**
 * 팩트 삭제 / 만료 처리 (DELETE)
 */
export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ workspaceId: string; factId: string }> },
) {
  try {
    const { workspaceId, factId } = await props.params

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
          message: '지식을 삭제할 권한이 없습니다.',
        },
        { status: 403, headers: NO_STORE },
      )
    }

    await expireFact({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      factId,
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          success: true,
        },
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-facts:delete] failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'FACT_DELETE_FAILED',
        message: '지식을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
