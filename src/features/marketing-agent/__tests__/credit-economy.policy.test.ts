import { describe, it, expect } from 'vitest'
import { CreditEconomyEngine, type CreditAccount } from '../engine/credit-economy'

describe('Credit Economy Policy & Copy Audit', () => {
  it('does not claim immediate real publishing for Naver blog / Daangn', () => {
    const account: CreditAccount = {
      workspaceId: 'ws-test',
      planId: 'PLAN_150K',
      weeklyCapacitySC: 30000,
      refillRateSCPerSecond: 30000 / (7 * 24 * 3600),
      balanceSC: 20000,
      reservedSC: 0,
      lastAccruedAt: Date.now(),
      status: 'ACTIVE'
    }

    const plan = CreditEconomyEngine.generateDailyOperatingPlan(account)
    const rb3 = plan.routineBlocks.find(b => b.id === 'rb-3')
    expect(rb3).toBeDefined()
    expect(rb3!.why).not.toContain('즉시 실발행')
    expect(rb3!.why).toContain('원고 준비')
  })
})
