export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { normalizeBookingStartsAtKst } from '@/features/kakao/notify/normalize-booking-time'

const NO_STORE = { 'Cache-Control': 'no-store' }

const cancelSchema = z.object({
  action: z.literal('cancel'),
  reason: z
    .string()
    .trim()
    .min(1, '취소 사유를 입력해 주세요.')
    .max(200, '취소 사유는 200자 이내로 입력해 주세요.'),
})

const rescheduleSchema = z.object({
  action: z.literal('reschedule'),
  bookingStartsAt: z
    .string()
    .trim()
    .min(1, '변경할 예약 일시를 입력해 주세요.'),
})

const confirmSchema = z.object({
  action: z.literal('confirm'),
})

const declineSchema = z.object({
  action: z.literal('decline'),
  reason: z
    .string()
    .trim()
    .min(1, '거절 사유를 입력해 주세요.')
    .max(200, '거절 사유는 200자 이내로 입력해 주세요.'),
})

const patchBodySchema = z.discriminatedUnion('action', [
  cancelSchema,
  rescheduleSchema,
  confirmSchema,
  declineSchema,
])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; reservationId: string }> }
) {
  const { workspaceId, reservationId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return auth

    const body = await request.json().catch(() => null)
    const parsed = patchBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '올바른 요청 정보를 입력해 주세요.' },
        { status: 422, headers: NO_STORE }
      )
    }

    const admin = auth.admin

    let normalizedBookingStartsAt: string | null = null
    if (parsed.data.action === 'reschedule') {
      normalizedBookingStartsAt = normalizeBookingStartsAtKst(parsed.data.bookingStartsAt)
      if (!normalizedBookingStartsAt) {
        return NextResponse.json(
          { error: '올바른 예약 일시를 입력해 주세요.' },
          { status: 400, headers: NO_STORE }
        )
      }
    }

    // 예약 조회 및 workspace 소유권 검증 (다른 workspace 소유는 404)
    const { data: reservation, error: fetchErr } = await admin
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .maybeSingle()

    if (fetchErr) {
      return NextResponse.json(
        { error: '예약 정보를 조회하지 못했습니다.' },
        { status: 500, headers: NO_STORE }
      )
    }

    if (!reservation || reservation.workspace_id !== auth.workspaceId) {
      return NextResponse.json(
        { error: '예약을 찾을 수 없습니다.' },
        { status: 404, headers: NO_STORE }
      )
    }

    if (parsed.data.action === 'cancel') {
      const { reason } = parsed.data

      // 이미 CANCELLED 상태면 멱등 200 + 'already' 반환
      if (reservation.status === 'CANCELLED') {
        return NextResponse.json(
          { ok: true, status: 'already', reservationId },
          { status: 200, headers: NO_STORE }
        )
      }

      const nowIso = new Date().toISOString()
      // DB 트리거(trg_kakao_enqueue_reservation_outbox)가 BOOKING_CANCELLED 이벤트를 적재할 수 있도록
      // reservations UPDATE 로 수행한다.
      const { data: updatedReservation, error: updateErr } = await admin
        .from('reservations')
        .update({
          status: 'CANCELLED',
          cancel_reason: reason,
          cancelled_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', reservationId)
        .eq('workspace_id', auth.workspaceId)
        .select('*')
        .single()

      if (updateErr || !updatedReservation) {
        return NextResponse.json(
          { error: '예약 취소를 저장하지 못했습니다.' },
          { status: 500, headers: NO_STORE }
        )
      }

      return NextResponse.json(
        { ok: true, status: 'cancelled', reservationId },
        { status: 200, headers: NO_STORE }
      )
    }

    if (parsed.data.action === 'reschedule') {
      // 상태가 CONFIRMED인 예약만 변경 가능
      if (reservation.status !== 'CONFIRMED') {
        return NextResponse.json(
          { error: '확정된 상태의 예약만 일정을 변경할 수 있습니다.' },
          { status: 409, headers: NO_STORE }
        )
      }

      const existingMetadata =
        reservation.metadata && typeof reservation.metadata === 'object'
          ? { ...reservation.metadata }
          : {}

      const currentStartsAt = existingMetadata.bookingStartsAt || existingMetadata.startsAt
      if (currentStartsAt && currentStartsAt === normalizedBookingStartsAt) {
        return NextResponse.json(
          { error: '기존 예약 일시와 동일합니다.' },
          { status: 400, headers: NO_STORE }
        )
      }

      // DB 트리거(20261106090000_kakao_reservation_previous_start)가 BEFORE UPDATE에서
      // NEW.metadata.previousBookingStartsAt에 OLD의 시작일시를 자동으로 저장하므로,
      // 애플리케이션에서는 previousBookingStartsAt을 수동으로 넣지 않고(중복 저장 방지)
      // bookingStartsAt만 최신으로 갱신한다.
      const newMetadata = {
        ...existingMetadata,
        bookingStartsAt: normalizedBookingStartsAt!,
      }

      const nowIso = new Date().toISOString()
      // 알림 트리거 조건: slot_id 또는 metadata.bookingStartsAt 변경 감지
      // reservations UPDATE 로 수행하여 DB 트리거가 BOOKING_CHANGED 이벤트를 적재하도록 한다.
      const { data: updatedReservation, error: updateErr } = await admin
        .from('reservations')
        .update({
          metadata: newMetadata,
          updated_at: nowIso,
        })
        .eq('id', reservationId)
        .eq('workspace_id', auth.workspaceId)
        .select('*')
        .single()

      if (updateErr || !updatedReservation) {
        return NextResponse.json(
          { error: '예약 변경을 저장하지 못했습니다.' },
          { status: 500, headers: NO_STORE }
        )
      }

      return NextResponse.json(
        { ok: true, status: 'rescheduled', reservationId },
        { status: 200, headers: NO_STORE }
      )
    }

    if (parsed.data.action === 'confirm') {
      if (reservation.status !== 'AWAITING_CONFIRMATION') {
        return NextResponse.json(
          { error: '확정 대기 상태의 예약 신청만 확정할 수 있습니다.' },
          { status: 409, headers: NO_STORE }
        )
      }

      const nowIso = new Date().toISOString()
      const { data: updatedReservation, error: updateErr } = await admin
        .from('reservations')
        .update({
          status: 'CONFIRMED',
          confirmed_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', reservationId)
        .eq('workspace_id', auth.workspaceId)
        .select('*')
        .single()

      if (updateErr || !updatedReservation) {
        return NextResponse.json(
          { error: '예약 확정을 저장하지 못했습니다.' },
          { status: 500, headers: NO_STORE }
        )
      }

      return NextResponse.json(
        { ok: true, status: 'confirmed', reservationId },
        { status: 200, headers: NO_STORE }
      )
    }

    if (parsed.data.action === 'decline') {
      if (reservation.status !== 'AWAITING_CONFIRMATION') {
        return NextResponse.json(
          { error: '확정 대기 상태의 예약 신청만 거절할 수 있습니다.' },
          { status: 409, headers: NO_STORE }
        )
      }

      const { reason } = parsed.data
      const existingMetadata =
        reservation.metadata && typeof reservation.metadata === 'object'
          ? { ...reservation.metadata }
          : {}

      const newMetadata = {
        ...existingMetadata,
        requestDeclined: true,
      }

      const nowIso = new Date().toISOString()
      const { data: updatedReservation, error: updateErr } = await admin
        .from('reservations')
        .update({
          status: 'CANCELLED',
          cancel_reason: reason,
          cancelled_at: nowIso,
          metadata: newMetadata,
          updated_at: nowIso,
        })
        .eq('id', reservationId)
        .eq('workspace_id', auth.workspaceId)
        .select('*')
        .single()

      if (updateErr || !updatedReservation) {
        return NextResponse.json(
          { error: '예약 거절을 저장하지 못했습니다.' },
          { status: 500, headers: NO_STORE }
        )
      }

      return NextResponse.json(
        { ok: true, status: 'declined', reservationId },
        { status: 200, headers: NO_STORE }
      )
    }

    return NextResponse.json(
      { error: '올바른 요청 정보를 입력해 주세요.' },
      { status: 422, headers: NO_STORE }
    )
  } catch (err: any) {
    console.error('[reservations/[reservationId]/PATCH] Error:', err)
    return NextResponse.json(
      { error: '예약 정보를 처리하지 못했습니다.' },
      { status: 500, headers: NO_STORE }
    )
  }
}
