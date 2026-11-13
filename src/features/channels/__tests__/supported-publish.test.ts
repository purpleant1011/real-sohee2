import { describe, expect, it } from 'vitest'
import { isPublishSupported } from '../supported-publish'
import { evaluateApprovalActions } from '@/features/vault/approval-policy'

describe('[ANI-1707] 채널별 게시 기능 지원 여부', () => {
  it('Meta 검증 경로가 있는 채널만 지원한다', () => {
    expect(isPublishSupported('instagram')).toBe(true)
    expect(isPublishSupported('threads')).toBe(true)
  })

  it('승인 정책이 막는 브라우저 커넥터 채널은 지원하지 않는다', () => {
    expect(isPublishSupported('naver_blog')).toBe(false)
    expect(isPublishSupported('daangn')).toBe(false)
  })

  it('발행 경로가 없는 네이버 플레이스는 지원하지 않는다', () => {
    expect(isPublishSupported('naver_place')).toBe(false)
  })

  it('판정은 승인 정책 한 곳에서만 나온다', () => {
    // 최선의 조건에서도 정책이 막으면 "기능 없음" — 연결 상태와 섞이지 않는다.
    const best = { readiness: 'PUBLISH_READY' as const, connection: 'VERIFIED' as const, providerReviewStatus: 'APPROVED' as const, specResult: { blocksVault: false }, targetTime: null }
    expect(isPublishSupported('naver_blog')).toBe(evaluateApprovalActions({ ...best, channel: 'naver_blog' }).PUBLISH.allowed)
    expect(isPublishSupported('daangn')).toBe(evaluateApprovalActions({ ...best, channel: 'daangn_business' }).PUBLISH.allowed)
    expect(isPublishSupported('instagram')).toBe(evaluateApprovalActions({ ...best, channel: 'instagram' }).PUBLISH.allowed)
  })
})
