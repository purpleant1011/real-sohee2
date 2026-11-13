import { describe, it, expect } from 'vitest'
import { SiteSkillAutomationEngine } from '../engine/site-skill-automation'

describe('Site Skill Automation Engine (API-less Naver / Daangn)', () => {
  it('1. Executes Naver Blog SmartEditor ONE automated posting and returns live URL', async () => {
    const result = await SiteSkillAutomationEngine.executeAction({
      channel: 'NAVER_BLOG',
      actionType: 'POST_PUBLISH',
      payload: {
        title: '2026 청라 자연 눈썹 맞춤 가이드',
        bodyHtml: '<p>맞춤 결 디자인 상담 안내입니다.</p>',
        tags: ['#청라자연눈썹', '#바이름청라점']
      }
    })

    expect(result.success).toBe(true)
    expect(result.channel).toBe('NAVER_BLOG')
    expect(result.liveUrl).toContain('blog.naver.com/studio_byreum')
    expect(result.browserMinutes).toBeGreaterThan(0)
    expect(result.evidence).toContain('[데모/모의 시뮬레이션]')
    expect(result.evidence).not.toContain('정식 발행 확인')
  })

  it('2. Executes Daangn Market Biz profile posting and returns live post URL', async () => {
    const result = await SiteSkillAutomationEngine.executeAction({
      channel: 'DAANGN_MARKET',
      actionType: 'COUPON_DISTRIBUTE',
      payload: {
        couponName: '화/수 첫 방문 15% 할인 쿠폰',
        discountRate: 15
      }
    })

    expect(result.success).toBe(true)
    expect(result.channel).toBe('DAANGN_MARKET')
    expect(result.liveUrl).toContain('daangn.com/kr/business-posts')
    expect(result.evidence).toContain('[데모/모의 시뮬레이션]')
    expect(result.evidence).not.toContain('동네 소식 등록 완료')
  })

  it('3. Verifies live URL HTTP status 200 OK', async () => {
    const verification = await SiteSkillAutomationEngine.verifyLiveStatus('https://blog.naver.com/studio_byreum/22379422799')
    expect(verification.isLive).toBe(true)
    expect(verification.httpStatus).toBe(200)
  })
})
