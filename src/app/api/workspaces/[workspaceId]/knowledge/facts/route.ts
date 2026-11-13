import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import {
  createCustomFact,
  listWorkspaceFacts,
} from '@/features/sohee-knowledge/facts-service'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * 워크스페이스의 활성 상태 가르친 지식(facts) 목록 조회
 */
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

    const facts = await listWorkspaceFacts(auth.workspaceId)
    return NextResponse.json(
      { success: true, data: { facts } },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-facts:get] failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'FACTS_QUERY_FAILED',
        message: '지식 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}

/**
 * 사장님 직접 등록 지식 신규 생성
 */
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

    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json(
        {
          success: false,
          error: 'FORBIDDEN',
          message: '지식을 등록할 권한이 없습니다.',
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

    const { category, content } = body

    if (!category || typeof category !== 'string' || !category.trim()) {
      return NextResponse.json(
        {
          success: false,
          error: 'INVALID_PARAMS',
          message: '카테고리는 필수입니다.',
        },
        { status: 400, headers: NO_STORE },
      )
    }

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

    const fact = await createCustomFact({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      category: category.trim(),
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
      { status: 201, headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-facts:post] failed:',
      error instanceof Error ? error.message : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'FACT_CREATE_FAILED',
        message: '지식을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
