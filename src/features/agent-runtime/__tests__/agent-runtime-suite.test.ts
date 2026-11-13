import { describe, it, expect } from 'vitest'
import { evaluateCreditGovernor } from '../credit-governor'
import { createMissionFromConversation } from '../conversation-turn'
import { executeServerCadence } from '../server-scheduler'

describe('Agent Runtime Suite (ANI-339, ANI-374~383)', () => {
  describe('Credit Governor 4-tier Evaluation (ANI-382)', () => {
    it('evaluates HEALTHY tier when credit ratio >= 30%', () => {
      const status = evaluateCreditGovernor(4500, 6000) // 75%
      expect(status.state).toBe('HEALTHY')
      expect(status.canInitiateNewBillableAction).toBe(true)
      expect(status.recommendation).not.toContain('24시간 자율')
      expect(status.recommendation).toContain('마케팅 루틴이 정상 가동 중')
    })

    it('evaluates CONSERVE tier when credit ratio is 10% ~ 29%', () => {
      const status = evaluateCreditGovernor(1200, 6000) // 20%
      expect(status.state).toBe('CONSERVE')
      expect(status.canInitiateNewBillableAction).toBe(true)
    })

    it('evaluates CRITICAL tier when credit ratio is 1% ~ 9%', () => {
      const status = evaluateCreditGovernor(300, 6000) // 5%
      expect(status.state).toBe('CRITICAL')
      expect(status.canInitiateNewBillableAction).toBe(true)
    })

    it('evaluates DEPLETED tier when credit is 0', () => {
      const status = evaluateCreditGovernor(0, 6000)
      expect(status.state).toBe('DEPLETED')
      expect(status.canInitiateNewBillableAction).toBe(false)
    })
  })

  describe('ConversationTurn Command Plane Persistence (ANI-374)', () => {
    it('creates persisted mission and action run from natural user prompt', () => {
      const prompt = '이번 주 금요일 빈 예약 시간 홍보글 써줘'
      const { turn, mission } = createMissionFromConversation('ws-1', 'conv-1', prompt)

      expect(turn.userMessage).toBe(prompt)
      expect(turn.createdMissionIds).toContain(mission.id)
      expect(mission.title).toContain('이번 주 금요일 빈 예약')
      expect(mission.status).toBe('READY')
      expect(mission.actionRunIds.length).toBeGreaterThan(0)
    })
  })

  describe('Server Scheduler Cadence (ANI-378)', () => {
    it('runs continuous, morning, daily close, and weekly cadences', () => {
      const ctx = {
        workspaceId: 'ws-1',
        availableCredits: 5000,
        activeMissions: [
          { id: 'm-1', status: 'RUNNING' },
          { id: 'm-2', status: 'READY' },
        ],
      }

      const continuous = executeServerCadence('CONTINUOUS', ctx)
      expect(continuous.checkedMissionsCount).toBe(2)
      expect(continuous.processedActionsCount).toBe(1)

      const morning = executeServerCadence('MORNING', ctx)
      expect(morning.summary).toContain('아침 브리핑')

      const daily = executeServerCadence('DAILY_CLOSE', ctx)
      expect(daily.summary).toContain('일일 결산')
    })

    it('halts scheduler execution when server pause is enforced (ANI-381)', () => {
      const ctx = {
        workspaceId: 'ws-1',
        availableCredits: 5000,
        activeMissions: [{ id: 'm-1', status: 'RUNNING' }],
        isServerPaused: true,
      }

      const res = executeServerCadence('CONTINUOUS', ctx)
      expect(res.checkedMissionsCount).toBe(0)
      expect(res.summary).toContain('일시중지')
    })
  })
})
