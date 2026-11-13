import { describe, expect, it } from 'vitest'
import { RivalPulseService } from './rival-pulse-service'

describe('RivalPulseService', () => {
  it('generates a commercial counter-campaign proposal tailored to local area', () => {
    const proposal = RivalPulseService.generateCounterProposal({ location: '청라' })

    expect(proposal.id).toContain('rival_counter_')
    expect(proposal.topic).toContain('청라 상권 역발상')
    expect(proposal.caption).toContain('25년 에스테틱 노하우')
    expect(proposal.hashtags).toContain('#청라피부관리')
    expect(proposal.recommendedChannels).toContain('instagram')
  })

  it('returns rival area insights with actionable counter angles', () => {
    const insights = RivalPulseService.getRivalInsights('청라')

    expect(insights.length).toBeGreaterThan(0)
    expect(insights[0].customerPainPoint).toBeDefined()
    expect(insights[0].counterAngle).toBeDefined()
  })
})
