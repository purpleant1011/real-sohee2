import { describe, it, expect, beforeEach } from 'vitest'
import { getMarketingMemories, addMarketingMemory } from '../marketing-memory'
import { AvailabilitySourceService, BYREUM_WORKSPACE_ID } from '../capacity-source'

describe('[ANI-1892] Fixture Isolation & Truth Integrity', () => {
  beforeEach(() => {
    AvailabilitySourceService.resetStateForTesting()
  })

  it('does not seed Byreum verified facts into an arbitrary new workspace', () => {
    const newWs = 'ws-brand-new-salon-999'
    const memories = getMarketingMemories(newWs)

    expect(memories).toHaveLength(0)
    expect(memories.some(m => m.title.includes('바이름') || m.content.includes('25년'))).toBe(false)
  })

  it('allows adding real memories to a new workspace without inheriting fixtures', () => {
    const newWs = 'ws-new-shop'
    addMarketingMemory({
      workspaceId: newWs,
      category: 'winning_hook',
      knowledgeType: 'fact',
      title: '첫 방문 20% 할인 반응 우수',
      content: '신규 고객 문의 시 20% 할인 안내가 가장 높은 예약 전환 기록',
      source: '사장님 피드백',
    })

    const memories = getMarketingMemories(newWs)
    expect(memories).toHaveLength(1)
    expect(memories[0].title).toBe('첫 방문 20% 할인 반응 우수')
    expect(memories[0].confidence).toBe('verified_fact')
  })

  it('does not clone fake slots for arbitrary workspaces with no real capacity data', () => {
    const newWs = 'ws-arbitrary-clean'
    expect(() => AvailabilitySourceService.getSnapshot(newWs)).toThrow(/NOT_OBSERVED/)
  })

  it('keeps slots only for explicit TEST fixture', () => {
    const seedSnapshot = AvailabilitySourceService.getSnapshot('fixture:TEST:marketing')
    expect(seedSnapshot.totalSlotsCount).toBeGreaterThan(0)
  })
})
