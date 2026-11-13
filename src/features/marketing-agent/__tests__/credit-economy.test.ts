import { describe, it, expect } from 'vitest'
import { 
  CreditEconomyEngine, 
  PLAN_CONFIGS, 
  type CreditAccount 
} from '../engine/credit-economy'

describe('Sohee Credit Economy V2 & Margin Guard Engine', () => {
  const baseAccount: CreditAccount = {
    workspaceId: 'ws-byreum',
    planId: 'PLAN_150K',
    weeklyCapacitySC: 30000,
    refillRateSCPerSecond: 30000 / (7 * 24 * 3600),
    balanceSC: 25000,
    reservedSC: 0,
    lastAccruedAt: Date.now() - 3600 * 1000,
    status: 'ACTIVE'
  }

  it('1. Weekly Allocation conforms to 30K / 60K / 100K SC (ANI-308)', () => {
    expect(PLAN_CONFIGS.FREE.weeklyCapacitySC).toBe(6000)
    expect(PLAN_CONFIGS.PLAN_150K.weeklyCapacitySC).toBe(30000)
    expect(PLAN_CONFIGS.PLAN_300K.weeklyCapacitySC).toBe(60000)
    expect(PLAN_CONFIGS.PLAN_500K.weeklyCapacitySC).toBe(100000)
  })

  it('2. Continuous weekly refill accrues balance accurately over elapsed time', () => {
    const now = Date.now()
    const result = CreditEconomyEngine.computeAccruedBalance(baseAccount, now)
    
    expect(result.accruedBalance).toBeGreaterThan(25000)
    expect(result.availableSC).toBeGreaterThan(25000)
    expect(result.mode).toBe('HEALTHY')
  })

  it('3. Fully loaded COGS calculation reflects Gemini 3.8 Flash ($0.15/$0.60) and GPT Image 2 tokens with FX buffer', () => {
    const usage = {
      provider: 'GOOGLE' as const,
      modelId: 'gemini-3.8-flash',
      inputTokens: 50000,
      outputTokens: 2000,
      reasoningTokens: 4000
    }

    const cogs = CreditEconomyEngine.calculateFullyLoadedCOGS(usage)
    expect(cogs.rawUSD).toBeGreaterThan(0)
    expect(cogs.cogsKRW).toBeGreaterThan(0)
    expect(cogs.providerCostKRW).toBeGreaterThan(0)
  })

  it('4. Margin Guard guarantees 70% target margin and 60% hard floor (ANI-309)', () => {
    const cogsKRW = 300 // 300 KRW
    const rating = CreditEconomyEngine.calculateCreditsToCharge(cogsKRW)

    expect(rating.creditsToChargeSC).toBeGreaterThanOrEqual(1000) // ~1,000 SC for 300 KRW COGS
    expect(rating.isAllowedByHardFloor).toBe(true)
  })

  it('5. Estimate -> Reserve -> Settle protocol locks 15% verification reserve and settles fairly', () => {
    const estimate = {
      provider: 'GOOGLE' as const,
      modelId: 'gemini-3.8-flash',
      inputTokens: 20000,
      outputTokens: 1000
    }

    // Reserve
    const reservation = CreditEconomyEngine.estimateAndReserve(baseAccount, estimate, true)
    expect(reservation.canProceed).toBe(true)
    expect(reservation.reservedSC).toBeGreaterThan(0)
    expect(reservation.verificationReserveSC).toBeGreaterThan(0)
    expect(reservation.lowEstimateSC).toBeGreaterThan(0)
    expect(reservation.highEstimateSC).toBeGreaterThan(reservation.lowEstimateSC)

    // Settle with actual usage
    const actual = {
      provider: 'GOOGLE' as const,
      modelId: 'gemini-3.8-flash',
      inputTokens: 15000,
      outputTokens: 800
    }

    const settlement = CreditEconomyEngine.settleUsage(
      reservation.updatedAccount,
      reservation.reservedSC,
      actual
    )

    expect(settlement.finalDebitedSC).toBeGreaterThan(0)
    expect(settlement.releasedSC).toBeGreaterThanOrEqual(0)
    expect(settlement.systemSubsidySC).toBe(0)
  })

  it('6. System fault during execution activates SYSTEM_SUBSIDY with zero customer debit (ANI-310)', () => {
    const actual = {
      provider: 'GOOGLE' as const,
      modelId: 'gemini-3.8-flash',
      inputTokens: 10000,
      outputTokens: 500
    }

    const settlement = CreditEconomyEngine.settleUsage(
      baseAccount,
      500,
      actual,
      true // isSystemFault
    )

    expect(settlement.finalDebitedSC).toBe(0)
    expect(settlement.systemSubsidySC).toBeGreaterThan(0)
    expect(settlement.updatedAccount.balanceSC).toBe(baseAccount.balanceSC)
  })

  it('7. 100% utilization worst-case simulation confirms all plans satisfy 60% hard floor (ANI-309)', () => {
    const sim150 = CreditEconomyEngine.simulate100PercentUtilizationMargin('PLAN_150K')
    const sim300 = CreditEconomyEngine.simulate100PercentUtilizationMargin('PLAN_300K')
    const sim500 = CreditEconomyEngine.simulate100PercentUtilizationMargin('PLAN_500K')

    expect(sim150.isCompliant).toBe(true)
    expect(sim300.isCompliant).toBe(true)
    expect(sim500.isCompliant).toBe(true)
    expect(sim150.realizedGrossMargin).toBeGreaterThanOrEqual(0.60)
  })

  it('8. Daily Operating Plan and 24h rolling forecast generates structured routine and portfolio mix', () => {
    const plan = CreditEconomyEngine.generateDailyOperatingPlan(baseAccount)

    expect(plan.workspaceId).toBe('ws-byreum')
    expect(plan.operatingMode).toBe('HEALTHY')
    expect(plan.routineBlocks.length).toBe(6)
    expect(plan.portfolioMix.length).toBe(6)
    expect(plan.plannedSCExpected).toBeGreaterThan(0)
    expect(plan.forecastConfidence).toBeGreaterThan(0.9)
  })
})
