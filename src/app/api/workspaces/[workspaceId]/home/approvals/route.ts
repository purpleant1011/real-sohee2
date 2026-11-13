export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import {
  fetchPendingHomeApprovals,
  executeBatchHomeApprovals,
} from '@/features/home/home-approval-service'

const NO_STORE = { 'Cache-Control': 'no-store' }

type Ctx = { params: Promise<{ workspaceId: string }> }

const batchActionSchema = z.object({
  action: z.enum(['approve', 'dismiss']),
  itemIds: z.array(z.string()).optional(),
  all: z.boolean().optional(),
  createBooking: z.boolean().optional(),
  fingerprints: z.record(z.string(), z.string()).optional(),
})

export async function GET(_req: Request, { params }: Ctx) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const data = await fetchPendingHomeApprovals(auth.admin, auth.workspaceId)
    return NextResponse.json({ success: true, data }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    console.error('[GET /api/home/approvals] Error:', err)
    return NextResponse.json(
      { success: false, error: '승인 대기 항목을 불러오지 못했어요.' },
      { status: 500, headers: NO_STORE }
    )
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { workspaceId } = await params
  const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
  if (isResponse(auth)) return auth

  try {
    const body = await req.json().catch(() => null)
    const parsed = batchActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: '올바른 승인 요청 형식이 아닙니다.' },
        { status: 400, headers: NO_STORE }
      )
    }

    if (parsed.data.action === 'approve') {
      return NextResponse.json(
        { success: false, code: 'REVIEW_REQUIRED', error: '전체 내용을 검토한 뒤 안전한 실행 경로를 이용해 주세요.' },
        { status: 409, headers: NO_STORE },
      )
    }

    const result = await executeBatchHomeApprovals(
      auth.admin,
      auth.workspaceId,
      parsed.data,
      { userId: auth.userId, role: auth.role === 'owner' ? 'owner' : 'manager' }
    )

    return NextResponse.json({ success: true, data: result }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    console.error('[POST /api/home/approvals] Error:', err)
    return NextResponse.json(
      { success: false, error: '승인 처리를 완료하지 못했어요.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
