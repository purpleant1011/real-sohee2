import { describe, it, expect } from 'vitest'
import { GROWTH_MISSION_LIBRARY } from './growth-mission-library'
import { MissionRecommendationEngine } from './mission-recommendation-engine'

describe('Marketing Work Catalog & Recommendation Engine (ANI-314, ANI-315)', () => {
  it('1. Library contains exactly 80 specialized growth mission templates across 10 categories', () => {
    expect(GROWTH_MISSION_LIBRARY.length).toBe(80)

    const categories = new Set(GROWTH_MISSION_LIBRARY.map(m => m.category))
    expect(categories.size).toBe(10)

    // Check each category has 8 templates
    for (const cat of categories) {
      const inCat = GROWTH_MISSION_LIBRARY.filter(m => m.category === cat)
      expect(inCat.length).toBe(8)
    }
  })

  it('2. Multi-factor recommendation engine ranks top 3 missions matching workspace context', () => {
    const context = {
      idleSlotsCount: 5,
      unansweredInquiriesCount: 2,
      daysSinceLastPost: 4,
      availableSC: 15000
    }

    const ranked = MissionRecommendationEngine.rankMissions(context)
    expect(ranked.length).toBe(3)
    expect(ranked[0].urgencyLabel).toBe('긴급')
    expect(ranked[0].recommendationReason).toContain('공실 슬롯')
  })

  it('3. Generates remaining credit value proposal tailored to available SC balance', () => {
    const proposal = MissionRecommendationEngine.generateCreditValueProposal(4500)
    
    expect(proposal.availableSC).toBe(4500)
    expect(proposal.suggestedMissions.length).toBeGreaterThanOrEqual(1)
    expect(proposal.estimatedBusinessValue).toContain('SC를 활용하여')
  })
})

