import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BookingStateMachine,
  assertValidBookingTransition,
  isBookingIntentOnly,
  isBookingConfirmed,
  type BookingStateAggregate,
  type ProposedSlot,
} from '../booking-state-machine'
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'

describe('Booking State Machine & Invariant Separation (ANI-1216, ANI-1194)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const customerId = 'cust-byreum-001'
  const missionId = 'msn-byreum-marketing-001'

  let mockReservationsDb: Record<string, any> = {}
  let mockMissionsDb: Record<string, any> = {}

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'reservations') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              maybeSingle: async () => {
                const match = Object.values(mockReservationsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
          insert: vi.fn().mockImplementation(async (payload: any) => {
            const existing = Object.values(mockReservationsDb).find(
              (r: any) => r.workspace_id === payload.workspace_id && r.slot_id === payload.slot_id && r.status === 'CONFIRMED'
            )
            if (existing) {
              return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
            }
            mockReservationsDb[payload.id] = payload
            return { error: null }
          }),
        }
      }

      if (table === 'marketing_missions') {
        return {
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              single: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
              maybeSingle: async () => {
                const match = Object.values(mockMissionsDb).find(r =>
                  filters.every(f => r[f.col] === f.val)
                )
                return { data: match || null, error: null }
              },
            }
            return chain
          }),
          update: vi.fn().mockImplementation((updates: any) => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              select: () => ({
                single: async () => {
                  const match = Object.values(mockMissionsDb).find(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  if (match) {
                    Object.assign(match, updates)
                    return { data: match, error: null }
                  }
                  return { data: null, error: new Error('Not found') }
                },
              }),
            }
            return chain
          }),
        }
      }

      if (table === 'mission_events') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    },
  } as any

  beforeEach(() => {
    mockReservationsDb = {}
    mockMissionsDb = {}
    ReservationCanonicalService.resetState()

    // Prepopulate active mission in BOOKING_INTENT state
    mockMissionsDb[missionId] = {
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'trc-booking-flow-001',
      status: 'BOOKING_INTENT',
      goal: '바이름 가을 자연눈썹 10명 모객',
      customer_id: customerId,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
  })

  it('1. MUST enforce strict state transition rules and prevent jumping invalid states', () => {
    expect(() => assertValidBookingTransition('NONE', 'INTENT_DETECTED')).not.toThrow()
    expect(() => assertValidBookingTransition('INTENT_DETECTED', 'SLOT_PROPOSED')).not.toThrow()
    expect(() => assertValidBookingTransition('SLOT_PROPOSED', 'CUSTOMER_SELECTED')).not.toThrow()
    expect(() => assertValidBookingTransition('CUSTOMER_SELECTED', 'CONFIRMED')).not.toThrow()
    expect(() => assertValidBookingTransition('CONFIRMED', 'COMPLETED')).not.toThrow()

    // Illegal transitions must throw
    expect(() => assertValidBookingTransition('NONE', 'CONFIRMED')).toThrow(/INVALID_BOOKING_TRANSITION/)
    expect(() => assertValidBookingTransition('INTENT_DETECTED', 'COMPLETED')).toThrow(/INVALID_BOOKING_TRANSITION/)
  })

  it('2. MUST keep INTENT_DETECTED strictly separated from CONFIRMED', () => {
    expect(isBookingIntentOnly('INTENT_DETECTED')).toBe(true)
    expect(isBookingIntentOnly('SLOT_PROPOSED')).toBe(true)
    expect(isBookingIntentOnly('CUSTOMER_SELECTED')).toBe(true)
    expect(isBookingIntentOnly('CONFIRMED')).toBe(false)

    expect(isBookingConfirmed('INTENT_DETECTED')).toBe(false)
    expect(isBookingConfirmed('CUSTOMER_SELECTED')).toBe(false)
    expect(isBookingConfirmed('CONFIRMED')).toBe(true)
    expect(isBookingConfirmed('COMPLETED')).toBe(true)
  })

  it('3. MUST execute full appointment workflow: Propose Slots -> Select Slot -> Confirm Booking & Advance Mission to BOOKED', async () => {
    const sm = new BookingStateMachine(mockSupabaseClient)

    let currentState: BookingStateAggregate = {
      workspaceId,
      customerId,
      missionId,
      status: 'INTENT_DETECTED',
      proposedSlots: [],
      updatedAt: new Date().toISOString(),
    }

    // A. Propose 2 candidate slots
    const candidateSlots: ProposedSlot[] = [
      {
        slotId: '2026-09-12T14:00:00+09:00',
        label: '9월 12일(토) 14:00',
        startsAt: '2026-09-12T14:00:00+09:00',
        endsAt: '2026-09-12T15:30:00+09:00',
        available: true,
      },
      {
        slotId: '2026-09-12T16:00:00+09:00',
        label: '9월 12일(토) 16:00',
        startsAt: '2026-09-12T16:00:00+09:00',
        endsAt: '2026-09-12T17:30:00+09:00',
        available: true,
      },
    ]

    currentState = sm.proposeSlots({
      currentState,
      slots: candidateSlots,
    })

    expect(currentState.status).toBe('SLOT_PROPOSED')
    expect(currentState.proposedSlots.length).toBe(2)

    // B. Customer selects 14:00 slot
    currentState = sm.selectSlot({
      currentState,
      selectedSlotId: '2026-09-12T14:00:00+09:00',
    })

    expect(currentState.status).toBe('CUSTOMER_SELECTED')
    expect(currentState.selectedSlot?.slotId).toBe('2026-09-12T14:00:00+09:00')

    // C. Confirm Booking
    const { state: finalState, reservation } = await sm.confirmBooking({
      workspaceId,
      slotId: '2026-09-12T14:00:00+09:00',
      customerId,
      customerName: '김서연 고객님',
      customerPhone: '010-9999-8888',
      serviceId: 'srv_natural_eyebrow',
      serviceName: '1:1 맞춤 자연눈썹 시술',
      depositKrw: 30000,
      totalAmountKrw: 180000,
      missionId,
      traceId: 'trc-booking-flow-001',
      channelSource: 'INSTAGRAM_DM',
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: '2026-09-12T14:00:00+09:00',
        channelSource: 'INSTAGRAM_DM',
      },
    })

    expect(finalState.status).toBe('CONFIRMED')
    expect(reservation.bookingId).toBeDefined()
    expect(reservation.status).toBe('CONFIRMED')
    expect(reservation.depositKrw).toBe(30000)
    expect(reservation.totalAmountKrw).toBe(180000)

    // DB reservation row check
    expect(mockReservationsDb[reservation.bookingId]).toBeDefined()

    // Mission must now be BOOKED with booking_id bound!
    const updatedMission = mockMissionsDb[missionId]
    expect(updatedMission.status).toBe('BOOKED')
    expect(updatedMission.booking_id).toBe(reservation.bookingId)
    expect(updatedMission.customer_id).toBe(customerId)
  })

  it('4. MUST prevent double-booking collisions on the same slot', async () => {
    const sm = new BookingStateMachine(mockSupabaseClient)
    const slotId = '2026-09-13T11:00:00+09:00'

    // Customer A books slot
    await sm.confirmBooking({
      workspaceId,
      slotId,
      customerId: 'cust-A',
      customerName: '고객A',
      serviceId: 'srv_natural_eyebrow',
      serviceName: '1:1 맞춤 자연눈썹 시술',
      totalAmountKrw: 180000,
      missionId,
      traceId: 'trc-booking-flow-001',
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: slotId,
        channelSource: 'INSTAGRAM_DM',
      },
    })

    // Customer B tries to book same slot
    await expect(
      sm.confirmBooking({
        workspaceId,
        slotId,
        customerId: 'cust-B',
        customerName: '고객B',
        serviceId: 'srv_natural_eyebrow',
        serviceName: '1:1 맞춤 자연눈썹 시술',
        totalAmountKrw: 180000,
        customerAcceptedProof: {
          consentType: 'CUSTOMER_SELECTED_SLOT',
          consentTimestamp: new Date().toISOString(),
          selectedSlotId: slotId,
          channelSource: 'INSTAGRAM_DM',
        },
      })
    ).rejects.toThrow(/SLOT_ALREADY_RESERVED/)
  })
})
