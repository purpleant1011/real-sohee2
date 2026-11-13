export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { verifyRequestToken, getPassTokenSecret } from '@/features/booking-request/request-token'
import { normalize010Phone } from '@/features/kakao/notify/outbox-processor'
import { normalizeBookingStartsAtKst } from '@/features/kakao/notify/normalize-booking-time'
import { buildCustomerConsentEvidenceRow } from '@/features/kakao/notify/customer-consent-evidence'
import { resolveCanonicalCustomer } from '@/features/customers/canonical-customer'
import { linkCustomerIdentity } from '@/features/customers/customer-identity-service'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} as const

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(
      { ok: false, error: '올바른 요청 형식(JSON)이 아닙니다.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 1. Honeypot check: If website is present and non-empty, silently ignore with 200 OK
  const website = typeof body?.website === 'string' ? body.website.trim() : ''
  if (website) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  // 2. Secret check: Must have PASS_TOKEN_SECRET configured
  const secret = getPassTokenSecret()
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: '예약 신청 서비스를 현재 이용할 수 없습니다.' },
      { status: 503, headers: NO_STORE },
    )
  }

  // 3. Token verification
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return NextResponse.json(
      { ok: false, error: '예약 링크 정보가 누락되었습니다.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const tokenResult = await verifyRequestToken(token, { secret })
  if (!tokenResult.ok) {
    const errorMsg = tokenResult.reason === 'expired'
      ? '만료된 예약 링크입니다. 매장에 다시 문의해 주세요.'
      : '유효하지 않은 예약 링크입니다.'
    return NextResponse.json(
      { ok: false, error: errorMsg },
      { status: 400, headers: NO_STORE },
    )
  }

  const { workspaceId } = tokenResult.payload

  // 4. Consent verification
  if (body?.consent !== true) {
    return NextResponse.json(
      { ok: false, error: '개인정보 수집 및 이용에 동의해 주세요.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 5. Customer name verification (1~50 chars)
  const rawCustomerName = typeof body?.customerName === 'string' ? body.customerName.trim() : ''
  if (!rawCustomerName || rawCustomerName.length > 50) {
    return NextResponse.json(
      { ok: false, error: '이름을 1자 이상 50자 이하로 입력해 주세요.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 6. Phone number verification (010 domestic mobile)
  const rawCustomerPhone = typeof body?.customerPhone === 'string' ? body.customerPhone.trim() : ''
  const normalizedPhone = normalize010Phone(rawCustomerPhone)
  if (!normalizedPhone) {
    return NextResponse.json(
      { ok: false, error: '올바른 휴대폰 번호를 입력해 주세요.' },
      { status: 400, headers: NO_STORE },
    )
  }

  // 7. Desired start time verification (KST, must be future)
  const rawDesiredStartsAt = typeof body?.desiredStartsAt === 'string' ? body.desiredStartsAt.trim() : ''
  const normalizedBookingStartsAt = normalizeBookingStartsAtKst(rawDesiredStartsAt)
  if (!normalizedBookingStartsAt) {
    return NextResponse.json(
      { ok: false, error: '올바른 예약 일시를 입력해 주세요.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const bookingTimeMs = new Date(normalizedBookingStartsAt).getTime()
  if (Number.isNaN(bookingTimeMs) || bookingTimeMs <= Date.now()) {
    return NextResponse.json(
      { ok: false, error: '예약 일시는 현재 시간 이후로 선택해 주세요.' },
      { status: 400, headers: NO_STORE },
    )
  }

  const admin = createAdminSupabaseClient() as any

  // 8. Rate limiting / duplicate booking check within 10 minutes
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count, error: countErr } = await admin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('customer_phone', normalizedPhone)
      .eq('status', 'AWAITING_CONFIRMATION')
      .gte('created_at', tenMinutesAgo)

    if (!countErr && count !== null && count >= 3) {
      return NextResponse.json(
        { ok: false, error: '단시간 내 예약 신청이 많습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 429, headers: NO_STORE },
      )
    }
  } catch {
    // Fail-open for count check to prevent hard outage on count RPC failure
  }

  // 9. Resolve canonical customer UUID
  let customerUuid: string | null = null
  try {
    const canonical = await resolveCanonicalCustomer({
      admin,
      workspaceId,
      displayName: rawCustomerName,
      phone010: normalizedPhone,
    })
    customerUuid = canonical.customerUuid
  } catch {
    customerUuid = null
  }

  // 10. Extract thread ID (if present in body or token payload)
  const rawThreadId =
    (typeof body?.dmThreadId === 'string' && body.dmThreadId.trim()) ||
    (typeof body?.igThreadId === 'string' && body.igThreadId.trim()) ||
    (typeof tokenResult.payload?.dmThreadId === 'string' && tokenResult.payload.dmThreadId.trim()) ||
    (typeof tokenResult.payload?.igThreadId === 'string' && tokenResult.payload.igThreadId.trim()) ||
    null

  // 11. Insert reservation in AWAITING_CONFIRMATION status
  const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const nowIso = new Date().toISOString()
  const reservationPayload: Record<string, unknown> = {
    id: reservationId,
    workspace_id: workspaceId,
    slot_id: `slot_req_${Date.now()}`,
    customer_id: `req_${Math.random().toString(36).slice(2, 10)}`,
    customer_name: rawCustomerName,
    customer_phone: normalizedPhone,
    service_id: 'srv_custom',
    service_name: '예약 신청',
    status: 'AWAITING_CONFIRMATION',
    deposit_krw: 0,
    total_amount_krw: 0,
    channel_source: 'CUSTOMER_REQUEST',
    metadata: {
      source: 'customer_request',
      bookingStartsAt: normalizedBookingStartsAt,
      ...(rawThreadId ? { dmThreadId: rawThreadId } : {}),
    },
    created_at: nowIso,
    updated_at: nowIso,
  }

  if (customerUuid) {
    reservationPayload.customer_uuid = customerUuid
  }

  const { error: insertErr } = await admin
    .from('reservations')
    .insert(reservationPayload)
    .select('*')
    .single()

  if (insertErr) {
    console.error('[booking-request/POST] reservation insertion failed')
    return NextResponse.json(
      { ok: false, error: '예약 신청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: NO_STORE },
    )
  }

  // 12. Link customer identity if thread ID and customerUuid are available
  if (customerUuid && rawThreadId) {
    try {
      let subjectRef = rawThreadId
      const { data: thread } = await admin
        .from('instagram_dm_threads')
        .select('customer_id')
        .eq('workspace_id', workspaceId)
        .eq('id', rawThreadId)
        .maybeSingle()

      if (thread?.customer_id) {
        subjectRef = thread.customer_id
      } else {
        const { data: conv } = await admin
          .from('customer_conversations')
          .select('customer_id, external_subject_reference_hash')
          .eq('workspace_id', workspaceId)
          .eq('id', rawThreadId)
          .maybeSingle()
        if (conv?.customer_id) {
          subjectRef = conv.customer_id
        } else if (conv?.external_subject_reference_hash) {
          subjectRef = conv.external_subject_reference_hash
        }
      }

      await linkCustomerIdentity({
        admin,
        workspaceId,
        customerUuid,
        channel: 'INSTAGRAM',
        subjectRef,
      })
    } catch {
      // Fail-open
    }
  }

  // 13. Record customer form consent evidence
  try {
    const evidenceRow = buildCustomerConsentEvidenceRow({
      workspaceId,
      reservationId,
      phone: normalizedPhone,
      consent: true,
      recordedAt: new Date(),
    })

    if (evidenceRow) {
      const { error: evidenceErr } = await admin
        .from('kakao_notification_evidence')
        .insert(evidenceRow)

      if (evidenceErr) {
        console.warn('[booking-request/POST] kakao notification evidence insert warning')
      }
    }
  } catch {
    console.warn('[booking-request/POST] kakao notification evidence recording failed')
  }

  // 12. Response: Echo nothing except { ok: true }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
