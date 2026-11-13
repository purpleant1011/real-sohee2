export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import {
  maskPhoneE164,
  type CanonicalCustomerItem,
  type CanonicalCustomersResponse,
} from '@/features/customers/canonical-contract'

const NO_STORE = { 'Cache-Control': 'no-store' }

function extractBookingStartsAt(res: any): string | null {
  const meta = res?.metadata
  if (meta && typeof meta === 'object') {
    if (typeof meta.bookingStartsAt === 'string' && meta.bookingStartsAt.trim()) {
      return meta.bookingStartsAt.trim()
    }
    if (typeof meta.startsAt === 'string' && meta.startsAt.trim()) {
      return meta.startsAt.trim()
    }
  }
  if (typeof res?.booking_starts_at === 'string' && res.booking_starts_at.trim()) {
    return res.booking_starts_at.trim()
  }
  if (typeof res?.starts_at === 'string' && res.starts_at.trim()) {
    return res.starts_at.trim()
  }
  return null
}

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

    const q = searchParams.get('q')?.trim() || null

    const admin = createAdminSupabaseClient()

    let custQuery = (admin as any)
      .from('customers')
      .select('id, display_name, phone_e164, updated_at')
      .eq('workspace_id', auth.workspaceId)

    if (q) {
      custQuery = custQuery.ilike('display_name', `%${q}%`)
    }

    custQuery = custQuery.order('updated_at', { ascending: false }).limit(limit)

    const { data: customerRows, error: custErr } = await custQuery
    if (custErr) {
      throw custErr
    }

    const customers: any[] = customerRows ?? []
    if (customers.length === 0) {
      const emptyResponse: CanonicalCustomersResponse = {
        ok: true,
        items: [],
      }
      return NextResponse.json(emptyResponse, { headers: NO_STORE })
    }

    const customerUuids = customers.map((c) => c.id).filter(Boolean)

    let reservations: any[] = []
    if (customerUuids.length > 0) {
      const { data: resRows, error: resErr } = await (admin as any)
        .from('reservations')
        .select('id, customer_uuid, metadata, created_at')
        .eq('workspace_id', auth.workspaceId)
        .in('customer_uuid', customerUuids)

      if (resErr) {
        throw resErr
      }
      reservations = resRows ?? []
    }

    let conversations: any[] = []
    if (customerUuids.length > 0) {
      try {
        const { data: convRows, error: convErr } = await (admin as any)
          .from('customer_conversations')
          .select('id, customer_uuid, channel, summary, display_label, latest_message_at, updated_at')
          .eq('workspace_id', auth.workspaceId)
          .in('customer_uuid', customerUuids)

        if (!convErr && Array.isArray(convRows)) {
          conversations = convRows
        }
      } catch {
        // fail-open
      }
    }

    // 메모리 집계 (고객당 N+1 쿼리 방지)
    const resByCustomer = new Map<string, any[]>()
    for (const r of reservations) {
      const cId = r.customer_uuid
      if (!cId) continue
      const list = resByCustomer.get(cId)
      if (list) {
        list.push(r)
      } else {
        resByCustomer.set(cId, [r])
      }
    }

    const convByCustomer = new Map<string, any[]>()
    for (const conv of conversations) {
      const cId = conv.customer_uuid
      if (!cId) continue
      const list = convByCustomer.get(cId)
      if (list) {
        list.push(conv)
      } else {
        convByCustomer.set(cId, [conv])
      }
    }

    const items: CanonicalCustomerItem[] = customers.map((c) => {
      const cReservations = resByCustomer.get(c.id) ?? []
      const reservationCount = cReservations.length

      let lastBookingStartsAt: string | null = null
      if (reservationCount > 0) {
        const startsAtList = cReservations
          .map(extractBookingStartsAt)
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)

        if (startsAtList.length > 0) {
          startsAtList.sort((a, b) => {
            const timeA = Date.parse(a)
            const timeB = Date.parse(b)
            if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
              return timeB - timeA
            }
            return b.localeCompare(a)
          })
          lastBookingStartsAt = startsAtList[0]
        }
      }

      const cConversations = convByCustomer.get(c.id) ?? []
      const conversationCount = cConversations.length
      let lastConversationAt: string | null = null
      if (conversationCount > 0) {
        const atList = cConversations
          .map((row: any) => row.latest_message_at || row.updated_at)
          .filter((s: any): s is string => typeof s === 'string' && s.trim().length > 0)
        if (atList.length > 0) {
          atList.sort((a: string, b: string) => {
            const timeA = Date.parse(a)
            const timeB = Date.parse(b)
            if (!Number.isNaN(timeA) && !Number.isNaN(timeB)) {
              return timeB - timeA
            }
            return b.localeCompare(a)
          })
          lastConversationAt = atList[0]
        }
      }

      return {
        id: c.id,
        displayName: c.display_name,
        phoneMasked: maskPhoneE164(c.phone_e164),
        reservationCount,
        lastBookingStartsAt,
        ...(conversationCount > 0 ? { conversationCount, lastConversationAt } : {}),
      }
    })

    const responseBody: CanonicalCustomersResponse = {
      ok: true,
      items,
    }

    return NextResponse.json(responseBody, { headers: NO_STORE })
  } catch (err: unknown) {
    console.error('[customers/canonical/GET] Failed to list customers:', err)
    return NextResponse.json(
      { error: '고객 목록을 불러오지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
