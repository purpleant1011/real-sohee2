import { describe, expect, it } from 'vitest'
import {
  CHANNEL_LABELS,
  STATUS_LABELS,
  CLASSIFICATION_LABELS,
  getChannelLabel,
  getStatusLabel,
  getClassificationLabel,
} from './labels'

describe('Engagement Korean Labels', () => {
  it('maps all channels faithfully to Korean labels', () => {
    expect(getChannelLabel('instagram')).toBe('인스타그램')
    expect(getChannelLabel('threads')).toBe('스레드')
  })

  it('maps all statuses faithfully to Korean labels', () => {
    expect(getStatusLabel('RECEIVED')).toBe('새 댓글')
    expect(getStatusLabel('CLASSIFIED')).toBe('분석됨')
    expect(getStatusLabel('DRAFTED')).toBe('초안 준비됨')
    expect(getStatusLabel('APPROVED')).toBe('승인됨')
    expect(getStatusLabel('SENDING')).toBe('보내는 중')
    expect(getStatusLabel('SENT')).toBe('답글 완료')
    expect(getStatusLabel('DISMISSED')).toBe('무시함')
    expect(getStatusLabel('NEEDS_CHECK')).toBe('확인 필요')
    expect(getStatusLabel('FAILED')).toBe('보내지 못했어요')
  })

  it('maps all classifications faithfully to Korean labels', () => {
    expect(getClassificationLabel('THANKS')).toBe('감사')
    expect(getClassificationLabel('GREETING')).toBe('인사')
    expect(getClassificationLabel('QUESTION')).toBe('질문')
    expect(getClassificationLabel('COMPLAINT')).toBe('불만')
    expect(getClassificationLabel('SENSITIVE')).toBe('민감한 내용')
    expect(getClassificationLabel('SPAM')).toBe('스팸')
    expect(getClassificationLabel('NEEDS_HUMAN')).toBe('직접 확인 필요')
    expect(getClassificationLabel(null)).toBeNull()
    expect(getClassificationLabel(undefined)).toBeNull()
  })
})
