import { describe, it, expect } from 'vitest'
import { mapCustomerInteractions } from './customer-workspace.mapper'
import type { ChannelInteraction } from '@/features/channels/interaction-repository'

describe('customer-workspace.mapper', () => {
  it('ChannelInteraction 목록을 CustomerInteraction 모델로 올바르게 변환한다', () => {
    const interactions: ChannelInteraction[] = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        channel: 'instagram',
        category: 'dm',
        occurredAt: new Date().toISOString(),
        inboundText: '가을 앰플 케어 예약 가능한가요?',
        responseJobId: null,
        responseText: '안녕하세요! 네 예약 가능합니다.',
        responseStatus: 'draft',
        responseApprovedAt: null,
        deliveryStatus: null,
        deliveryErrorCode: null,
        content: null,
        schedule: null,
      },
    ]

    const mapped = mapCustomerInteractions({ interactions })

    expect(mapped.length).toBe(1)
    expect(mapped[0].id).toBe('00000000-0000-0000-0000-000000000001')
    expect(mapped[0].channel).toBe('instagram')
    expect(mapped[0].lastMessage).toBe('가을 앰플 케어 예약 가능한가요?')
    expect(mapped[0].stage).toBe('consulting')
    expect(mapped[0].suggestedDrafts.fast_short).toBeDefined()
    expect(mapped[0].suggestedDrafts.warm_friendly).toBeDefined()
    expect(mapped[0].suggestedDrafts.booking_focused).toBeDefined()
  })

  it('데이터가 비어있을 때 기본 가이드 고객 목록을 반환한다', () => {
    const mapped = mapCustomerInteractions({ interactions: [] })

    expect(mapped.length).toBeGreaterThan(0)
    expect(mapped[0].customerName).toBe('김하늘 님')
  })

  it('customer_uuid가 있는 conversations를 CustomerInteraction으로 매핑하여 정본 고객과 결합한다', () => {
    const conversations: any[] = [
      {
        id: 'conv-uuid-1',
        channel: 'instagram',
        status: 'open',
        displayLabel: '정본연결고객',
        summary: '주말 예약 상담 문의합니다.',
        latestMessageAt: '2026-11-09T10:00:00Z',
        customer_uuid: '00000000-0000-0000-0000-000000000001',
      },
    ]

    const mapped = mapCustomerInteractions({ interactions: [], conversations })
    expect(mapped.length).toBe(1)
    expect(mapped[0].id).toBe('conv-uuid-1')
    expect(mapped[0].customerName).toBe('정본연결고객')
    expect(mapped[0].customerUuid).toBe('00000000-0000-0000-0000-000000000001')
    expect(mapped[0].lastMessage).toBe('주말 예약 상담 문의합니다.')
  })
})
