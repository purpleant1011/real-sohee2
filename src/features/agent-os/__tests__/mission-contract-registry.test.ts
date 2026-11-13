import { describe, it, expect, beforeEach } from 'vitest'
import {
  validateMissionContract,
  MissionContractRegistry,
  type MissionContract,
} from '../mission-contract-registry'

describe('Mission Contract Registry (ANI-870)', () => {
  let registry: MissionContractRegistry

  const validContract: MissionContract = {
    missionId: 'msn-spring-promo',
    workspaceId: 'ws-main',
    version: 1,
    title: '봄맞이 신규 고객 유치 및 예약 프로모션',
    businessGoal: '신규 예약 전환 4건 달성',
    targetOutcome: '네이버 플레이스 및 인스타그램 타겟 고객 예약 유입',
    stage: 'PLAN',
    triggerCondition: '주말 예약 슬롯 30% 미만 감지 시 자동 발동',
    requiredPluginIds: ['plg_instagram_growth', 'plg_naver_blog_marketing'],
    estimatedCreditCost: 40,
    safetyRules: ['일일 광고 집행 한도 30,000원 이하', '과대 광고 문구 원천 차단'],
    status: 'ACTIVE',
    correlationId: 'corr_test_123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  beforeEach(() => {
    registry = new MissionContractRegistry()
  })

  it('validates a complete and compliant mission contract successfully', () => {
    const result = validateMissionContract(validContract)
    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects contract missing businessGoal or correlationId', () => {
    const invalid = { ...validContract, businessGoal: '', correlationId: '' }
    const result = validateMissionContract(invalid)

    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('businessGoal is required to ensure outcome focus')
    expect(result.errors).toContain('correlationId is required for traceable execution')
  })

  it('rejects contract without safety rules', () => {
    const invalid = { ...validContract, safetyRules: [] }
    const result = validateMissionContract(invalid)

    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('safetyRules must contain at least one boundary rule')
  })

  it('registers and retrieves missions by workspace', () => {
    registry.register(validContract)

    const found = registry.get('msn-spring-promo')
    expect(found).toBeDefined()
    expect(found?.title).toBe('봄맞이 신규 고객 유치 및 예약 프로모션')

    const list = registry.listByWorkspace('ws-main')
    expect(list).toHaveLength(1)
  })

  it('updates stage with correlation tracking', () => {
    registry.register(validContract)

    const updated = registry.updateStage('msn-spring-promo', 'EXECUTE', 'corr_new_span_456')
    expect(updated.stage).toBe('EXECUTE')
    expect(updated.correlationId).toBe('corr_new_span_456')

    const active = registry.listActive('ws-main')
    expect(active[0].stage).toBe('EXECUTE')
  })
})
