import { describe, it, expect } from 'vitest'
import { buildWorkboardSnapshot } from '../build-workboard-snapshot'
import type { AgentControlState } from '@/features/marketing-agent/engine/agent-control-state'

describe('buildWorkboardSnapshot Canonical Read Model (ANI-909)', () => {
  const createBaseControlState = (overrides?: Partial<AgentControlState>): AgentControlState => ({
    workspace_id: 'ws-test-123',
    desired_mode: 'RUNNING',
    actual_mode: 'RUNNING',
    active_plan_id: 'plan-v1-balanced',
    active_action_run_count: 0,
    blocker_code: null,
    pause_reason: null,
    transition_id: 'tr-test-init',
    snapshot_version: 1,
    updated_at: new Date().toISOString(),

    workspaceId: 'ws-test-123',
    desiredMode: 'RUNNING',
    actualMode: 'RUNNING',
    activePlanId: 'plan-v1-balanced',
    statusReason: '정상 자율 운영 중 (09:00 ~ 21:00)',
    policyVersion: 'v1.0.0',
    budgetVersion: 'v1.0.0',
    pausedScopes: [],
    lastHeartbeatAt: new Date().toISOString(),
    workerVersion: '1.0.0',
    killSwitchActive: false,
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
    ...overrides,
    version: overrides?.version ?? 1,
  })

  it('preserves BLOCKED mode and never renders RUNNING when kill switch or blocked is active', () => {
    const control = createBaseControlState({
      desiredMode: 'RUNNING',
      actualMode: 'BLOCKED',
      killSwitchActive: true,
      statusReason: '비상 차단 활성화',
    })

    const snapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: control,
    })

    expect(snapshot.runtimeState).toBe('BLOCKED')
    expect(snapshot.runtimeState).not.toBe('RUNNING')
    expect(snapshot.statusReason).toContain('차단')
  })

  it('renders PAUSED state when desired or actual mode is PAUSED', () => {
    const control = createBaseControlState({
      desiredMode: 'PAUSED',
      actualMode: 'PAUSED',
      statusReason: '사용자에 의해 업무 일시정지됨',
    })

    const snapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: control,
    })

    expect(snapshot.runtimeState).toBe('PAUSED')
  })

  it('keeps lastProof as null when no verified proof exists, preventing fake success claims', () => {
    const control = createBaseControlState()

    const snapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: control,
      rawProof: null,
    })

    expect(snapshot.lastProof).toBeNull()
  })

  it('maps applied owner rules with provenance and versions', () => {
    const control = createBaseControlState()

    const snapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: control,
      rules: [
        { id: 'rule-1', label: '이미지 Harness v13', sourceType: 'HARNESS', sourceVersion: 'v13' },
        { id: 'rule-2', label: '당일예약 CTA', sourceType: 'POLICY', sourceVersion: 'v1.2' },
        { id: 'rule-3', label: '할인율 ≤ 10%', sourceType: 'CHARTER', sourceVersion: 'A3-v1' },
      ],
    })

    expect(snapshot.appliedRules).toHaveLength(3)
    expect(snapshot.appliedRules[0].label).toBe('이미지 Harness v13')
    expect(snapshot.appliedRules[0].sourceType).toBe('HARNESS')
    expect(snapshot.appliedRules[0].sourceVersion).toBe('v13')
  })

  it.each(['', 'not-a-date', '2026-11-02T11:00:00Z', '2026-11-02T13:00:00Z'])(
    'does not claim live operation from an unconfirmed heartbeat: %s', (lastHeartbeatAt) => {
      const snapshot = buildWorkboardSnapshot({
        workspaceId: 'ws-test-123',
        controlState: createBaseControlState({ lastHeartbeatAt }),
        now: new Date('2026-11-02T12:00:00Z'),
      })
      expect(snapshot.runtimeState).not.toBe('RUNNING')
      expect(snapshot.statusReason).not.toContain('정상 자율 운영')
      expect(snapshot.nextAction).toBeNull()
    },
  )

  it('does not invent applied policies or scheduled work from a running preference', () => {
    const snapshot = buildWorkboardSnapshot({ workspaceId: 'ws-test-123', controlState: createBaseControlState() })
    expect(snapshot.appliedRules).toEqual([])
    expect(snapshot.nextAction).toBeNull()
  })

  it('marks freshness correctly based on heartbeat timestamp', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const staleControl = createBaseControlState({
      lastHeartbeatAt: tenMinutesAgo,
    })

    const staleSnapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: staleControl,
    })
    expect(staleSnapshot.freshness).toBe('STALE')

    const freshControl = createBaseControlState({
      lastHeartbeatAt: new Date().toISOString(),
    })
    const freshSnapshot = buildWorkboardSnapshot({
      workspaceId: 'ws-test-123',
      controlState: freshControl,
    })
    expect(freshSnapshot.freshness).toBe('FRESH')
  })
})
