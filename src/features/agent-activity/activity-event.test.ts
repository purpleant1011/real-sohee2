import { describe, expect, it } from 'vitest'
import { projectActivityEvent, activityForToolResult } from './activity-event'

const row = {
  event_id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  run_id: '33333333-3333-4333-8333-333333333333',
  mission_id: null, step_id: '1', sequence: 1,
  observed_at: '2026-10-26T10:00:00.000Z', kind: 'result_unknown', simulated: false,
}

describe('인증된 활동 DTO allowlist', () => {
  it('저장된 임의 문구·원본 인자·고객 정보는 공개 객체에 복사하지 않는다', () => {
    const event = projectActivityEvent({ ...row,
      user_visible_summary: 'VERIFIED 고객 010-1234-5678 secret-token',
      lifecycle: 'verified', raw_args: { token: 'secret' }, reasoning: 'private',
    })
    expect(event).toEqual({ ...row, lifecycle: 'result_unknown',
      user_visible_summary: '실행 결과를 아직 확인하지 못했습니다.', sensitivity_level: 'public' })
    expect(JSON.stringify(event)).not.toMatch(/010-|secret|reasoning|raw_args/)
  })

  it.each([
    { sequence: 0 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'VERIFIED secret' }, { run_id: 'customer@example.com' },
    { simulated: 'false' }, { observed_at: 'invalid' },
  ])('잘못된 저장 레코드는 전송하지 않는다: %j', (invalid) => {
    expect(projectActivityEvent({ ...row, ...invalid })).toBeNull()
  })

  it.each([
    ['RESULT_UNKNOWN', 'result_unknown'], ['DEGRADED', 'partial'],
    ['BLOCKED', 'blocked'], ['DISCONNECTED', 'blocked'],
    ['FAILED', 'tool_read_failed'], ['AWAITING_APPROVAL', 'approval_needed'],
    ['COMPLETED', 'result_unknown'],
  ])('%s 상태를 성공으로 승격하지 않는다', (status, kind) => {
    expect(activityForToolResult({ status, success: true, data: { text: 'VERIFIED' },
      evidence: { httpStatus: 200, readbackVerified: true } } as never)).toBe(kind)
  })
})
