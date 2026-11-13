import { describe, expect, it } from 'vitest'
import {
  generateLivingGreeting,
  type LivingGreetingParams,
} from './living-greeting'

describe('generateLivingGreeting', () => {
  it('generates urgent greeting with countdown when pending DM exists', () => {
    const params: LivingGreetingParams = {
      businessName: '바이름',
      urgentDmCount: 1,
      earliestDmHoursLeft: 22,
      pendingCommentCount: 2,
    }

    const result = generateLivingGreeting(params)

    expect(result.greetingText).toContain('바이름')
    expect(result.greetingText).toContain('인스타그램')
    expect(result.greetingText).toContain('22시간')
    expect(result.badgeText).toBe('예약 문의 대기 중')
    expect(result.quickAction).toBeDefined()
    expect(result.quickAction?.label).toContain('예약 문의 확인하기')
    expect(result.quickAction?.href).toBe('/app/engagement?tab=messages')
  })

  it('generates comments greeting when only comments are pending', () => {
    const params: LivingGreetingParams = {
      businessName: '바이름',
      urgentDmCount: 0,
      pendingCommentCount: 3,
    }

    const result = generateLivingGreeting(params)

    expect(result.greetingText).toContain('바이름')
    expect(result.greetingText).toContain('댓글 3건')
    expect(result.badgeText).toBe('새 댓글 확인 필요')
    expect(result.quickAction?.label).toContain('답글 검토하기')
    expect(result.quickAction?.href).toBe('/app/engagement?tab=comments')
  })

  it('generates warm general care greeting when all clear', () => {
    const params: LivingGreetingParams = {
      businessName: '바이름',
      urgentDmCount: 0,
      pendingCommentCount: 0,
    }

    const result = generateLivingGreeting(params)

    expect(result.greetingText).toContain('바이름')
    expect(result.greetingText).toContain('모든 고객 반응에 답장을 마쳤어요')
    expect(result.badgeText).toBe('정상 가동 중')
  })
})
