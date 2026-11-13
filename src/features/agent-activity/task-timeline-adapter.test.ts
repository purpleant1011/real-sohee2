import { describe, expect, it } from 'vitest'
import { activityTaskTimeline } from './task-timeline-adapter'
import type { AgentActivityEvent } from './activity-event'
const workspace = '11111111-1111-4111-8111-111111111111'
const run = '22222222-2222-4222-8222-222222222222'
function event(sequence: number, kind: AgentActivityEvent['kind'], extra = {}): AgentActivityEvent {
  return { event_id: `33333333-3333-4333-8333-${String(sequence).padStart(12,'0')}`, workspace_id: workspace,
    run_id: run, mission_id: null, step_id: '1', sequence, kind, lifecycle: 'running',
    observed_at: '2026-10-28T00:00:00Z', simulated: false, sensitivity_level: 'public',
    user_visible_summary: 'unsafe raw summary', ...extra }
}
describe('canonical activities to task checklist', () => {
  it('updates the same task from started to verified without duplicate rows', () => {
    const result = activityTaskTimeline([event(1, 'tool_read_started'), event(2, 'tool_read_verified')], { workspaceId: workspace, runId: run, live: false })
    expect(result?.steps).toHaveLength(1)
    expect(result?.steps[0].status).toBe('completed')
    expect(JSON.stringify(result)).not.toContain('unsafe raw summary')
  })
  it('never treats accepted, simulated or disconnected activity as verified completion', () => {
    for (const value of [event(1, 'provider_accepted'), event(1, 'externally_verified', { simulated: true }), event(1, 'tool_read_started')]) {
      const result = activityTaskTimeline([value], { workspaceId: workspace, runId: run, live: false })
      expect(result?.completedSteps).toBe(0)
      expect(result?.steps[0].status).not.toBe('in_progress')
    }
    expect(activityTaskTimeline([event(1, 'tool_read_verified', { workspace_id: run })], { workspaceId: workspace, runId: run, live: true })).toBeNull()
  })
})
