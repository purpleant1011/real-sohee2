import { describe, expect, it } from 'vitest'
import { toActionError } from './to-action-error'

describe('toActionError', () => {
  it('내부 오류를 사용자에게 노출하지 않고 안전한 요청 ID를 반환한다', () => {
    const result = toActionError(
      new Error('database connection failed for user@example.com'),
      'req_12345',
    )

    expect(result).toEqual({
      message: '요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      requestId: 'req_12345',
    })
  })
})
