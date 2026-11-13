import { describe, expect, it } from 'vitest'
import { NAVER_PUBLISH_NOT_READY, NAVER_PUBLISH_NOT_READY_MESSAGE, naverPublishNotReadyResult } from './unavailable'

describe('naverPublishNotReadyResult', () => {
  it('is a failure that never claims a publish or a verification', () => {
    const result = naverPublishNotReadyResult()
    expect(result.success).toBe(false)
    expect(result.verified).toBe(false)
    expect(result.errorCode).toBe(NAVER_PUBLISH_NOT_READY)
    expect(result.message).toBe('네이버 블로그에는 소희가 대신 올리지 않아요. 복사·사진 저장 후 네이버에서 직접 게시해 주세요.')
    expect(result.message).toBe(NAVER_PUBLISH_NOT_READY_MESSAGE)
    expect(result).not.toHaveProperty('url')
    expect(result).not.toHaveProperty('postId')
  })
})
