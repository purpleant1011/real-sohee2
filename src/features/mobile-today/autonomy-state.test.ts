import { describe, expect, it } from 'vitest'
import { describeAutonomy } from './autonomy-state'

const base = { desiredMode: 'RUNNING', actualMode: 'RUNNING', activeActionRunCount: 0, killSwitchActive: false, version: 3, observedAt: '2026-10-22T07:40:00Z' } as const

describe('describeAutonomy (M24: 서버 상태만 표시)', () => {
  it('실행 중 작업이 없으면 "자율근무 중"이라고 하지 않는다', () => {
    const d = describeAutonomy({ ...base })
    expect(d.label).not.toContain('작업 중')
    expect(d.label).toBe('대기 중 · 새 일을 받을 수 있어요')
  })
  it('서버가 실행 중 작업을 확인했을 때만 작업 중 표시', () => {
    expect(describeAutonomy({ ...base, activeActionRunCount: 2 }).label).toBe('2건 진행 중')
  })
  it('요청(desired)과 실제(actual)가 다르면 반영 중으로 표시', () => {
    const d = describeAutonomy({ ...base, desiredMode: 'PAUSED', actualMode: 'RUNNING' })
    expect(d.pending).toBe(true)
    expect(d.primary).toBeNull()
  })
  it('중지됨은 재개 CTA, 킬스위치는 재개 불가', () => {
    expect(describeAutonomy({ ...base, desiredMode: 'PAUSED', actualMode: 'PAUSED' }).primary).toBe('resume')
    expect(describeAutonomy({ ...base, killSwitchActive: true, actualMode: 'BLOCKED' }).primary).toBeNull()
  })
  it('실행 중이면 중지 CTA, 응답 없음(null)이면 CTA 없이 확인 불가', () => {
    expect(describeAutonomy({ ...base }).primary).toBe('pause')
    const d = describeAutonomy(null)
    expect(d.primary).toBeNull()
    expect(d.label).toBe('상태를 확인하지 못했어요')
  })
  it('중지/재개 요청은 서버 version 을 expectedVersion 으로 실어 보낸다', () => {
    expect(describeAutonomy({ ...base }).expectedVersion).toBe(3)
  })
})
