import { describe, it, expect } from 'vitest'
import { FiveSecondDecisionManager } from '../five-second-decision-card'

describe('FiveSecondDecisionManager Policy Copy Audit', () => {
  it('states deletion is done via official app instead of claiming direct deletion in Sohee', () => {
    const manager = new FiveSecondDecisionManager()
    const card = manager.createDecisionCard({
      cardId: 'card-1',
      workspaceId: 'ws-1',
      missionId: 'mis-1',
      actionType: 'PUBLISH_CONTENT',
      caption: '신메뉴 안내',
      channel: 'INSTAGRAM',
      accountHandle: '@cafe',
      missionGoal: '신메뉴 홍보',
      opportunityReason: '신메뉴 출시',
      timing: 'IMMEDIATE',
    })

    expect(card.reversibility.reversibilityNotice).not.toContain('소희에서 즉시 삭제 가능')
    expect(card.reversibility.reversibilityNotice).toContain('공식 앱에서 삭제 가능')
    expect(card.when.displayTimingText).not.toContain('즉시')
    expect(card.when.displayTimingText).toBe('승인 확인 후 발행')
  })
})
