import { describe, it, expect, vi } from 'vitest'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'
import { BookingStateMachine } from '@/features/booking/booking-state-machine'
import { ReservationCanonicalService } from '@/features/reservations/reservation-canonical-service'

describe('[RC-02][Regression] Canonical Mission Lifecycle & Booking ID Contract (ANI-1327)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const traceId = 'trc-rc02-test'

  describe('1. Lineage Invariant: transitionMission MUST preserve content_version_id and approval_id', () => {
    it('does not drop existing lineage identifiers during status transition', async () => {
      let storedMission: any = {
        id: 'msn-rc02-lineage-1',
        workspace_id: workspaceId,
        trace_id: traceId,
        status: 'AWAITING_APPROVAL',
        content_id: 'cnt-123',
        content_version_id: 'ver-456',
        approval_id: 'appr-789',
        metadata: { existing_key: 'preserved' },
      }

      const mockClient = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: (_col1: string, _val1: any) => ({
                  eq: (_col2: string, _val2: any) => ({
                    single: async () => ({ data: { ...storedMission }, error: null }),
                  }),
                }),
              }),
              update: (updates: any) => ({
                eq: (_col1: string, _val1: any) => ({
                  eq: (_col2: string, _val2: any) => ({
                    select: () => ({
                      single: async () => {
                        storedMission = { ...storedMission, ...updates }
                        return { data: storedMission, error: null }
                      },
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'mission_events') {
            return {
              insert: async () => ({ error: null }),
            }
          }
          return {}
        },
      }

      const missionService = new MarketingMissionService(mockClient as any)

      // Transition to APPROVED
      await missionService.transitionMission({
        workspaceId,
        missionId: storedMission.id,
        traceId,
        toStatus: 'APPROVED',
        actorType: 'user',
        reason: 'Approval without explicit lineage in downstreamUpdates',
      })

      // Lineage invariant check:
      expect(storedMission.content_id).toBe('cnt-123')
      expect(storedMission.content_version_id).toBe('ver-456')
      expect(storedMission.approval_id).toBe('appr-789')
      expect(storedMission.status).toBe('APPROVED')
    })
  })

  describe('2. Partial Commit Compensation: confirmBooking failure handles compensation', () => {
    it('compensates reservation when mission transition fails with partial commit error', async () => {
      let reservationStatus = 'CONFIRMED'
      let cancelledReason = ''

      // Mock createReservation
      const now = new Date().toISOString()
      vi.spyOn(ReservationCanonicalService, 'createReservation').mockResolvedValueOnce({
        bookingId: 'bk_fail_compensation_test',
        workspaceId,
        customerId: 'hashed_customer_test',
        customerName: '테스트 고객',
        customerPhone: '010-0000-0000',
        slotId: '2026-09-17T15:00:00.000Z',
        serviceId: 'srv-test',
        serviceName: '자연눈썹',
        depositKrw: 30000,
        totalAmountKrw: 200000,
        channelSource: 'INSTAGRAM_DM',
        status: 'CONFIRMED',
        proofId: 'proof-test-123',
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      const mockClient = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => {
                      throw new Error('Database connection failed during mission update')
                    },
                  }),
                }),
              }),
            }
          }
          if (table === 'reservations') {
            return {
              update: (updates: any) => ({
                eq: (_col: string, _id: string) => {
                  reservationStatus = updates.status
                  cancelledReason = updates.cancellation_reason || updates.notes
                  return Promise.resolve({ data: { id: 'bk_fail_compensation_test', status: reservationStatus }, error: null })
                },
              }),
            }
          }
          if (table === 'audit_events') {
            return {
              insert: async () => ({ error: null }),
            }
          }
          return {}
        },
      }

      const bookingSM = new BookingStateMachine(mockClient as any)

      await expect(
        bookingSM.confirmBooking({
          workspaceId,
          slotId: '2026-09-17T15:00:00.000Z',
          customerId: 'hashed_customer_test',
          customerName: '테스트 고객',
          customerPhone: '010-0000-0000',
          serviceId: 'srv-test',
          serviceName: '자연눈썹',
          depositKrw: 30000,
          totalAmountKrw: 200000,
          customerAcceptedProof: {
            consentType: 'CUSTOMER_AFFIRMED',
            consentTimestamp: new Date().toISOString(),
            selectedSlotId: '2026-09-17T15:00:00.000Z',
            channelSource: 'INSTAGRAM_DM',
          },
          missionId: 'msn-partial-commit-fail',
          traceId,
          channelSource: 'INSTAGRAM_DM',
        })
      ).rejects.toThrow(/CROSS_CONTEXT_COMMIT_FAILED/)

      // Compensation verification: reservation must be compensated to CANCELLED or RECONCILE_REQUIRED
      expect(
        reservationStatus === 'CANCELLED' || reservationStatus === 'RECONCILE_REQUIRED',
        'Reservation must be compensated upon cross-context commit failure'
      ).toBe(true)
    })
  })

  describe('3. Booking ID Type Contract: Accepts text booking IDs with bk_ prefix', () => {
    it('supports binding text booking IDs like bk_UUID without schema rejection', async () => {
      let updatedBookingId = ''

      const mockClient = {
        from: (table: string) => {
          if (table === 'marketing_missions') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    single: async () => ({
                      data: {
                        id: 'msn-text-bk-1',
                        workspace_id: workspaceId,
                        trace_id: traceId,
                        status: 'BOOKING_INTENT',
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
              update: (updates: any) => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => {
                        updatedBookingId = updates.booking_id
                        return {
                          data: {
                            id: 'msn-text-bk-1',
                            booking_id: updates.booking_id,
                            status: 'BOOKED',
                          },
                          error: null,
                        }
                      },
                    }),
                  }),
                }),
              }),
            }
          }
          if (table === 'mission_events') {
            return {
              insert: async () => ({ error: null }),
            }
          }
          return {}
        },
      }

      const missionService = new MarketingMissionService(mockClient as any)
      const textBookingId = 'bk_550e8400-e29b-41d4-a716-446655440000'

      await missionService.bindCustomerAndBooking({
        workspaceId,
        missionId: 'msn-text-bk-1',
        traceId,
        bookingId: textBookingId,
        customerId: 'hashed_cust_123',
      })

      expect(updatedBookingId).toBe(textBookingId)
    })
  })
})
