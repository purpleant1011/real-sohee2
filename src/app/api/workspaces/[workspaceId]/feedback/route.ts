export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { listFeedbackForWorkspace, requestFeedbackDeletion, submitFeedback } from '@/features/feedback/repository'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    const body = await request.json().catch(() => null)
    const result = await submitFeedback(auth.admin, { workspaceId: auth.workspaceId, userId: auth.userId }, body)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.reason === 'INVALID' ? 422 : 500, headers: NO_STORE })
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: '의견을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }
}

/** 조회 실패는 500으로 알린다. 빈 목록(200 + [])과 구분된다. */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    const result = await listFeedbackForWorkspace(auth.admin, auth.workspaceId)
    if (result.status === 'ERROR') return NextResponse.json({ error: '보낸 의견을 불러오지 못했어요. 비어 있는 것이 아니에요.' }, { status: 500, headers: NO_STORE })
    return NextResponse.json({ items: result.items }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: '보낸 의견을 불러오지 못했어요. 비어 있는 것이 아니에요.' }, { status: 500, headers: NO_STORE })
  }
}

/** 삭제 요청: 내가 보낸 의견을 목록에서 바로 지우고, 보관 기간(30일)이 지나면 완전히 삭제한다. */
export async function DELETE(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth
    const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('id'))
    if (!id.success) return NextResponse.json({ error: '지울 의견을 확인해 주세요.' }, { status: 422, headers: NO_STORE })
    const result = await requestFeedbackDeletion(auth.admin, { workspaceId: auth.workspaceId, id: id.data, userId: auth.userId })
    if (!result.ok) return NextResponse.json({ error: '지울 수 있는 의견을 찾지 못했어요.' }, { status: 404, headers: NO_STORE })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ error: '삭제 요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.' }, { status: 500, headers: NO_STORE })
  }
}
