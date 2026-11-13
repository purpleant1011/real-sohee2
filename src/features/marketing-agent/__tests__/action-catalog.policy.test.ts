import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../engine/action-catalog'

describe('Action Catalog Policy & Copy Audit', () => {
  it('does not claim automatic comment/review replies or automatic blog posting', () => {
    const igReply = ACTION_CATALOG['instagram.reply_comment']
    expect(igReply.name).not.toContain('자동 답글')

    const naverPublish = ACTION_CATALOG['naver_blog.publish']
    expect(naverPublish.name).not.toContain('자동 포스팅')
    expect(naverPublish.description).not.toContain('SmartEditor 자동화를 통한 실제 발행')

    const reviewRead = ACTION_CATALOG['review.read']
    expect(reviewRead.name).not.toContain('네이버 플레이스/카카오 리뷰 수집')

    const reviewReply = ACTION_CATALOG['review.reply']
    expect(reviewReply.description).not.toContain('5점 긍정 리뷰 자동 답글')
  })
})
