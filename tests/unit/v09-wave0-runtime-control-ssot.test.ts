import { describe, it, expect, beforeEach } from 'vitest'
import {
  AgentControlPlaneService,
  type CanonicalRuntimeControlState
} from '@/features/marketing-agent/engine/agent-control-state'
import { buildWorkboardSnapshot } from '@/features/agent-os/build-workboard-snapshot'

describe('ANI-915: Durable Runtime Control State & Split-Brain Elimination', () => {
  const testWorkspace = 'ws-test-ani-915'

  beforeEach(() => {
    // Reset state for isolation
    AgentControlPlaneService.resetForTest(testWorkspace)
  })

  it('provides all 10 canonical durable runtime control fields', async () => {
    const state: CanonicalRuntimeControlState = await AgentControlPlaneService.getControlState(testWorkspace)

    expect(state).toHaveProperty('workspace_id', testWorkspace)
    expect(state).toHaveProperty('desired_mode')
    expect(state).toHaveProperty('actual_mode')
    expect(state).toHaveProperty('active_plan_id')
    expect(state).toHaveProperty('active_action_run_count')
    expect(state).toHaveProperty('blocker_code')
    expect(state).toHaveProperty('pause_reason')
    expect(state).toHaveProperty('transition_id')
    expect(state).toHaveProperty('snapshot_version')
    expect(state).toHaveProperty('updated_at')
  })

  it('defaults to safe PAUSED/IDLE mode instead of synthetic RUNNING for new workspaces', async () => {
    const state = await AgentControlPlaneService.getControlState(testWorkspace)
    expect(state.desired_mode).toBe('PAUSED')
    expect(state.actual_mode).toBe('PAUSED')
  })

  it('increments snapshot_version and changes transition_id monotonically on PAUSE', async () => {
    const initial = await AgentControlPlaneService.getControlState(testWorkspace)
    const initialVersion = initial.snapshot_version

    const paused = await AgentControlPlaneService.setDesiredMode(
      testWorkspace,
      'PAUSED',
      'owner@example.com',
      '사장님 일시 정지 지시'
    )

    expect(paused.desired_mode).toBe('PAUSED')
    expect(paused.actual_mode).toBe('PAUSED')
    expect(paused.pause_reason).toBe('사장님 일시 정지 지시')
    expect(paused.snapshot_version).toBeGreaterThan(initialVersion)
    expect(paused.transition_id).not.toBe(initial.transition_id)

    // Second read matches paused state and snapshot_version exactly
    const readback = await AgentControlPlaneService.getControlState(testWorkspace)
    expect(readback.snapshot_version).toBe(paused.snapshot_version)
    expect(readback.actual_mode).toBe('PAUSED')
  })

  it('reflects PAUSED state in Workboard snapshot with no fake mission invent', async () => {
    const paused = await AgentControlPlaneService.setDesiredMode(
      testWorkspace,
      'PAUSED',
      'owner@example.com',
      '긴급 점검'
    )

    const workboard = buildWorkboardSnapshot({
      workspaceId: testWorkspace,
      controlState: paused,
      ownerActionRequiredCount: 0
    })

    expect(workboard.runtimeState).toBe('PAUSED')
    expect(workboard.mission).toBeNull() // No hallucinated fake mission when paused
  })

  it('blocks RUNNING mode when credit balance is zero or blocker exists', async () => {
    const blocked = await AgentControlPlaneService.setDesiredMode(
      testWorkspace,
      'RUNNING',
      'owner@example.com',
      '시작 요청',
      { blockerCode: 'NO_CREDIT', creditBalance: 0 }
    )

    expect(blocked.desired_mode).toBe('RUNNING')
    expect(blocked.actual_mode).toBe('BLOCKED')
    expect(blocked.blocker_code).toBe('NO_CREDIT')
  })
})
