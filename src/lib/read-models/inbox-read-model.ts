import { RiskTier, ActionStatus } from './types';

export interface InboxMessage {
  id: string;
  sender: 'customer' | 'agent' | 'user';
  content: string;
  timestamp: string;
  channel: string;
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed';
}

export interface ConversationItem {
  id: string;
  customerName: string;
  customerPhoneMasked: string;
  channel: 'KakaoTalk' | 'Instagram DM' | 'Naver TalkTalk' | 'Daangn';
  channelIconKey: string;
  intent: 'high_booking_intent' | 'price_inquiry' | 'treatment_info' | 'complaint' | 'general';
  urgency: 'high' | 'medium' | 'low';
  lastMessage: string;
  lastMessageAt: string;
  unread: boolean;
  consentStatus: 'agreed' | 'pending' | 'refused';
  ownerHandoffNeeded: boolean;
  handoffReason?: string;
  aiDraft?: {
    suggestedText: string;
    memorySource?: string;
    faqId?: string;
    confidence: number;
    riskTier: RiskTier;
    status: ActionStatus;
  };
  messages: InboxMessage[];
  customerHistory: {
    totalVisits: number;
    lastVisitDate?: string;
    preferredTreatments: string[];
    memo?: string;
  };
}

export interface InboxReadModel {
  workspaceId: string;
  totalConversations: number;
  unreadCount: number;
  conversations: ConversationItem[];
}

export interface GetInboxParams {
  workspaceId: string;
  isDemo?: boolean;
}

export function getInboxReadModel(params: GetInboxParams): InboxReadModel {
  if (!params.isDemo) {
    return {
      workspaceId: params.workspaceId,
      totalConversations: 0,
      unreadCount: 0,
      conversations: [],
    };
  }

  const conversations: ConversationItem[] = [
    {
      id: 'conv-001',
      customerName: '김*아 님',
      customerPhoneMasked: '010-****-5821',
      channel: 'KakaoTalk',
      channelIconKey: 'kakaotalk',
      intent: 'high_booking_intent',
      urgency: 'high',
      lastMessage: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?',
      lastMessageAt: '12분 전',
      unread: true,
      consentStatus: 'agreed',
      ownerHandoffNeeded: false,
      aiDraft: {
        suggestedText: '안녕하세요 김*아 고객님, 바이름 청라입니다. 문의주신 목요일(9/3) 오후 2시와 4시 30분에 시술 가능하십니다! 편하신 시간 말씀해주시면 바로 예약 도와드릴게요 :)',
        memorySource: '네이버 예약 캘린더 잔여 슬롯 + 바이름 시술 안내 FAQ',
        confidence: 0.94,
        riskTier: 'low',
        status: 'draft',
      },
      customerHistory: {
        totalVisits: 2,
        lastVisitDate: '2026-07-15',
        preferredTreatments: ['블랙틴팅 속눈썹펌'],
        memo: '눈시림에 예민하시니 저자극 글루 사용',
      },
      messages: [
        {
          id: 'msg-1',
          sender: 'customer',
          content: '안녕하세요! 지난번에 펌 너무 맘에 들어서 다시 연락드렸어요.',
          timestamp: '2026-08-30 20:45',
          channel: 'KakaoTalk',
        },
        {
          id: 'msg-2',
          sender: 'customer',
          content: '목요일 오후에 속눈썹펌 예약 가능한 시간 있을까요?',
          timestamp: '2026-08-30 20:48',
          channel: 'KakaoTalk',
        },
      ],
    },
    {
      id: 'conv-002',
      customerName: '이*진 님',
      customerPhoneMasked: '010-****-9104',
      channel: 'Instagram DM',
      channelIconKey: 'instagram',
      intent: 'price_inquiry',
      urgency: 'medium',
      lastMessage: '스킨플래닝이랑 수분케어 같이 받으면 가격이 어떻게 되나요?',
      lastMessageAt: '1시간 전',
      unread: false,
      consentStatus: 'pending',
      ownerHandoffNeeded: false,
      aiDraft: {
        suggestedText: '안녕하세요 고객님! 스킨플래닝+수분진정 패키지는 정가 120,000원에서 첫방문 시 20% 할인된 96,000원에 진행 가능합니다. 소요시간은 약 70분입니다.',
        memorySource: '바이름 2026 정식 가격표 & 첫방문 프로모션 룰',
        confidence: 0.98,
        riskTier: 'low',
        status: 'draft',
      },
      customerHistory: {
        totalVisits: 0,
        preferredTreatments: ['스킨플래닝'],
      },
      messages: [
        {
          id: 'msg-3',
          sender: 'customer',
          content: '스킨플래닝이랑 수분케어 같이 받으면 가격이 어떻게 되나요?',
          timestamp: '2026-08-30 19:30',
          channel: 'Instagram DM',
        },
      ],
    },
    {
      id: 'conv-003',
      customerName: '박*영 님',
      customerPhoneMasked: '010-****-3312',
      channel: 'Naver TalkTalk',
      channelIconKey: 'naver_place',
      intent: 'treatment_info',
      urgency: 'low',
      lastMessage: '임산부도 속눈썹펌 받을 수 있는지 궁금해요.',
      lastMessageAt: '3시간 전',
      unread: false,
      consentStatus: 'agreed',
      ownerHandoffNeeded: true,
      handoffReason: '임산부 시술 관련 안전 규정 및 원장님 직접 상담 필요',
      aiDraft: {
        suggestedText: '임산부 고객님의 경우 안정기 이후 저자극 펌제로 시술을 도와드리고 있으나, 고객님의 컨디션 확인을 위해 원장님께서 직접 상세히 안내해드릴 예정입니다.',
        memorySource: '시술 안전 주의사항 가이드라인',
        confidence: 0.78,
        riskTier: 'medium',
        status: 'draft',
      },
      customerHistory: {
        totalVisits: 1,
        lastVisitDate: '2026-05-10',
        preferredTreatments: ['노글루 속눈썹펌'],
      },
      messages: [
        {
          id: 'msg-4',
          sender: 'customer',
          content: '임산부도 속눈썹펌 받을 수 있는지 궁금해요.',
          timestamp: '2026-08-30 17:15',
          channel: 'Naver TalkTalk',
        },
      ],
    },
  ];

  return {
    workspaceId: params.workspaceId,
    totalConversations: conversations.length,
    unreadCount: conversations.filter(c => c.unread).length,
    conversations,
  };
}
