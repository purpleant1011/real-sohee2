export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { buildOwnerAttestedEvidenceRow } from '@/features/kakao/notify/evidence-record'
import { normalize010Phone } from '@/features/kakao/notify/outbox-processor'
import { normalizeBookingStartsAtKst } from '@/features/kakao/notify/normalize-booking-time'
import { resolveCanonicalCustomer } from '@/features/customers/canonical-customer'
import { linkCustomerIdentity } from '@/features/customers/customer-identity-service'

const NO_STORE = { 'Cache-Control': 'no-store' }

const createReservationSchema = z.object({
  customerName: z.string().trim().min(1, '고객명을 입력해 주세요.'),
  customerPhone: z.string().trim().optional(),
  serviceName: z.string().trim().min(1, '서비스명을 입력해 주세요.'),
  bookingStartsAt: z.string().datetime({ offset: true }).or(z.string().min(10)),
  totalAmountKrw: z.number().int().min(0).optional().default(0),
  depositKrw: z.number().int().min(0).optional().default(0),
  channelSource: z.string().optional().default('instagram_dm'),
  dmThreadId: z.string().optional(),
  notifyConsentAttested: z.boolean().optional().default(false),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const body = await request.json().catch(() => null)
    const parsed = createReservationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '올바른 예약 정보를 입력해 주세요.' },
        { status: 422, headers: NO_STORE }
      )
    }

    const {
      customerName,
      customerPhone,
      serviceName,
      bookingStartsAt,
      totalAmountKrw,
      depositKrw,
      channelSource,
      dmThreadId,
      notifyConsentAttested,
    } = parsed.data

    let normalizedPhone: string | null = null
    if (customerPhone && customerPhone.trim().length > 0) {
      normalizedPhone = normalize010Phone(customerPhone)
      if (!normalizedPhone) {
        return NextResponse.json(
          { error: '전화번호를 확인해 주세요.' },
          { status: 400, headers: NO_STORE }
        )
      }
    }

    const normalizedBookingStartsAt = normalizeBookingStartsAtKst(bookingStartsAt)
    if (!normalizedBookingStartsAt) {
      return NextResponse.json(
        { error: '올바른 예약 일시를 입력해 주세요.' },
        { status: 400, headers: NO_STORE }
      )
    }

    const admin = auth.admin
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const slotId = `slot_${Date.now()}`
    const nowIso = new Date().toISOString()

    let customerUuid: string | null = null
    if (normalizedPhone) {
      try {
        const canonical = await resolveCanonicalCustomer({
          admin,
          workspaceId: auth.workspaceId,
          displayName: customerName,
          phone010: normalizedPhone,
        })
        customerUuid = canonical.customerUuid
      } catch {
        customerUuid = null
      }
    }

    // DM 연결은 고객의 수락(전화번호 등 정본 확인) 없이는 단축 등록 불가.
    if (dmThreadId && !customerUuid) {
      return NextResponse.json({
        code: 'CUSTOMER_ACCEPTANCE_REVIEW_REQUIRED',
        error: '고객 수락과 서비스·가격·가능 시간을 예약 문의 관리에서 먼저 확인해 주세요.',
      }, { status: 409, headers: NO_STORE })
    }

    const reservationPayload: Record<string, unknown> = {
      id: reservationId,
      workspace_id: auth.workspaceId,
      slot_id: slotId,
      customer_id: customerName,
      customer_name: customerName,
      customer_phone: normalizedPhone,
      service_id: 'srv_custom',
      service_name: serviceName,
      status: 'CONFIRMED',
      deposit_krw: depositKrw,
      total_amount_krw: totalAmountKrw,
      channel_source: channelSource,
      confirmed_at: nowIso,
      metadata: {
        // 사장님/직원이 앱에서 직접 만든 예약. dmThreadId 는 고객 수락 근거가 아니다.
        source: 'owner_created',
        dmThreadId: dmThreadId || null,
        bookingStartsAt: normalizedBookingStartsAt,
      },
      created_at: nowIso,
      updated_at: nowIso,
    }

    if (customerUuid) {
      reservationPayload.customer_uuid = customerUuid
    }

    const { data: reservation, error: resErr } = await admin
      .from('reservations')
      .insert(reservationPayload)
      .select('*')
      .single()

    if (resErr || !reservation) {
      throw new Error(`예약 생성에 실패했습니다: ${resErr?.message || '알 수 없는 오류'}`)
    }

    // dmThreadId가 존재하고 customerUuid가 확인된 경우 식별자 연결 시도
    if (dmThreadId && customerUuid) {
      try {
        let subjectRef = dmThreadId
        const { data: thread } = await admin
          .from('instagram_dm_threads')
          .select('customer_id')
          .eq('workspace_id', auth.workspaceId)
          .eq('id', dmThreadId)
          .maybeSingle()

        if (thread?.customer_id) {
          subjectRef = thread.customer_id
        } else {
          const { data: conv } = await admin
            .from('customer_conversations')
            .select('customer_id, external_subject_reference_hash')
            .eq('workspace_id', auth.workspaceId)
            .eq('id', dmThreadId)
            .maybeSingle()
          if (conv?.customer_id) {
            subjectRef = conv.customer_id
          } else if (conv?.external_subject_reference_hash) {
            subjectRef = conv.external_subject_reference_hash
          }
        }

        await linkCustomerIdentity({
          admin,
          workspaceId: auth.workspaceId,
          customerUuid,
          channel: 'INSTAGRAM',
          subjectRef,
        })
      } catch {
        // Fail-open
      }
    }

    // Optional: update DM thread to SENT or linked state if dmThreadId is provided
    if (dmThreadId) {
      await admin
        .from('instagram_dm_threads')
        .update({
          status: 'SENT',
          updated_at: nowIso,
        })
        .eq('workspace_id', auth.workspaceId)
        .eq('id', dmThreadId)
        .catch(() => {})
    }

    let consentEvidenceRecorded = false
    if (notifyConsentAttested && normalizedPhone) {
      try {
        const evidenceRow = buildOwnerAttestedEvidenceRow({
          workspaceId: auth.workspaceId,
          reservationId: reservation.id,
          phone: normalizedPhone,
          actorUserId: auth.userId,
          attested: notifyConsentAttested,
          recordedAt: new Date(),
        })

        if (evidenceRow) {
          const { error: evidenceErr } = await admin
            .from('kakao_notification_evidence')
            .insert(evidenceRow)

          if (!evidenceErr) {
            consentEvidenceRecorded = true
          } else {
            console.warn('[reservations/POST] kakao notification evidence recording failed')
          }
        }
      } catch {
        console.warn('[reservations/POST] kakao notification evidence recording failed')
      }
    }

    return NextResponse.json({ ok: true, reservation, consentEvidenceRecorded }, { status: 201, headers: NO_STORE })
  } catch (err: any) {
    console.error('[reservations/POST] Failed to create reservation:', err)
    return NextResponse.json({ error: err?.message || '예약을 등록하지 못했습니다.' }, { status: 500, headers: NO_STORE })
  }
}
