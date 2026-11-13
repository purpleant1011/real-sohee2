import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentControlPlaneService } from '../agent-control-state'
import { SafetyAndCreditEngine } from '../safety-engine'
import { evaluateAutonomyExecutionAdmission } from '../autonomy-execution-admission'
vi.mock('server-only', () => ({}))
const row = (actual_mode = 'PAUSED', version = 1) => ({ workspace_id: 'A', desired_mode: 'RUNNING', actual_mode, version, snapshot_version: version, active_action_run_count: 0, kill_switch_active: false, updated_at: '2026-10-25T10:00:00.000Z' })
afterEach(() => AgentControlPlaneService.resetForTest())

describe('ANI-1791 DB 정본과 자동 실행', () => {
  it('최신 프로세스 캐시가 있어도 DB PAUSED를 우선한다', async () => {
    let stored = row('RUNNING', 10)
    AgentControlPlaneService.setDbClientForTest({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }) }) })
    expect((await AgentControlPlaneService.getControlState('A')).actualMode).toBe('RUNNING')
    stored = row('PAUSED', 9)
    expect((await AgentControlPlaneService.getControlState('A')).actualMode).toBe('PAUSED')
  })
  it('DB 확인 전 동기 속성은 실행 허가가 될 수 없다', async () => {
    AgentControlPlaneService.setDbClientForTest({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row('RUNNING'), error: null }) }) }) }) })
    await AgentControlPlaneService.getControlState('A')
    const pending = AgentControlPlaneService.getControlState('A')
    expect(pending.actualMode).not.toBe('RUNNING')
    expect(pending.killSwitchActive).toBe(true)
    await pending
  })
  it.each(['PAUSED', 'OFF', 'BLOCKED', 'DEGRADED', 'ARMING', undefined])('desired RUNNING도 actual=%s이면 자동 실행을 허가하지 않는다', actual_mode => {
    expect(evaluateAutonomyExecutionAdmission({ desired_mode: 'RUNNING', actual_mode, pause_reason: null, kill_switch_active: false } as never).admitted).toBe(false)
  })
  it('안전 엔진의 DB 실패는 예외 전파가 아니라 실행 차단이다', async () => {
    AgentControlPlaneService.setDbClientForTest({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }) }) }) })
    await expect(new SafetyAndCreditEngine().preflightCheck({ workspaceId: 'A', actionType: 'instagram.publish' })).resolves.toMatchObject({ allowed: false, isKillSwitched: true })
  })
  it('기록 없음·초기 PAUSED는 실제 RUNNING 근거가 아니다', () => {
    expect(evaluateAutonomyExecutionAdmission(null).admitted).toBe(false)
    expect(evaluateAutonomyExecutionAdmission({ desired_mode: 'PAUSED', actual_mode: 'PAUSED', pause_reason: null, kill_switch_active: false } as never).admitted).toBe(false)
  })
})
