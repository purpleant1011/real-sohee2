import { describe, expect, it } from 'vitest'
import { describeStartFailure } from './start-failure'

describe('describeStartFailure', () => {
  it('서버가 거절한 경우 원인 코드를 짧게 덧붙인다', () => {
    expect(describeStartFailure(new Error('conversation_start_failed'))).toBe('conversation_start_failed')
    expect(describeStartFailure(new Error('conversation_job_start_failed'))).toBe('conversation_job_start_failed')
  })
  it('네트워크 오류는 network 로, 알 수 없는 오류는 unknown 으로 요약한다(내부 메시지 원문은 노출하지 않는다)', () => {
    expect(describeStartFailure(new TypeError('Load failed'))).toBe('network')
    expect(describeStartFailure(new Error('Secret internal path /x/y'))).toBe('unknown')
    expect(describeStartFailure('x')).toBe('unknown')
  })
})
