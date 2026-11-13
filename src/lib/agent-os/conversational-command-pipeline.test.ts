import { describe, it, expect } from 'vitest'
import { ConversationalCommandPipeline } from './conversational-command-pipeline'
import { type CreditAccount } from '@/features/marketing-agent/engine/credit-economy'

describe('Conversational Agent Command Plane Pipeline (ANI-311, ANI-312, ANI-313)', () => {
  const sampleAccount: CreditAccount = {
    workspaceId: 'ws-byreum',
    planId: 'PLAN_150K',
    weeklyCapacitySC: 30000,
    refillRateSCPerSecond: 30000 / (7 * 24 * 3600),
    balanceSC: 20000,
    reservedSC: 0,
    lastAccruedAt: Date.now(),
    status: 'ACTIVE'
  }

  it('1. Ingests natural language intent and resolves target channel and category', () => {
    const intent = ConversationalCommandPipeline.parseIntent('이번 주말 예약 채우게 인스타랑 블로그 홍보해줘')
    
    expect(intent.targetCategory).toBe('PROMOTION')
    expect(intent.rawPrompt).toContain('인스타랑 블로그')
  })

  it('2. Builds multi-step DAG Action Graph Plan with accurate credit estimates', () => {
    const intent = ConversationalCommandPipeline.parseIntent('주중 유휴 슬롯 소진용 15% 프로모션 진행해줘')
    const plan = ConversationalCommandPipeline.buildActionGraph(intent)

    expect(plan.steps.length).toBeGreaterThanOrEqual(4)
    expect(plan.totalEstimatedSCExpected).toBeGreaterThan(0)
    expect(plan.requiredReserveSC).toBeGreaterThan(plan.totalEstimatedSCExpected)
    expect(plan.requiresOwnerApproval).toBe(true) // contains publish/promo
  })

  it('3. Executes pipeline end-to-end, debits SC and returns 4-card UI structures', () => {
    const intent = ConversationalCommandPipeline.parseIntent('청라 자연눈썹 인스타그램 피드 1건 생성해줘')
    const plan = ConversationalCommandPipeline.buildActionGraph(intent)
    const result = ConversationalCommandPipeline.executePipeline(plan, sampleAccount)

    expect(result.success).toBe(true)
    expect(result.executedSteps.length).toBe(plan.steps.length)
    expect(result.debitedSC).toBeGreaterThan(0)
    expect(result.cards.length).toBeGreaterThanOrEqual(3)
    expect(result.cards.some(c => c.cardType === 'EVIDENCE_RESULT')).toBe(true)
    expect(result.updatedAccount.balanceSC).toBeLessThan(sampleAccount.balanceSC)
  })
})

