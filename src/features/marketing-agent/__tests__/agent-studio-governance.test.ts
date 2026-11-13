import { describe, it, expect } from 'vitest'
import { AgentStudioGovernanceEngine, type AuthorityPolicy, type KnowledgeItem } from '../engine/agent-studio-governance'

describe('Sohee V0.8.8 Agent Studio & Governance Engines [ANI-190 ~ ANI-196]', () => {
  describe('Authority Matrix', () => {
    it('permits autonomous execution only when mode is AUTONOMOUS and risk is not R3', () => {
      const autoPolicy: AuthorityPolicy = {
        actionType: 'threads_post',
        desiredMode: 'AUTONOMOUS',
        actualMode: 'AUTONOMOUS',
        riskTier: 'R1',
        requiresApproval: false
      }

      const assistPolicy: AuthorityPolicy = {
        actionType: 'naver_publish',
        desiredMode: 'ASSIST',
        actualMode: 'ASSIST',
        riskTier: 'R2',
        requiresApproval: true
      }

      expect(AgentStudioGovernanceEngine.canExecuteAutonomously(autoPolicy)).toBe(true)
      expect(AgentStudioGovernanceEngine.canExecuteAutonomously(assistPolicy)).toBe(false)
    })
  })

  describe('Budget & Model Routing', () => {
    it('routes complex_strategy to high capability model and fast_chat to mini model', () => {
      const strategyRoute = AgentStudioGovernanceEngine.routeModel('complex_strategy')
      const chatRoute = AgentStudioGovernanceEngine.routeModel('fast_chat')

      expect(strategyRoute.model).toBe('gemini-3.8-flash')
      expect(chatRoute.model).toBe('gemini-3.5-flash-lite')
      expect(chatRoute.maxCostPerCallWon).toBeLessThanOrEqual(10)
    })
  })

  describe('Knowledge Governance', () => {
    it('filters only FACT and PROVENANCE_VERIFIED items for claim generation', () => {
      const knowledge: KnowledgeItem[] = [
        {
          id: 'k-1',
          type: 'service_price',
          content: '자연 눈썹 첫 방문 150,000원',
          epistemicTier: 'FACT',
          confidenceScore: 1.0,
          lastVerifiedAt: new Date()
        },
        {
          id: 'k-2',
          type: 'learned_pattern',
          content: '고객이 오후 3시를 선호하는 것 같음',
          epistemicTier: 'INFERENCE',
          confidenceScore: 0.6,
          lastVerifiedAt: new Date()
        }
      ]

      const trusted = AgentStudioGovernanceEngine.getTrustedFacts(knowledge)
      expect(trusted).toHaveLength(1)
      expect(trusted[0].id).toBe('k-1')
    })
  })
})
