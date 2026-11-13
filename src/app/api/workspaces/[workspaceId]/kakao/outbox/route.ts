export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  toKakaoHistoryItem,
  type KakaoHistoryItem,
  type KakaoHistoryResponse,
  type KakaoOutboxRowLike,
} from '@/features/kakao/history/contract'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth
    if (auth.workspaceId !== workspaceId) {
      return NextResponse.json({ error: '접근 권한이 없습니다.' }, { status: 403, headers: NO_STORE })
    }

    const { searchParams } = new URL(request.url)
    const limitRaw = searchParams.get('limit')
    let limit = 50

    if (limitRaw !== null) {
      const parsedLimit = Number(limitRaw)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return NextResponse.json(
          { error: 'limit은 1에서 100 사이의 정수여야 해요.' },
          { status: 400, headers: NO_STORE }
        )
      }
      limit = parsedLimit
    }

    const reservationId = searchParams.get('reservationId')?.trim() || null
    const customerId = searchParams.get('customerId')?.trim() || null
    const customerUuid = searchParams.get('customerUuid')?.trim() || null

    const admin = createAdminSupabaseClient()

    let reservationIds: string[] | null = null
    if (customerUuid) {
      const { data: resRows, error: resErr } = await (admin as any)
        .from('reservations')
        .select('id')
        .eq('workspace_id', auth.workspaceId)
        .eq('customer_uuid', customerUuid)
        .limit(200)

      if (resErr) {
        throw resErr
      }

      const ids = (resRows ?? []).map((r: { id: string }) => r.id).filter(Boolean)
      if (ids.length === 0) {
        const emptyResponse: KakaoHistoryResponse = { ok: true, items: [] }
        return NextResponse.json(emptyResponse, { headers: NO_STORE })
      }
      reservationIds = ids
    } else if (customerId) {
      const { data: resRows, error: resErr } = await (admin as any)
        .from('reservations')
        .select('id')
        .eq('workspace_id', auth.workspaceId)
        .eq('customer_id', customerId)
        .limit(200)

      if (resErr) {
        throw resErr
      }

      const ids = (resRows ?? []).map((r: { id: string }) => r.id).filter(Boolean)
      if (ids.length === 0) {
        const emptyResponse: KakaoHistoryResponse = { ok: true, items: [] }
        return NextResponse.json(emptyResponse, { headers: NO_STORE })
      }
      reservationIds = ids
    }

    let query = (admin as any)
      .from('kakao_notification_outbox')
      .select('id, reservation_id, event, status, reason_code, delivery_status, due_at, updated_at')
      .eq('workspace_id', auth.workspaceId)

    if (reservationIds !== null) {
      query = query.in('reservation_id', reservationIds)
    }
    if (reservationId) {
      query = query.eq('reservation_id', reservationId)
    }

    query = query.order('updated_at', { ascending: false }).limit(limit)

    const { data: rows, error: outboxErr } = await query
    if (outboxErr || !Array.isArray(rows)) {
      throw outboxErr ?? new Error('KAKAO_OUTBOX_QUERY_FAILED')
    }

    const items: KakaoHistoryItem[] = (rows as KakaoOutboxRowLike[])
      .map(toKakaoHistoryItem)
      .filter((item): item is KakaoHistoryItem => item !== null)

    const responseBody: KakaoHistoryResponse = {
      ok: true,
      items,
    }

    return NextResponse.json(responseBody, { headers: NO_STORE })
  } catch (err: unknown) {
    console.error('[kakao/outbox/GET] Failed to list outbox:', err)
    return NextResponse.json(
      { error: '알림톡 발송 내역을 불러오지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
