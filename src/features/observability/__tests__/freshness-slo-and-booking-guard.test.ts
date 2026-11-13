import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FreshnessSLOEngine,
  type SignalMetricInput,
} from '../freshness-slo-engine'
import {
  BookingConflictGuard,
  type BookingEvaluationInput,
} from '@/features/booking/booking-conflict-guard'

describe('Freshness SLO Engine & Booking Conflict Guard (ANI-1200, ANI-1225, ANI-1217)', () => {
  describe('1. Freshness SLO Engine (ANI-1200, ANI-1225)', () => {
    const engine = new FreshnessSLOEngine()

    it('MUST evaluate HEALTHY when signals are recent and within SLA threshold', () => {
      const now = Date.now()
      const signals: SignalMetricInput[] = [
        {
          signalName: 'channel_connection',
          lastObservedAt: new Date(now - 1000 * 60 * 5).toISOString(), // 5m ago
          thresholdSeconds: 3600,
          isConnected: true,
        },
        {
          signalName: 'webhook_inbound',
          lastObservedAt: new Date(now - 1000 * 60 * 10).toISOString(), // 10m ago
          thresholdSeconds: 7200,
        },
        {
          signalName: 'audit_append',
          lastObservedAt: new Date(now - 1000 * 30).toISOString(), // 30s ago
          thresholdSeconds: 300,
        },
      ]

      const evaluation = engine.evaluateFreshness(signals)

      expect(evaluation.overallHealth).toBe('HEALTHY')
      expect(evaluation.degradedSignals.length).toBe(0)
    })

    it('MUST flag STALE or DEGRADED when webhook has not been observed within SLA', () => {
      const now = Date.now()
      const signals: SignalMetricInput[] = [
        {
          signalName: 'webhook_inbound',
          lastObservedAt: new Date(now - 1000 * 60 * 60 * 25).toISOString(), // 25h ago (exceeds 24h)
          thresholdSeconds: 86400,
        },
        {
          signalName: 'channel_connection',
          lastObservedAt: new Date().toISOString(),
          thresholdSeconds: 3600,
          isConnected: false, // disconnected!
        },
      ]

      const evaluation = engine.evaluateFreshness(signals)

      expect(evaluation.overallHealth).toBe('DEGRADED')
      expect(evaluation.degradedSignals).toContain('webhook_inbound')
      expect(evaluation.degradedSignals).toContain('channel_connection')
    })

    it('MUST return NOT_OBSERVED when no signal timestamp exists without pretending healthy', () => {
      const signals: SignalMetricInput[] = [
        {
          signalName: 'publish_reconciliation',
          lastObservedAt: null,
          thresholdSeconds: 3600,
        },
      ]

      const evaluation = engine.evaluateFreshness(signals)

      expect(evaluation.overallHealth).toBe('NOT_OBSERVED')
    })
  })

  describe('2. Booking Conflict Guard & Human Handoff (ANI-1217)', () => {
    let mockBookingsDb: Record<string, any> = {}

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
                  const match = Object.values(mockBookingsDb).find(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  return { data: match || null, error: null }
                },
              }
              return chain
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    } as any

    beforeEach(() => {
      mockBookingsDb = {}
    })

    it('MUST route high-risk customer complaints or refund demands to HUMAN_REVIEW', async () => {
      const guard = new BookingConflictGuard(mockSupabaseClient)

      const input: BookingEvaluationInput = {
        workspaceId: 'ws-123',
        slotId: '2026-09-12T14:00:00+09:00',
        customerId: 'cust-risk-001',
        customerMessage: '시술 잘못되면 전액 환불해주나요? 부작용 보상 규정 알고 싶습니다.',
      }

      const result = await guard.evaluateBookingSafety(input)

      expect(result.action).toBe('HUMAN_REVIEW')
      expect(result.requiresHandoff).toBe(true)
      expect(result.riskReason).toContain('부작용')
    })

    it('MUST detect already booked slot conflict before executing database transaction', async () => {
      const guard = new BookingConflictGuard(mockSupabaseClient)
      const slotId = '2026-09-12T14:00:00+09:00'

      mockBookingsDb['bk-existing'] = {
        id: 'bk-existing',
        workspace_id: 'ws-123',
        slot_id: slotId,
        status: 'CONFIRMED',
      }

      const input: BookingEvaluationInput = {
        workspaceId: 'ws-123',
        slotId,
        customerId: 'cust-normal-001',
        customerMessage: '이 시간으로 예약 진행해주세요!',
      }

      const result = await guard.evaluateBookingSafety(input)

      expect(result.action).toBe('CONFLICT')
      expect(result.conflictSlotId).toBe(slotId)
      expect(result.requiresHandoff).toBe(false)
    })

    it('MUST approve safe appointment request when slot is free and context is clean', async () => {
      const guard = new BookingConflictGuard(mockSupabaseClient)

      const input: BookingEvaluationInput = {
        workspaceId: 'ws-123',
        slotId: '2026-09-15T16:00:00+09:00',
        customerId: 'cust-clean-001',
        customerMessage: '자연눈썹 시술로 예약 부탁드립니다~',
      }

      const result = await guard.evaluateBookingSafety(input)

      expect(result.action).toBe('PROCEED')
      expect(result.requiresHandoff).toBe(false)
    })
  })
})
