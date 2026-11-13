import { describe, expect, it } from 'vitest'
import { parseConversationPostRequest } from './conversation-post-intent'
import {
  buildByreumConsultationCampaignRequest,
  createByreumConsultationCampaign,
} from './byreum-consultation-campaign'

describe('Byreum consultation campaign', () => {
  it('defines three Instagram slides and one channel-specific Threads image', () => {
    const campaign = createByreumConsultationCampaign()

    expect(campaign.key).toBe('byreum-eyebrow-consultation-checklist-v1')
    expect(campaign.instagram.imageCount).toBe(3)
    expect(campaign.instagram.slidePrompts).toHaveLength(3)
    expect(campaign.instagram.slidePrompts[0]).toContain('무엇부터 봐야 할까요')
    expect(campaign.threads.imageCount).toBe(1)
    expect(campaign.threads.opening).toBe('내 눈썹에서 가장 먼저 고민되는 기준은 무엇인가요?')
  })

  it('keeps the approved region and safety boundaries immutable', () => {
    const campaign = createByreumConsultationCampaign()

    expect(campaign.region).toBe('인천 청라 및 인근 생활권')
    expect(campaign.mustAvoid).toEqual([
      '시술 결과 보장',
      '의학적 효능 단정',
      '허위 전후 비교',
    ])
    expect(Object.isFrozen(campaign)).toBe(true)
    expect(Object.isFrozen(campaign.instagram)).toBe(true)
    expect(Object.isFrozen(campaign.instagram.slidePrompts)).toBe(true)
    expect(Object.isFrozen(campaign.mustAvoid)).toBe(true)
  })

  it('builds one request that the existing pipeline splits into Instagram three and Threads one', () => {
    const request = buildByreumConsultationCampaignRequest()
    const parsed = parseConversationPostRequest(request)

    expect(request).toContain('눈썹 상담 전에 확인하면 좋은 세 가지 기준')
    expect(parsed?.candidates.map(({ channel, count }) => ({ channel, count }))).toEqual([
      { channel: 'instagram', count: 3 },
      { channel: 'threads', count: 1 },
    ])
  })
})
