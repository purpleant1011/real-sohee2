import type { ChannelInteraction } from '@/features/channels/interaction-repository'
import type { CustomerConversation } from '@/features/reports/types'
import type { CustomerInteraction, ChannelSource, ConversationStage } from './customer-types'

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    if (diffMin < 1) return '방금 전'
    if (diffMin < 60) return `${diffMin}분 전`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}시간 전`
    return `${Math.floor(diffHours / 24)}일 전`
  } catch {
    return '최근'
  }
}

export function mapCustomerInteractions({
  interactions,
  conversations,
}: {
  interactions: readonly ChannelInteraction[]
  conversations?: readonly CustomerConversation[]
}): CustomerInteraction[] {
  const result: CustomerInteraction[] = []

  // 1. ChannelInteractions 매핑
  for (const item of interactions) {
    const channel: ChannelSource = item.channel === 'instagram' ? 'instagram' : 'threads'
    const stage: ConversationStage =
      item.responseStatus === 'sent'
        ? 'resolved'
        : item.responseStatus === 'approved'
        ? 'booking_pending'
        : item.responseStatus === 'draft'
        ? 'consulting'
        : 'unread'

    const timeAgo = formatTimeAgo(item.occurredAt)
    const inbound = item.inboundText ?? '새로운 문의가 도착했습니다.'
    const draftText = item.responseText ?? '안녕하세요! 문의해 주셔서 감사합니다. 편하신 예약 일정을 알려주시면 바로 안내 도와드리겠습니다.'

    result.push({
      id: item.id,
      channel,
      customerName: item.category === 'dm' ? 'DM 문의 고객' : '댓글 작성 고객',
      customerHandle: item.category === 'dm' ? '@customer_dm' : undefined,
      lastMessage: inbound,
      lastMessageAt: timeAgo,
      waitingMinutes: 15,
      priority: item.category === 'dm' ? 'urgent' : 'normal',
      stage,
      interestedService: item.content?.title ?? '서비스 및 예약 문의',
      bookingIntentScore: item.category === 'dm' ? 88 : 65,
      suggestedDrafts: {
        fast_short: {
          text: draftText,
          intentLabel: '빠르고 명확하게',
          action: 'send',
        },
        warm_friendly: {
          text: `안녕하세요! 소중한 관심 감사드려요 😊 ${draftText} 편하신 시간에 편히 방문해 주세요!`,
          intentLabel: '따뜻하고 친절하게',
          action: 'send',
        },
        booking_focused: {
          text: `안녕하세요! 이번 주에 바로 예약 가능한 자리가 있습니다. ${draftText} [예약 링크]`,
          intentLabel: '예약 바로 확정형',
          action: 'send_and_book',
        },
      },
      history: [
        { sender: 'customer', text: inbound, timestamp: timeAgo },
        ...(item.responseText
          ? [{ sender: 'sohee' as const, text: item.responseText, timestamp: '초안 생성됨' }]
          : []),
      ],
      customerUuid: (item as any).customerUuid ?? null,
    })
  }

  // 2. conversations 매핑 (정본 고객 customer_uuid 연계 지원)
  if (conversations && conversations.length > 0) {
    for (const conv of conversations) {
      const channel: ChannelSource = conv.channel === 'threads' ? 'threads' : 'instagram'
      const timeAgo = conv.latestMessageAt ? formatTimeAgo(conv.latestMessageAt) : '최근'
      const draftText = '안녕하세요! 문의해 주셔서 감사합니다. 편하신 예약 일정을 알려주시면 바로 안내 도와드리겠습니다.'
      result.push({
        id: conv.id,
        channel,
        customerName: conv.displayLabel || (conv as any).customer_name || '상담 고객',
        customerHandle: (conv as any).customerHandle,
        lastMessage: conv.summary || '새로운 문의가 도착했습니다.',
        lastMessageAt: timeAgo,
        waitingMinutes: 15,
        priority: 'normal',
        stage: conv.status === 'resolved' ? 'resolved' : 'consulting',
        interestedService: '서비스 및 예약 문의',
        bookingIntentScore: 80,
        suggestedDrafts: {
          fast_short: {
            text: draftText,
            intentLabel: '빠르고 명확하게',
            action: 'send',
          },
          warm_friendly: {
            text: `안녕하세요! 소중한 관심 감사드려요 😊 ${draftText}`,
            intentLabel: '따뜻하고 친절하게',
            action: 'send',
          },
          booking_focused: {
            text: `안녕하세요! 이번 주에 바로 예약 가능한 자리가 있습니다. ${draftText}`,
            intentLabel: '예약 바로 확정형',
            action: 'send_and_book',
          },
        },
        history: [
          { sender: 'customer', text: conv.summary || '문의 내용', timestamp: timeAgo },
        ],
        customerUuid: (conv as any).customer_uuid ?? (conv as any).customerUuid ?? null,
      })
    }
  }

  // 3. 기본 Mock이 아닌 초기 데이터 안내 (데이터가 전혀 없을 때 안내용)
  if (result.length === 0) {
    result.push(
      {
        id: 'guide-cust-01',
        channel: 'instagram',
        customerName: '김하늘 님',
        customerHandle: '@sky_beauty',
        lastMessage: '안녕하세요! 내일 오후 3시나 4시에 매장 서비스 상담 가능한가요?',
        lastMessageAt: '15분 전',
        waitingMinutes: 15,
        priority: 'urgent',
        stage: 'unread',
        interestedService: '시그니처 서비스 이용 상담',
        bookingIntentScore: 92,
        suggestedDrafts: {
          fast_short: {
            text: '안녕하세요 김하늘 님! 네, 내일 오후 3시 30분에 바로 상담 가능합니다. 편하신 시간을 알려주시면 바로 예약 확정해 드릴게요!',
            intentLabel: '빠르고 명확하게',
            action: 'send',
          },
          warm_friendly: {
            text: '안녕하세요 하늘 님! 매장 상담에 관심 가져주셔서 정말 감사드려요 😊 내일 오후 3시와 4시 모두 가능하십니다. 편하신 시간으로 모실게요!',
            intentLabel: '따뜻하고 친절하게',
            action: 'send',
          },
          booking_focused: {
            text: '안녕하세요 김하늘 님! 내일 오후 3시 30분에 1:1 맞춤 디자인 상담 자리가 준비되어 있습니다. 아래 링크에서 1분 만에 예약 확정하실 수 있어요! [예약 확정]',
            intentLabel: '예약 바로 확정형',
            action: 'send_and_book',
          },
        },
        history: [
          { sender: 'customer', text: '안녕하세요! 피드 보고 문의드려요.', timestamp: '14:20' },
          { sender: 'sohee', text: '안녕하세요! 반갑습니다. 어떤 점이 궁금하신가요?', timestamp: '14:21' },
          { sender: 'customer', text: '안녕하세요! 내일 오후 3시나 4시에 매장 서비스 상담 가능한가요?', timestamp: '14:25' },
        ],
      },
      {
        id: 'guide-cust-02',
        channel: 'naver_place',
        customerName: '이지수 님',
        lastMessage: '사장님께서 상담 때 꼭 맞는 서비스를 추천해주셔서 너무 만족스러웠어요!',
        lastMessageAt: '2시간 전',
        waitingMinutes: 120,
        priority: 'high',
        stage: 'consulting',
        interestedService: '포토 후기 답글 승인',
        bookingIntentScore: 78,
        suggestedDrafts: {
          fast_short: {
            text: '소중한 5점 포토 후기 감사드립니다 이지수 님! 다음 방문 시에도 완벽한 라인으로 보답하겠습니다.',
            intentLabel: '빠르고 명확하게',
            action: 'send',
          },
          warm_friendly: {
            text: '지수 님, 정성스러운 후기 남겨주셔서 매장 전체가 큰 힘을 얻었습니다 🥰 다음 리터치 때 봬요!',
            intentLabel: '따뜻하고 친절하게',
            action: 'send',
          },
          booking_focused: {
            text: '만족해 주셔서 정말 기쁩니다! 다음 리터치 주기는 4주 뒤가 가장 적절하며, 사전 예약 시 혜택이 적용됩니다.',
            intentLabel: '단골 재방문 유도형',
            action: 'send',
          },
        },
        history: [
          { sender: 'customer', text: '사장님께서 상담 때 꼭 맞는 서비스를 추천해주셔서 너무 만족스러웠어요!', timestamp: '12:30' },
        ],
      },
    )
  }

  return result
}
