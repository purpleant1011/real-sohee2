import { describe, expect, it } from 'vitest'
import { userStatusMessages } from './user-status-message'

describe('userStatusMessages', () => {
  it('contains only recovery guidance without provider names or internal identifiers', () => {
    expect(userStatusMessages).toEqual({
      notificationsUnavailable: '알림을 불러오지 못했어요. 다른 작업은 계속할 수 있습니다.',
      workSummaryUnavailable: '업무 수를 지금 확인할 수 없어요.',
      generationRetryable: '일부 이미지를 만들지 못했어요. 실패한 이미지만 다시 시도할 수 있습니다.',
    })
    expect(Object.values(userStatusMessages).join(' ')).not.toMatch(/request[_ -]?id|uuid|SUPABASE|OPENAI|home-unavailable/i)
  })
})
