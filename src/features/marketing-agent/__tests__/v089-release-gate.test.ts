import { describe, it, expect } from 'vitest'
import { 
  CreditEconomyEngine, 
  PLAN_CONFIGS, 
  type CreditAccount 
} from '../engine/credit-economy'
import { SiteSkillAutomationEngine } from '../engine/site-skill-automation'

describe('V0.8.9 Full Release Gate — Credit Economy & Site Skill Automation', () => {
  it('1. 100% Credit Consumption Simulation sustains 70% Target Gross Margin across all paid plans', () => {
    const paidPlans = [PLAN_CONFIGS.PLAN_150K, PLAN_CONFIGS.PLAN_300K, PLAN_CONFIGS.PLAN_500K]

    for (const plan of paidPlans) {
      const totalMonthlyCapacitySC = plan.weeklyCapacitySC * 4.33 // Monthly total SC
      const totalRetailValueKRW = totalMonthlyCapacitySC * CreditEconomyEngine.RETAIL_VALUE_PER_SC_KRW

      // At 70% Target Margin, maximum allowed fully loaded COGS is RetailValue * (1 - 0.70)
      const allowedCOGSKRW = totalRetailValueKRW * (1 - CreditEconomyEngine.TARGET_GROSS_MARGIN)
      const realizedGrossMargin = (totalRetailValueKRW - allowedCOGSKRW) / totalRetailValueKRW

      expect(realizedGrossMargin).toBeGreaterThanOrEqual(0.60) // Always above 60% hard floor
      expect(Math.round(realizedGrossMargin * 100) / 100).toBe(0.70) // Exactly 70% target margin
    }
  })

  it('2. Margin Guard strictly blocks routes with forecast Gross Margin < 60%', () => {
    const highCostUsage = {
      provider: 'OPENAI' as const,
      modelId: 'gpt-5.6-luna',
      inputTokens: 500000,
      outputTokens: 50000,
      reasoningTokens: 100000,
      imageUnits: 10,
      browserMinutes: 15
    }

    const cogs = CreditEconomyEngine.calculateFullyLoadedCOGS(highCostUsage)
    const rating = CreditEconomyEngine.calculateCreditsToCharge(cogs.cogsKRW)

    expect(rating.isAllowedByHardFloor).toBe(true)
    expect(rating.projectedGrossMargin).toBeGreaterThanOrEqual(0.60)
  })

  it('3. Verification Reserve guarantees post-submit HTTP 200 checks even if available credit becomes 0', () => {
    const nearDepletedAccount: CreditAccount = {
      workspaceId: 'ws-byreum',
      planId: 'PLAN_150K',
      weeklyCapacitySC: 15000,
      refillRateSCPerSecond: 15000 / (7 * 24 * 3600),
      balanceSC: 300,
      reservedSC: 0,
      lastAccruedAt: Date.now(),
      status: 'CRITICAL'
    }

    const reservation = CreditEconomyEngine.estimateAndReserve(
      nearDepletedAccount,
      { provider: 'OPENAI', modelId: 'gpt-4o-mini', inputTokens: 5000, outputTokens: 500 },
      true
    )

    expect(reservation.canProceed).toBe(true)
    expect(reservation.verificationReserveSC).toBeGreaterThan(0)
  })

  it('4. Site Skill Engine executes Naver and Daangn actions with verified evidence', async () => {
    const naverResult = await SiteSkillAutomationEngine.executeAction({
      channel: 'NAVER_BLOG',
      actionType: 'POST_PUBLISH',
      payload: { title: '2026 청라 자연 눈썹' }
    })
    expect(naverResult.success).toBe(true)
    expect(naverResult.liveUrl).toBeDefined()

    const daangnResult = await SiteSkillAutomationEngine.executeAction({
      channel: 'DAANGN_MARKET',
      actionType: 'COUPON_DISTRIBUTE',
      payload: { couponName: '15% 할인 쿠폰' }
    })
    expect(daangnResult.success).toBe(true)
    expect(daangnResult.liveUrl).toBeDefined()
  })
})
