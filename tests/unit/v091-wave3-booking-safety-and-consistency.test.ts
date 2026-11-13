import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BookingStateMachine,
  type ConfirmBookingInput,
} from '@/features/booking/booking-state-machine'
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'

describe('V0.91 Wave 3 · Booking Safety, Availability & Cross-Context Consistency (ANI-1248, ANI-1249, ANI-1273)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const slotId = '2026-09-12T14:00:00+09:00'
  const customerId = 'cust_777'

  let mockDb: any
  let reservationsTable: Record<string, any>[] = []
  let missionsTable: Record<string, any>[] = []

  beforeEach(() => {
    ReservationCanonicalService.resetState()
    reservationsTable = []
    missionsTable = []

    mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'reservations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((field1: string, val1: any) => ({
                eq: vi.fn((field2: string, val2: any) => ({
                  eq: vi.fn((field3: string, val3: any) => ({
                    maybeSingle: vi.fn(async () => {
                      const item = reservationsTable.find(
                        (r) => r[field1] === val1 && r[field2] === val2 && r[field3] === val3
                      )
                      return { data: item || null, error: null }
                    }),
                  })),
                  maybeSingle: vi.fn(async () => {
                    const item = reservationsTable.find(
                      (r) => r[field1] === val1 && r[field2] === val2
                    )
                    return { data: item || null, error: null }
                  }),
                })),
              })),
            })),
            insert: vi.fn((row: any) => {
              // Check active slot unique index constraint
              const duplicate = reservationsTable.find(
                (r) => r.workspace_id === row.workspace_id && r.slot_id === row.slot_id && r.status === 'CONFIRMED'
              )
              if (duplicate) {
                return {
                  select: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: null,
                      error: { code: '23505', message: 'duplicate key value violates unique constraint idx_reservations_active_slot' }
                    }))
                  }))
                }
              }
              reservationsTable.push(row)
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: row, error: null })),
                })),
              }
            }),
          }
        }
        if (table === 'marketing_missions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((f1: string, v1: any) => ({
                eq: vi.fn((f2: string, v2: any) => ({
                  single: vi.fn(async () => {
                    const item = missionsTable.find((m) => m[f1] === v1 && m[f2] === v2)
                    return { data: item || null, error: item ? null : { message: 'Not found' } }
                  }),
                })),
              })),
            })),
            update: vi.fn((updates: any) => ({
              eq: vi.fn((f1: string, v1: any) => ({
                eq: vi.fn((f2: string, v2: any) => ({
                  select: vi.fn(() => ({
                    single: vi.fn(async () => {
                      const idx = missionsTable.findIndex((m) => m[f1] === v1 && m[f2] === v2)
                      if (idx === -1) return { data: null, error: { message: 'Not found' } }
                      missionsTable[idx] = { ...missionsTable[idx], ...updates }
                      return { data: missionsTable[idx], error: null }
                    }),
                  })),
                })),
              })),
            })),
          }
        }
        if (table === 'mission_events') {
          return {
            insert: vi.fn(async () => ({ error: null })),
          }
        }
        return {
          select: vi.fn(() => ({})),
        }
      }),
    }
  })

  it('1. Blocks direct confirm when customer acceptance proof is absent (ANI-1249)', async () => {
    const sm = new BookingStateMachine(mockDb)

    const invalidDirectConfirmInput: ConfirmBookingInput = {
      workspaceId,
      slotId,
      customerId,
      serviceId: 'srv_brows_custom',
      serviceName: '1:1 맞춤 자연눈썹',
      depositKrw: 30000,
      totalAmountKrw: 150000,
      // customerAcceptedProof missing!
    }

    // Must fail-closed if customer acceptance proof is not provided
    await expect(sm.confirmBooking(invalidDirectConfirmInput)).rejects.toThrow(
      /CUSTOMER_ACCEPTANCE_PROOF_REQUIRED|DIRECT_CONFIRM_FORBIDDEN/
    )
  })

  it('2. Rejects hardcoded default service/pricing fallback when service details are missing (ANI-1248, ANI-1249)', async () => {
    const sm = new BookingStateMachine(mockDb)

    const missingServiceInput: any = {
      workspaceId,
      slotId,
      customerId,
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
      },
      // serviceId missing!
    }

    await expect(sm.confirmBooking(missingServiceInput)).rejects.toThrow(
      /SERVICE_SPECIFICATION_REQUIRED/
    )
  })

  it('3. Confirms booking with full customer acceptance proof & valid catalog service (ANI-1249)', async () => {
    const sm = new BookingStateMachine(mockDb)

    const validInput: ConfirmBookingInput = {
      workspaceId,
      slotId,
      customerId,
      customerName: '홍길동',
      serviceId: 'srv_brows_custom',
      serviceName: '1:1 맞춤 프리미엄 자연눈썹',
      depositKrw: 30000,
      totalAmountKrw: 150000,
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: slotId,
      },
    }

    const result = await sm.confirmBooking(validInput)
    expect(result.state.status).toBe('CONFIRMED')
    expect(result.reservation.bookingId).toBeDefined()
    expect(result.reservation.serviceId).toBe('srv_brows_custom')
    expect(reservationsTable.length).toBe(1)
  })

  it('4. Enforces DB active slot conflict guard on concurrent double-booking (ANI-1249)', async () => {
    const sm = new BookingStateMachine(mockDb)

    const input1: ConfirmBookingInput = {
      workspaceId,
      slotId,
      customerId: 'cust_1',
      serviceId: 'srv_brows_custom',
      serviceName: '1:1 맞춤 프리미엄 자연눈썹',
      depositKrw: 30000,
      totalAmountKrw: 150000,
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: slotId,
      },
    }

    const input2: ConfirmBookingInput = {
      workspaceId,
      slotId,
      customerId: 'cust_2',
      serviceId: 'srv_brows_custom',
      serviceName: '1:1 맞춤 프리미엄 자연눈썹',
      depositKrw: 30000,
      totalAmountKrw: 150000,
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: slotId,
      },
    }

    // First booking succeeds
    const res1 = await sm.confirmBooking(input1)
    expect(res1.state.status).toBe('CONFIRMED')

    // Second booking on same slot must fail with conflict
    await expect(sm.confirmBooking(input2)).rejects.toThrow(
      /SLOT_ALREADY_RESERVED/
    )
  })

  it('5. Enforces atomic cross-context commit between Reservation and Marketing Mission without split-brain (ANI-1273)', async () => {
    const sm = new BookingStateMachine(mockDb)
    const missionId = 'ms_active_123'

    missionsTable.push({
      id: missionId,
      workspace_id: workspaceId,
      trace_id: 'trc_123',
      status: 'AWAITING_APPROVAL',
    })

    const inputWithMission: ConfirmBookingInput = {
      workspaceId,
      slotId: '2026-09-15T10:00:00+09:00',
      customerId: 'cust_100',
      serviceId: 'srv_brows_custom',
      serviceName: '1:1 맞춤 프리미엄 자연눈썹',
      depositKrw: 30000,
      totalAmountKrw: 150000,
      missionId,
      traceId: 'trc_123',
      customerAcceptedProof: {
        consentType: 'CUSTOMER_SELECTED_SLOT',
        consentTimestamp: new Date().toISOString(),
        selectedSlotId: '2026-09-15T10:00:00+09:00',
      },
    }

    const result = await sm.confirmBooking(inputWithMission)
    expect(result.state.status).toBe('CONFIRMED')

    // Cross-context check: Mission must be transitioned to BOOKED and linked
    const updatedMission = missionsTable.find((m) => m.id === missionId)
    expect(updatedMission?.status).toBe('BOOKED')
    expect(updatedMission?.booking_id).toBe(result.reservation.bookingId)
    expect(updatedMission?.customer_id).toBe('cust_100')
  })
})
