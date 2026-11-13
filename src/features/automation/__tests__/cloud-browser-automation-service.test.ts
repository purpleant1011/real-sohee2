import { describe, it, expect } from 'vitest'
import { CloudBrowserAutomationService } from '../cloud-browser-automation-service'

describe('Zero-Install Cloud Browser Automation Service', () => {
  const sampleDraft = {
    title: '청라 자연눈썹 1:1 맞춤 디자인 프로모션',
    introduction: '바이름 청라점 봄맞이 1:1 결 디자인 안내입니다.',
    sections: [
      {
        heading: '01. 맞춤 결 디자인',
        body: '고객님의 눈매와 피부 톤에 맞춘 자연주의 눈썹 디자인을 제공합니다.',
        emphasisQuote: '당일 바로 일상생활 가능한 자연스러움'
      }
    ],
    localCta: '네이버 예약 및 당근 채팅으로 편리하게 예약하세요.',
    tags: ['#청라자연눈썹', '#바이름청라점']
  }

  it('1. Verifies channel session readiness without requiring Chrome extensions', async () => {
    const session = await CloudBrowserAutomationService.checkChannelSession('NAVER_BLOG', 'studio_byreum')
    expect(session.isReady).toBe(true)
    expect(session.authPromptRequired).toBe(false)
  })

  it('2. Executes Zero-Install Naver Blog Cloud Browser posting and returns live URL', async () => {
    const result = await CloudBrowserAutomationService.executeNaverBlogPublish(sampleDraft, 'studio_byreum')
    expect(result.success).toBe(true)
    expect(result.method).toBe('ZERO_INSTALL_CLOUD_BROWSER')
    expect(result.liveUrl).toContain('blog.naver.com/studio_byreum')
    expect(result.auditLogs.length).toBeGreaterThanOrEqual(5)
  })

  it('3. Executes Zero-Install Daangn Market Business Profile posting and returns live URL', async () => {
    const result = await CloudBrowserAutomationService.executeDaangnNewsPublish(sampleDraft, 'byreum-cheongna')
    expect(result.success).toBe(true)
    expect(result.method).toBe('ZERO_INSTALL_CLOUD_BROWSER')
    expect(result.liveUrl).toContain('daangn.com/kr/business-posts')
    expect(result.auditLogs.length).toBeGreaterThanOrEqual(4)
  })
})
