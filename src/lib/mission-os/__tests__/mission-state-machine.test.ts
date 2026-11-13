import { describe, it, expect } from 'vitest'
import {
  assertValidMissionTransition,
  canTransitionMission,
  projectMissionStateFromEvents,
  type MissionStatus,
  type MissionEvent,
} from '../mission-state-machine'

describe('Marketing Mission State Machine & Event Sourcing (ANI-1210)', () => {
  it('1. MUST allow valid sequential lifecycle transitions from RECEIVED to COMPLETED', () => {
    const validSequence: MissionStatus[] = [
      'RECEIVED',
      'PLANNING',
      'PRODUCING',
      'AWAITING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'PUBLISHED_VERIFIED',
      'LISTENING',
      'CUSTOMER_ENGAGED',
      'BOOKING_INTENT',
      'BOOKED',
      'OUTCOME_OBSERVED',
      'LEARNING',
      'NEXT_ACTION_READY',
      'COMPLETED',
    ]

    for (let i = 0; i < validSequence.length - 1; i++) {
      const from = validSequence[i]
      const to = validSequence[i + 1]
      expect(canTransitionMission(from, to)).toBe(true)
      expect(() => assertValidMissionTransition(from, to)).not.toThrow()
    }
  })

  it('2. MUST reject invalid lifecycle skips (e.g., bypassing approval or directly publishing)', () => {
    // Cannot skip from RECEIVED directly to APPROVED
    expect(canTransitionMission('RECEIVED', 'APPROVED')).toBe(false)
    expect(() => assertValidMissionTransition('RECEIVED', 'APPROVED')).toThrow(/INVALID_MISSION_TRANSITION/)

    // Cannot skip from PRODUCING directly to EXECUTING without approval
    expect(canTransitionMission('PRODUCING', 'EXECUTING')).toBe(false)
    expect(() => assertValidMissionTransition('PRODUCING', 'EXECUTING')).toThrow(/INVALID_MISSION_TRANSITION/)

    // Cannot jump from COMPLETED back to PLANNING directly
    expect(canTransitionMission('COMPLETED', 'PLANNING')).toBe(false)
    expect(() => assertValidMissionTransition('COMPLETED', 'PLANNING')).toThrow(/INVALID_MISSION_TRANSITION/)
  })

  it('3. MUST allow failure, block, pause, and cancellation from active states and allow recovery', () => {
    // Can fail from EXECUTING
    expect(canTransitionMission('EXECUTING', 'FAILED')).toBe(true)
    // Can recover from FAILED to EXECUTING or PLANNING
    expect(canTransitionMission('FAILED', 'EXECUTING')).toBe(true)
    expect(canTransitionMission('FAILED', 'PLANNING')).toBe(true)

    // Can pause from PRODUCING and resume
    expect(canTransitionMission('PRODUCING', 'PAUSED')).toBe(true)
    expect(canTransitionMission('PAUSED', 'PRODUCING')).toBe(true)

    // Can block on approval or external dependency
    expect(canTransitionMission('AWAITING_APPROVAL', 'BLOCKED')).toBe(true)
    expect(canTransitionMission('BLOCKED', 'AWAITING_APPROVAL')).toBe(true)

    // Can cancel before execution
    expect(canTransitionMission('AWAITING_APPROVAL', 'CANCELLED')).toBe(true)
  })

  it('4. MUST reconstruct the current mission state faithfully from append-only events', () => {
    const events: MissionEvent[] = [
      {
        id: 'evt-1',
        workspace_id: 'ws-1',
        mission_id: 'm-1',
        trace_id: 'tr-1',
        from_status: null,
        to_status: 'RECEIVED',
        actor_type: 'user',
        event_name: 'MISSION_RECEIVED',
        occurred_at: '2026-09-10T01:00:00.000Z',
      },
      {
        id: 'evt-2',
        workspace_id: 'ws-1',
        mission_id: 'm-1',
        trace_id: 'tr-1',
        from_status: 'RECEIVED',
        to_status: 'PLANNING',
        actor_type: 'agent',
        event_name: 'PLANNING_STARTED',
        occurred_at: '2026-09-10T01:00:02.000Z',
      },
      {
        id: 'evt-3',
        workspace_id: 'ws-1',
        mission_id: 'm-1',
        trace_id: 'tr-1',
        from_status: 'PLANNING',
        to_status: 'PRODUCING',
        actor_type: 'agent',
        event_name: 'CONTENT_PRODUCTION_STARTED',
        occurred_at: '2026-09-10T01:00:05.000Z',
      },
      {
        id: 'evt-4',
        workspace_id: 'ws-1',
        mission_id: 'm-1',
        trace_id: 'tr-1',
        from_status: 'PRODUCING',
        to_status: 'AWAITING_APPROVAL',
        actor_type: 'agent',
        event_name: 'APPROVAL_REQUESTED',
        occurred_at: '2026-09-10T01:00:10.000Z',
      },
    ]

    const state = projectMissionStateFromEvents(events)
    expect(state).toBe('AWAITING_APPROVAL')
  })
})
