import { describe, expect, it } from 'vitest'

import {
  UNKNOWN_STAGE_LABEL,
  executionLabel,
  isExecutionVerified,
  needsOwnerDecision,
  readExecutionStage,
  stageFromServerPayload,
} from './execution-state'

describe('readExecutionStage', () => {
  it('서버가 준 단계만 인정한다', () => {
    expect(readExecutionStage('drafting')).toBe('drafting')
    expect(readExecutionStage('awaiting_decision')).toBe('awaiting_decision')
  })

  it('모르는 값은 null 이다 (완료로 추론하지 않는다)', () => {
    expect(readExecutionStage('done')).toBeNull()
    expect(readExecutionStage('completed')).toBeNull()
    expect(readExecutionStage('')).toBeNull()
    expect(readExecutionStage(undefined)).toBeNull()
    expect(readExecutionStage(null)).toBeNull()
    expect(readExecutionStage(3)).toBeNull()
    expect(readExecutionStage({ stage: 'received' })).toBeNull()
  })
})

describe('executionLabel', () => {
  it('단계별 사장님 문구를 준다', () => {
    expect(executionLabel('received')).toBe('요청 받음')
    expect(executionLabel('verifying')).toBe('정보 확인 중')
    expect(executionLabel('drafting')).toBe('초안 준비 중')
    expect(executionLabel('awaiting_decision')).toBe('사장님 결정 필요')
    expect(executionLabel('verifying_external')).toBe('외부 결과 확인 중')
  })

  it('모르는 단계는 완료가 아니라 확인 중으로 표시한다', () => {
    expect(executionLabel(null)).toBe(UNKNOWN_STAGE_LABEL)
    expect(executionLabel(null)).not.toContain('완료')
  })

  it('어떤 단계 문구에도 완료 표시가 없다', () => {
    const stages = [
      'received',
      'verifying',
      'drafting',
      'awaiting_decision',
      'verifying_external',
    ] as const
    for (const stage of stages) {
      expect(executionLabel(stage)).not.toContain('완료')
      expect(executionLabel(stage)).not.toContain('게시됨')
    }
  })
})

describe('needsOwnerDecision', () => {
  it('결정 단계에서만 승인 카드로 이어진다', () => {
    expect(needsOwnerDecision('awaiting_decision')).toBe(true)
    expect(needsOwnerDecision('drafting')).toBe(false)
    expect(needsOwnerDecision(null)).toBe(false)
  })
})

describe('isExecutionVerified', () => {
  it('서버 산출물이 있어도 외부 확인 전에는 참이 아니다', () => {
    expect(isExecutionVerified('verifying_external', false)).toBe(false)
    expect(isExecutionVerified('drafting', true)).toBe(false)
    expect(isExecutionVerified(null, true)).toBe(false)
  })

  it('외부 확인 단계 + 서버 산출물일 때만 참', () => {
    expect(isExecutionVerified('verifying_external', true)).toBe(true)
  })
})

describe('stageFromServerPayload', () => {
  it('stage / execution_stage 만 상태 근거로 쓴다', () => {
    expect(stageFromServerPayload({ stage: 'verifying' })).toBe('verifying')
    expect(stageFromServerPayload({ execution_stage: 'drafting' })).toBe('drafting')
  })

  it('본문 텍스트는 상태 근거가 아니다', () => {
    expect(stageFromServerPayload({ text: '게시가 완료되었습니다' })).toBeNull()
    expect(stageFromServerPayload('stage: drafting')).toBeNull()
    expect(stageFromServerPayload(null)).toBeNull()
  })
})
