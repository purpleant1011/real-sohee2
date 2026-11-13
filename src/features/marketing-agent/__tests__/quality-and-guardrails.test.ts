import { describe, it, expect } from 'vitest'
import { QualityGateEngine } from '../engine/quality-gate'
import { GuardrailEngine } from '../engine/guardrail-engine'

describe('Sohee V0.8.8 Quality Gate & Guardrails Engine [ANI-180, ANI-195]', () => {
  describe('QualityGateEngine', () => {
    it('blocks prohibited medical and exaggerated claims', () => {
      const result = QualityGateEngine.inspect({
        channel: 'naver_blog',
        title: '청라 100% 보장 자연 눈썹',
        body: '시술 후 부작용 전혀 없음 및 영구적 효과를 보장합니다.'
      })

      expect(result.passed).toBe(false)
      expect(result.brandFit.passed).toBe(false)
      expect(result.brandFit.violations.length).toBeGreaterThan(0)
    })

    it('validates compliant natural eyebrow content successfully', () => {
      const result = QualityGateEngine.inspect({
        channel: 'naver_blog',
        title: '2026 청라 자연 눈썹: 봄 맞춤 1:1 디자인 가이드',
        body: '인천 청라 센트럴파크 인근에서 자연스러운 결을 살린 바이름만의 맞춤 디자인 상담 프로세스를 소개합니다. 일상에서 자연스럽게 어울리는 눈썹을 완성해 드립니다.',
        images: ['https://example.com/img1.jpg'],
        externalLinks: ['https://booking.naver.com/byreum?utm_source=naver_blog']
      })

      expect(result.passed).toBe(true)
      expect(result.overallScore).toBeGreaterThanOrEqual(80)
      expect(result.brandFit.violations).toHaveLength(0)
      expect(result.linkSafety.validLinks).toContain('https://booking.naver.com/byreum?utm_source=naver_blog')
    })

    it('enforces platform length limit on threads (500 chars)', () => {
      const longText = 'A'.repeat(550)
      const result = QualityGateEngine.inspect({
        channel: 'threads',
        body: longText
      })

      expect(result.platformFit.passed).toBe(false)
      expect(result.platformFit.issues[0]).toContain('스레드 글자 수 초과')
    })
  })

  describe('GuardrailEngine', () => {
    it('blocks all actions when emergency Kill Switch is active', () => {
      const guardrail = new GuardrailEngine()
      guardrail.setKillSwitch(true)

      const result = guardrail.evaluate({
        workspaceId: 'ws-byreum',
        actionType: 'publish_post'
      })

      expect(result.allowed).toBe(false)
      expect(result.enforcementRule).toBe('KILL_SWITCH')
    })

    it('blocks outbound messages during quiet hours (e.g. 23:00)', () => {
      const guardrail = new GuardrailEngine()
      const lateNight = new Date('2026-08-31T23:30:00')

      const result = guardrail.evaluate({
        workspaceId: 'ws-byreum',
        actionType: 'outbound_message',
        customerId: 'cust-1',
        timestamp: lateNight
      })

      expect(result.allowed).toBe(false)
      expect(result.enforcementRule).toBe('QUIET_HOURS')
    })

    it('enforces frequency cap of 1 message per day per customer', () => {
      const guardrail = new GuardrailEngine()
      const now = new Date('2026-08-31T14:00:00')

      // Record first send
      guardrail.recordOutbound('cust-1', now)

      // Try sending second message on the same day
      const secondAttempt = guardrail.evaluate({
        workspaceId: 'ws-byreum',
        actionType: 'outbound_message',
        customerId: 'cust-1',
        timestamp: new Date('2026-08-31T16:00:00')
      })

      expect(secondAttempt.allowed).toBe(false)
      expect(secondAttempt.enforcementRule).toBe('FREQUENCY_CAP')
    })

    it('blocks spending that exceeds daily budget limit', () => {
      const guardrail = new GuardrailEngine({
        budgetCapWon: { dailyLimit: 50000, monthlyLimit: 500000 }
      })

      guardrail.recordSpend(40000)

      const excessSpend = guardrail.evaluate({
        workspaceId: 'ws-byreum',
        actionType: 'paid_spend',
        spendAmountWon: 20000
      })

      expect(excessSpend.allowed).toBe(false)
      expect(excessSpend.enforcementRule).toBe('BUDGET_CAP')
    })
  })
})
