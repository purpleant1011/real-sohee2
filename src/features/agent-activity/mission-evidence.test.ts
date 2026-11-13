import { describe, expect, it } from 'vitest'
import { projectMissionEvidence } from './mission-evidence'

const scope = { workspaceId: 'workspace-1', missionId: 'mission-1', runId: 'run-1' }
const row = { workspace_id: 'workspace-1', job_id: 'run-1', capability_id: 'reservation.list', status: 'completed', completed_at: '2026-10-26T10:00:00Z', output_payload: { count: 0, empty: true, reservations: [], secret: 'do-not-expose' } }

describe('미션 근거 최소 투영', () => {
  it('실제 완료된 예약 조회만 집계하고 원본 결과·개인정보를 버린다', () => {
    const result = projectMissionEvidence(scope, [row], null)
    expect(result.reservations).toEqual({ state: 'CONFIRMED', count: 0, observedAt: '2026-10-26T10:00:00Z' })
    expect(JSON.stringify(result)).not.toMatch(/do-not-expose|"reservations":\[/)
    expect(result.channels).toEqual([])
    expect(result.price).toEqual({ state: 'UNKNOWN' })
  })

  it.each([
    { ...row, workspace_id: 'other' }, { ...row, job_id: 'other' },
    { ...row, status: 'failed' }, { ...row, status: 'running' },
    { ...row, output_payload: { count: -1 } },
    { ...row, output_payload: { count: 2, empty: false, reservations: [] } },
    { ...row, completed_at: null },
  ])('다른 범위·실패·미완료·잘못된 결과를 확인 근거로 쓰지 않는다 %#', invalid => {
    expect(projectMissionEvidence(scope, [invalid], null).reservations).toEqual({ state: 'UNKNOWN' })
  })

  it('새 조회가 진행 중이면 이전 조회의 0건을 최신 확인으로 승격하지 않는다', () => {
    const older = { ...row, step_index: 1 }
    const pending = { ...row, step_index: 2, status: 'running', completed_at: null, output_payload: {} }
    expect(projectMissionEvidence(scope, [pending, older], null).reservations).toEqual({ state: 'UNKNOWN' })
    expect(projectMissionEvidence(scope, [older, pending], null).reservations).toEqual({ state: 'UNKNOWN' })
  })

  it('SNS 권한과 가격은 검증된 첫 게시 정책에 한해 투영한다', () => {
    const result = projectMissionEvidence(scope, [], {
      datasetMode: 'ACTUAL', channels: [{ provider: 'instagram', connection: 'NOT_CONNECTED', token: 'secret' }, { provider: 'threads', connection: 'CONNECTED', publishPermission: 'GRANTED' }],
      costQuote: { amountKrw: 0, source: 'POLICY' },
    })
    expect(result.channels).toEqual([{ provider: 'instagram', connection: 'NOT_CONNECTED', permission: 'UNKNOWN' }, { provider: 'threads', connection: 'CONNECTED', permission: 'GRANTED' }])
    expect(result.price).toEqual({ state: 'CONFIRMED', amountKrw: 0, source: 'FIRST_POST_POLICY' })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('연습 데이터와 미확인 가격을 실제 근거로 승격하지 않는다', () => {
    const result = projectMissionEvidence(scope, [], { datasetMode: 'TEST', channels: [{ provider: 'instagram', publishPermission: 'GRANTED' }], costQuote: { amountKrw: 0, source: 'POLICY' } })
    expect(result.channels).toEqual([])
    expect(result.price).toEqual({ state: 'UNKNOWN' })
  })
})
