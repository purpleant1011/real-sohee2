import { describe, it, expect, vi } from 'vitest'
import {
  createFunnelEvent,
  mergeFunnelEvents,
  persistFunnelEventToDatabase,
  fetchPersistedFunnelEvents,
  type FunnelEventPayload,
} from '@/features/telemetry/first-post-funnel-telemetry'

describe('Slice 9: Telemetry Durability & Database Persistence', () => {
  const workspaceId = '10000000-0000-4000-8000-000000000001'
  const correlationId = 'corr-durable-123'
  const missionId = '50000000-0000-4000-8000-000000000001'
  const userId = '30000000-0000-4000-8000-000000000001'

  describe('1. mergeFunnelEvents deduplication', () => {
    it('deduplicates events by correlationId and step, preserving earlier timestamp', () => {
      const event1: FunnelEventPayload = {
        workspaceId,
        correlationId,
        step: 'ONBOARDING_START',
        stepIndex: 0,
        timestamp: '2026-09-14T10:00:00.000Z',
      }
      const event2: FunnelEventPayload = {
        workspaceId,
        correlationId,
        step: 'ONBOARDING_START',
        stepIndex: 0,
        timestamp: '2026-09-14T10:00:05.000Z',
      }
      const event3: FunnelEventPayload = {
        workspaceId,
        correlationId,
        step: 'CONVERSATION_AUTOFILL',
        stepIndex: 1,
        timestamp: '2026-09-14T10:01:00.000Z',
      }

      const merged = mergeFunnelEvents([event1], [event2, event3])
      expect(merged.length).toBe(2)
      expect(merged[0].step).toBe('ONBOARDING_START')
      expect(merged[0].timestamp).toBe('2026-09-14T10:00:00.000Z')
      expect(merged[1].step).toBe('CONVERSATION_AUTOFILL')
    })
  })

  describe('2. persistFunnelEventToDatabase', () => {
    it('persists sanitized funnel event into mission_events with schema alignment', async () => {
      let insertedData: any = null
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'mission_events') {
            return {
              insert: vi.fn(async (data: any) => {
                insertedData = data
                return { error: null }
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const event = createFunnelEvent({
        workspaceId,
        correlationId,
        step: 'ONBOARDING_START',
        metadata: { missionId },
      })

      const success = await persistFunnelEventToDatabase({
        supabase: mockSupabase as any,
        event,
        actorUserId: userId,
      })

      expect(success).toBe(true)
      expect(insertedData).toBeDefined()
      expect(insertedData.workspace_id).toBe(workspaceId)
      expect(insertedData.mission_id).toBe(missionId)
      expect(insertedData.event_name).toBe('FUNNEL_ONBOARDING_START')
      expect(insertedData.payload.stepIndex).toBe(0)
    })

    it('persists null mission_id for pre-mission events without forging fake zero UUID', async () => {
      let insertedData: any = null
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'mission_events') {
            return {
              insert: vi.fn(async (data: any) => {
                insertedData = data
                return { error: null }
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      // Event without missionId (pre-mission)
      const event = createFunnelEvent({
        workspaceId,
        correlationId,
        step: 'ONBOARDING_START',
        metadata: {},
      })

      const success = await persistFunnelEventToDatabase({
        supabase: mockSupabase as any,
        event,
        actorUserId: userId,
      })

      expect(success).toBe(true)
      expect(insertedData).toBeDefined()
      expect(insertedData.mission_id).toBeNull() // R2-B9: Must be NULL, never fake zero UUID!
    })

    it('converts fake zero UUID in metadata to null mission_id', async () => {
      let insertedData: any = null
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'mission_events') {
            return {
              insert: vi.fn(async (data: any) => {
                insertedData = data
                return { error: null }
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const event = createFunnelEvent({
        workspaceId,
        correlationId,
        step: 'ONBOARDING_START',
        metadata: { missionId: '00000000-0000-0000-0000-000000000000' },
      })

      const success = await persistFunnelEventToDatabase({
        supabase: mockSupabase as any,
        event,
        actorUserId: userId,
      })

      expect(success).toBe(true)
      expect(insertedData).toBeDefined()
      expect(insertedData.mission_id).toBeNull() // R2-B9: Must be NULL!
    })
  })

  describe('3. fetchPersistedFunnelEvents and fetchPersistedFunnelEventsResult', () => {
    it('fetches mission_events and converts them to canonical FunnelEventPayload', async () => {
      const mockDbRows = [
        {
          workspace_id: workspaceId,
          trace_id: correlationId,
          to_status: 'ONBOARDING_START',
          event_name: 'FUNNEL_ONBOARDING_START',
          occurred_at: '2026-09-14T10:00:00.000Z',
          payload: {
            stepIndex: 0,
            durationMs: 0,
            metadata: { missionId },
          },
        },
        {
          workspace_id: workspaceId,
          trace_id: correlationId,
          to_status: 'FIRST_POST_COMPLETE',
          event_name: 'FUNNEL_FIRST_POST_COMPLETE',
          occurred_at: '2026-09-14T10:05:00.000Z',
          payload: {
            stepIndex: 15,
            durationMs: 300000,
            metadata: { missionId },
          },
        },
      ]

      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          like: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: mockDbRows, error: null }),
        })),
      }

      const fetched = await fetchPersistedFunnelEvents(mockSupabase as any, workspaceId)
      expect(fetched.length).toBe(2)
      expect(fetched[0].step).toBe('ONBOARDING_START')
      expect(fetched[0].stepIndex).toBe(0)
      expect(fetched[1].step).toBe('FIRST_POST_COMPLETE')
      expect(fetched[1].durationMsFromStart).toBe(300000)
    })

    it('returns evidenceUnavailable: true when DB query fails instead of pretending 0 events', async () => {
      const { fetchPersistedFunnelEventsResult } = await import('@/features/telemetry/first-post-funnel-telemetry')
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          like: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'relation mission_events does not exist' } }),
        })),
      }

      const res = await fetchPersistedFunnelEventsResult(mockSupabase as any, workspaceId)
      expect(res.evidenceUnavailable).toBe(true)
      expect(res.events).toHaveLength(0)
      expect(res.error).toContain('relation mission_events does not exist')
    })
  })
})
