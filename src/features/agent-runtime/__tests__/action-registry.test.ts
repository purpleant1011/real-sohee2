import { describe, it, expect } from 'vitest'
import { preflightAction, ACTION_REGISTRY } from '../action-registry'

describe('Action Registry & Preflight Guard', () => {
  it('allows content generation without business verification if credit is sufficient', () => {
    const result = preflightAction({
      actionType: 'content.generate_post',
      workspaceId: 'ws-1',
      businessProfile: { verificationStatus: 'INCOMPLETE', serviceEligibility: 'LIMITED' },
      availableCredits: 500,
    })

    expect(result.allowed).toBe(true)
    expect(result.actionDef.category).toBe('content')
  })

  it('blocks external publish when business profile is not VERIFIED', () => {
    const result = preflightAction({
      actionType: 'channel.publish_instagram',
      workspaceId: 'ws-1',
      businessProfile: { verificationStatus: 'PENDING_REVIEW', serviceEligibility: 'LIMITED' },
      channelStatus: 'CONNECTED',
      grantedCapabilities: ['INSTAGRAM_PUBLISH_FEED'],
      availableCredits: 1000,
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('BUSINESS_VERIFICATION_REQUIRED')
    expect(result.blockedReason).toContain('사업자 인증 완료(VERIFIED)가 필요합니다')
  })

  it('blocks external publish when channel is disconnected or missing capability', () => {
    // 1. 채널 미연결
    const resNoChannel = preflightAction({
      actionType: 'channel.publish_threads',
      workspaceId: 'ws-1',
      businessProfile: { verificationStatus: 'VERIFIED', serviceEligibility: 'ELIGIBLE' },
      channelStatus: 'REAUTH_REQUIRED',
      grantedCapabilities: ['THREADS_PUBLISH'],
      availableCredits: 1000,
    })
    expect(resNoChannel.allowed).toBe(false)
    expect(resNoChannel.code).toBe('CHANNEL_REAUTH_REQUIRED')

    // 2. 권한 누락
    const resNoCap = preflightAction({
      actionType: 'channel.publish_threads',
      workspaceId: 'ws-1',
      businessProfile: { verificationStatus: 'VERIFIED', serviceEligibility: 'ELIGIBLE' },
      channelStatus: 'CONNECTED',
      grantedCapabilities: [],
      availableCredits: 1000,
    })
    expect(resNoCap.allowed).toBe(false)
    expect(resNoCap.code).toBe('CAPABILITY_MISSING')
  })

  it('blocks execution when credits are insufficient', () => {
    const result = preflightAction({
      actionType: 'channel.publish_naver_blog',
      workspaceId: 'ws-1',
      businessProfile: { verificationStatus: 'VERIFIED', serviceEligibility: 'ELIGIBLE' },
      channelStatus: 'CONNECTED',
      grantedCapabilities: ['NAVER_BLOG_POST'],
      availableCredits: 100, // 필요: 최소 400 SC
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('INSUFFICIENT_CREDITS')
  })

  it('blocks execution when server is paused', () => {
    const result = preflightAction({
      actionType: 'content.generate_post',
      workspaceId: 'ws-1',
      availableCredits: 1000,
      isServerPaused: true,
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('SERVER_PAUSED')
  })
})
