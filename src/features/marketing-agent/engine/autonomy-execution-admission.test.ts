import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))

import { NEW_WORKSPACE_PAUSED_REASON } from './agent-control-state'
import {
  autonomyAdmissionMessage,
  checkAutonomyExecutionAdmission,
  evaluateAutonomyExecutionAdmission,
  type RuntimeControlRow,
} from './autonomy-execution-admission'

const row = (overrides: Partial<RuntimeControlRow> = {}): RuntimeControlRow => ({
  desired_mode: 'RUNNING', actual_mode: 'RUNNING',
  pause_reason: null,
  kill_switch_active: false,
  ...overrides,
})

function client(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { db: { from } as unknown as SupabaseClient, from, select, eq, maybeSingle }
}

describe('자동 실행 허가 판정 (ANI-1712 M24)', () => {
  it('기록이 없는 워크스페이스는 실행 근거 미확인으로 차단한다', () => {
    expect(evaluateAutonomyExecutionAdmission(null)).toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
  })

  it('초기 PAUSED도 서버 중지 상태이므로 자동 실행을 차단한다', () => {
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: 'PAUSED', actual_mode: 'PAUSED', pause_reason: NEW_WORKSPACE_PAUSED_REASON }))).toEqual({ admitted: false, code: 'AUTONOMY_PAUSED' })
  })

  it('사용자가 내린 명시적 PAUSED 는 차단한다', () => {
    expect(evaluateAutonomyExecutionAdmission(row({
      desired_mode: 'PAUSED',
      pause_reason: '사용자에 의해 업무 일시정지됨',
    }))).toEqual({ admitted: false, code: 'AUTONOMY_PAUSED' })
    // 사유를 직접 입력한 경우도 같다.
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: 'PAUSED', pause_reason: '휴무일 일시정지' })))
      .toEqual({ admitted: false, code: 'AUTONOMY_PAUSED' })
  })

  it('꺼짐(OFF)과 킬스위치는 차단한다', () => {
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: 'OFF' })))
      .toEqual({ admitted: false, code: 'AUTONOMY_OFF' })
    expect(evaluateAutonomyExecutionAdmission(row({ kill_switch_active: true })))
      .toEqual({ admitted: false, code: 'AGENT_BLOCKED' })
  })

  it('희망·실제 RUNNING이 모두 확인된 경우에만 허가한다', () => {
    expect(evaluateAutonomyExecutionAdmission(row())).toEqual({ admitted: true })
  })

  it('값이 비정상이면 실행 허가가 아니라 판정 불가(차단)다', () => {
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: null })))
      .toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: 3 })))
      .toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
    expect(evaluateAutonomyExecutionAdmission(row({ desired_mode: 'SLEEPING' })))
      .toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
  })

  it('차단 사유마다 사용자용 문구가 있다', () => {
    expect(autonomyAdmissionMessage('AUTONOMY_PAUSED')).toContain('중지')
    expect(autonomyAdmissionMessage('AUTONOMY_OFF')).toContain('꺼져')
    expect(autonomyAdmissionMessage('AGENT_BLOCKED')).toContain('막혀')
    expect(autonomyAdmissionMessage('AUTONOMY_UNVERIFIABLE')).toContain('확인하지 못해')
  })

  it('제어 상태 행을 직접 읽어 판정한다', async () => {
    const paused = client({
      data: { workspace_id: 'w1', actual_mode: 'PAUSED', desired_mode: 'PAUSED', pause_reason: '사용자에 의해 업무 일시정지됨', kill_switch_active: false },
      error: null,
    })
    await expect(checkAutonomyExecutionAdmission(paused.db, 'w1')).resolves.toEqual({ admitted: false, code: 'AUTONOMY_PAUSED' })
    expect(paused.from).toHaveBeenCalledWith('workspace_runtime_control_states')
    expect(paused.select).toHaveBeenCalledWith('workspace_id,desired_mode,actual_mode,pause_reason,kill_switch_active')
    expect(paused.eq).toHaveBeenCalledWith('workspace_id', 'w1')

    const absent = client({ data: null, error: null })
    await expect(checkAutonomyExecutionAdmission(absent.db, 'w2')).resolves.toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
  })

  it('조회 실패는 통과가 아니라 판정 불가(차단)다', async () => {
    const failedRead = client({ data: null, error: { message: 'timeout' } })
    await expect(checkAutonomyExecutionAdmission(failedRead.db, 'w1')).resolves.toEqual({ admitted: false, code: 'AUTONOMY_UNVERIFIABLE' })
  })
})
