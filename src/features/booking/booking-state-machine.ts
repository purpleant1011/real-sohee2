import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  ReservationCanonicalService,
  type CanonicalReservation,
  type CreateReservationParams,
} from '@/features/reservations/reservation-canonical-service'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'

export type BookingStatus =
  | 'NONE'
  | 'INTENT_DETECTED'
  | 'SLOT_DISCOVERY'
  | 'SLOT_PROPOSED'
  | 'CUSTOMER_SELECTED'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'HUMAN_REVIEW'

export const VALID_BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  NONE: ['INTENT_DETECTED'],
  INTENT_DETECTED: ['SLOT_DISCOVERY', 'SLOT_PROPOSED', 'DECLINED', 'HUMAN_REVIEW'],
  SLOT_DISCOVERY: ['SLOT_PROPOSED', 'HUMAN_REVIEW', 'DECLINED'],
  SLOT_PROPOSED: ['CUSTOMER_SELECTED', 'SLOT_DISCOVERY', 'EXPIRED', 'DECLINED', 'HUMAN_REVIEW'],
  CUSTOMER_SELECTED: ['AWAITING_CONFIRMATION', 'CONFIRMED', 'SLOT_PROPOSED', 'CANCELLED', 'HUMAN_REVIEW'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'HUMAN_REVIEW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  DECLINED: ['INTENT_DETECTED'],
  EXPIRED: ['SLOT_PROPOSED', 'INTENT_DETECTED'],
  CANCELLED: ['INTENT_DETECTED'],
  HUMAN_REVIEW: ['SLOT_PROPOSED', 'CONFIRMED', 'CANCELLED', 'DECLINED'],
}

export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  return VALID_BOOKING_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertValidBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (!isValidBookingTransition(from, to)) {
    throw new Error(
      `[INVALID_BOOKING_TRANSITION] Cannot transition booking status from '${from}' to '${to}'`
    )
  }
}

/**
 * Strict Rule: INTENT_DETECTED is NOT CONFIRMED.
 * Ensures the agent and UI never treat mere expression of intent as a finalized booking.
 */
export function isBookingIntentOnly(status: BookingStatus): boolean {
  return [
    'INTENT_DETECTED',
    'SLOT_DISCOVERY',
    'SLOT_PROPOSED',
    'CUSTOMER_SELECTED',
    'AWAITING_CONFIRMATION',
  ].includes(status)
}

export function isBookingConfirmed(status: BookingStatus): boolean {
  return status === 'CONFIRMED' || status === 'COMPLETED'
}

export interface ProposedSlot {
  slotId: string
  label: string
  startsAt: string
  endsAt: string
  available: boolean
}

export interface BookingStateAggregate {
  workspaceId: string
  customerId: string
  missionId?: string | null
  status: BookingStatus
  proposedSlots: ProposedSlot[]
  selectedSlot?: ProposedSlot | null
  confirmedBooking?: CanonicalReservation | null
  updatedAt: string
}

export interface CustomerAcceptedProof {
  consentType: 'CUSTOMER_SELECTED_SLOT' | 'CUSTOMER_ACCEPTED_PROPOSAL' | 'CUSTOMER_AFFIRMED'
  consentTimestamp: string
  selectedSlotId?: string
  proofDigest?: string
  channelSource?: string
}

export interface ConfirmBookingInput {
  workspaceId: string
  slotId: string
  customerId: string
  customerAcceptedProof?: CustomerAcceptedProof
  customerName?: string
  customerPhone?: string
  serviceId?: string
  serviceName?: string
  depositKrw?: number
  totalAmountKrw?: number
  missionId?: string | null
  traceId?: string | null
  channelSource?: string
  actorUserId?: string
}

export class BookingStateMachine {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Proposes candidate schedule slots to a customer who expressed intent.
   */
  public proposeSlots(params: {
    currentState: BookingStateAggregate
    slots: ProposedSlot[]
  }): BookingStateAggregate {
    const { currentState, slots } = params
    assertValidBookingTransition(currentState.status, 'SLOT_PROPOSED')

    return {
      ...currentState,
      status: 'SLOT_PROPOSED',
      proposedSlots: slots,
      updatedAt: new Date().toISOString(),
    }
  }

  /**
   * Customer selects one of the proposed slots.
   */
  public selectSlot(params: {
    currentState: BookingStateAggregate
    selectedSlotId: string
  }): BookingStateAggregate {
    const { currentState, selectedSlotId } = params
    assertValidBookingTransition(currentState.status, 'CUSTOMER_SELECTED')

    const selected = currentState.proposedSlots.find(s => s.slotId === selectedSlotId)
    if (!selected) {
      throw new Error(`[SLOT_NOT_FOUND] Selected slot '${selectedSlotId}' not among proposed slots`)
    }

    return {
      ...currentState,
      status: 'CUSTOMER_SELECTED',
      selectedSlot: selected,
      updatedAt: new Date().toISOString(),
    }
  }

  /**
   * Atomically confirms appointment reservation:
   * 1. Validates customer acceptance proof (Fail-closed against direct confirm).
   * 2. Validates verified service details (No hardcoded fallback).
   * 3. Acquires slot lock and records canonical reservation in Supabase.
   * 4. Transitions related Marketing Mission to BOOKED without split-brain.
   */
  public async confirmBooking(input: ConfirmBookingInput): Promise<{
    state: BookingStateAggregate
    reservation: CanonicalReservation
  }> {
    // 1. Direct Confirm Guard: 고객 수락 증빙 필수화 (ANI-1249)
    if (!input.customerAcceptedProof) {
      throw new Error(
        `[DIRECT_CONFIRM_FORBIDDEN] Cannot confirm booking without explicit customerAcceptedProof. Direct confirm is strictly prohibited.`
      )
    }

    // 2. Verified Service & Price Requirement: 하드코딩된 fallback 제거 (ANI-1248, ANI-1249)
    if (!input.serviceId || !input.serviceName || typeof input.totalAmountKrw !== 'number') {
      throw new Error(
        `[SERVICE_SPECIFICATION_REQUIRED] serviceId, serviceName, and totalAmountKrw must be explicitly provided from verified catalog.`
      )
    }

    const {
      workspaceId,
      slotId,
      customerId,
      customerName = '고객님',
      customerPhone,
      serviceId,
      serviceName,
      depositKrw = 0,
      totalAmountKrw,
      missionId,
      traceId,
      channelSource = 'INSTAGRAM_DM',
    } = input

    // 3. Atomic reservation creation with slot mutex lock & DB write
    const reservation = await ReservationCanonicalService.createReservation(
      {
        workspaceId,
        slotId,
        customerId,
        customerName,
        customerPhone,
        serviceId,
        serviceName,
        depositKrw,
        totalAmountKrw,
        channelSource,
      },
      this.client
    )

    // 4. Advance Marketing Mission to BOOKED if missionId is provided (Fail-closed cross-context commit · ANI-1273)
    if (missionId) {
      const effectiveTraceId = traceId || `trc-booking-${Date.now()}`
      try {
        const missionService = new MarketingMissionService(this.client)

        // Transition mission to BOOKED
        await missionService.transitionMission({
          workspaceId,
          missionId,
          traceId: effectiveTraceId,
          toStatus: 'BOOKED',
          actorType: 'system',
          reason: `예약 확정 완료: 슬롯 [${slotId}], 예약번호 [${reservation.bookingId}]`,
          downstreamUpdates: {
            booking_id: reservation.bookingId,
            customer_id: customerId,
          },
        })

        // Also ensure lineage is bound
        await missionService.bindCustomerAndBooking({
          workspaceId,
          missionId,
          traceId: effectiveTraceId,
          bookingId: reservation.bookingId,
          customerId,
          actorType: 'system',
          reason: 'Bind confirmed booking ID to mission lineage',
        })
      } catch (mErr: any) {
        // Saga Compensation: 미션 전이 실패 시 생성된 reservation을 보상 취소(CANCELLED)하고 RECONCILE_REQUIRED 기록
        try {
          await (this.client as any)
            .from('reservations')
            .update({
              status: 'CANCELLED',
              cancellation_reason: `[CROSS_CONTEXT_COMMIT_COMPENSATION] Mission '${missionId}' transition failed: ${mErr?.message || mErr}`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', reservation.bookingId)

          await (this.client as any)
            .from('audit_events')
            .insert({
              workspace_id: workspaceId,
              trace_id: effectiveTraceId,
              event_type: 'RESERVATION_COMPENSATED_CROSS_COMMIT_FAIL',
              actor_type: 'SYSTEM',
              entity_type: 'RESERVATION',
              entity_id: reservation.bookingId,
              result: 'SUCCESS',
              details: {
                missionId,
                originalError: mErr?.message || String(mErr),
                reconcileState: 'RECONCILE_REQUIRED',
              },
            })
        } catch (compErr) {
          console.error('[BookingStateMachine] Saga compensation failed:', compErr)
        }

        throw new Error(
          `[CROSS_CONTEXT_COMMIT_FAILED] Failed to transition mission '${missionId}' to BOOKED: ${mErr?.message || mErr}`
        )
      }
    }

    const state: BookingStateAggregate = {
      workspaceId,
      customerId,
      missionId,
      status: 'CONFIRMED',
      proposedSlots: [],
      selectedSlot: {
        slotId,
        label: `${slotId} 예약 확정`,
        startsAt: slotId,
        endsAt: slotId,
        available: false,
      },
      confirmedBooking: reservation,
      updatedAt: new Date().toISOString(),
    }

    return { state, reservation }
  }
}
