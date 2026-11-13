import { isMarketingFixtureWorkspace, CapacityNotObservedError } from './fixture-context';
import { BYREUM_SERVICE_CATALOG } from './fixtures/marketing-samples';
import { ChannelKey } from '../types';
import { AvailabilitySourceService } from './capacity-source';

// ==========================================
// 1. Canonical Customer Model
// ==========================================
export type CustomerLifecycleStage = 
  | 'lead' 
  | 'inquiry' 
  | 'consulting' 
  | 'booked' 
  | 'loyal' 
  | 'churn_risk';

export type BookingIntentLevel = 'none' | 'low' | 'medium' | 'high';

export interface ChannelIdentity {
  channel: ChannelKey;
  channelUserId: string;
  handle?: string;
}

export interface CanonicalCustomer {
  id: string;
  workspaceId: string;
  displayName: string;
  phone?: string;
  identities: ChannelIdentity[];
  firstSeenAt: string;
  lastSeenAt: string;
  interestedServices: string[];
  lifecycleStage: CustomerLifecycleStage;
  bookingIntent: BookingIntentLevel;
  lastInteractionAt: string;
  tags: string[];
  notes?: string;
}

// ==========================================
// 2. Conversation & Message Model
// ==========================================
export type ConversationStatus = 
  | 'UNREAD' 
  | 'TRIAGED' 
  | 'CONSULTING' 
  | 'BOOKING_INTENT' 
  | 'BOOKING_PENDING' 
  | 'BOOKED' 
  | 'RESOLVED';

export type MessageRiskTier = 'GREEN' | 'YELLOW' | 'RED';

export interface MessageItem {
  id: string;
  sender: 'customer' | 'sohee' | 'owner';
  text: string;
  sentAt: string;
  riskTier: MessageRiskTier;
  escalationRequired?: boolean;
  escalationReason?: string;
  decisionCardId?: string;
}

export interface CustomerConversation {
  id: string;
  workspaceId: string;
  customerId: string;
  channel: ChannelKey;
  externalThreadId: string;
  status: ConversationStatus;
  messages: MessageItem[];
  riskTier: MessageRiskTier;
  escalationRequired: boolean;
  escalationReason?: string;
  sourceContentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HumanDecisionCard {
  id: string;
  workspaceId: string;
  conversationId: string;
  customerId: string;
  title: string;
  question: string;
  customerContext: string;
  soheeFindings: string;
  options: Array<{
    id: string;
    label: string;
    actionType: 'approve_custom' | 'reject' | 'manual_reply';
  }>;
  status: 'pending' | 'resolved';
  resolvedOptionId?: string;
  resolvedAt?: string;
}

// ==========================================
// 3. Reservation Domain Model (P0)
// ==========================================
export type ReservationStatus = 
  | 'INTENT_DETECTED'
  | 'NEEDS_INFO'
  | 'SLOT_SEARCH'
  | 'SLOT_PROPOSED'
  | 'CUSTOMER_SELECTED'
  | 'CONFIRMATION_PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'EXPIRED';

export type VisitStatus = 'scheduled' | 'visited' | 'no_show' | 'cancelled';

export interface ValidSlot {
  slotIso: string;
  displayTime: string;
  isAvailable: boolean;
}

export interface ReservationDomain {
  id: string;
  workspaceId: string;
  customerId: string;
  serviceId: string;
  serviceName: string;
  requestedSlots: string[];
  selectedSlot?: string;
  status: ReservationStatus;
  sourceChannel: ChannelKey;
  sourceConversationId?: string;
  sourceContentId?: string;
  createdBy: 'customer' | 'owner' | 'sohee';
  proposedAt?: string;
  confirmedAt?: string;
  completedAt?: string;
  visitStatus: VisitStatus;
  depositAmount?: number;
  totalAmount?: number;
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// 4. Revenue Loop & Attribution
// ==========================================
export interface RevenueLoopTrace {
  id: string;
  workspaceId: string;
  contentId?: string;
  channelKey: ChannelKey;
  engagementType: 'like' | 'comment' | 'dm_inquiry' | 'profile_click';
  customerId: string;
  conversationId: string;
  reservationId?: string;
  realizedRevenue: number | null;
  attributionConfidence: number; // 0.0 ~ 1.0 (calibrated)
  stepCompleted: 'engagement' | 'inquiry' | 'consultation' | 'reservation' | 'visit' | 'revenue';
  createdAt: string;
}

// ==========================================
// 5. Customer & Reservation Domain Engine
// ==========================================
export class CustomerReservationRevenueEngine {
  private customers = new Map<string, CanonicalCustomer>();
  private conversations = new Map<string, CustomerConversation>();
  private reservations = new Map<string, ReservationDomain>();
  private decisionCards = new Map<string, HumanDecisionCard>();
  private revenueTraces: RevenueLoopTrace[] = [];

  // 1. 고객 식별 및 통합 (Canonical Integration)
  findOrCreateCustomer(input: {
    workspaceId: string;
    channel: ChannelKey;
    channelUserId: string;
    displayName: string;
    handle?: string;
  }): CanonicalCustomer {
    const { workspaceId, channel, channelUserId, displayName, handle } = input;

    for (const cust of this.customers.values()) {
      if (cust.workspaceId === workspaceId && cust.identities.some(i => i.channel === channel && i.channelUserId === channelUserId)) {
        cust.lastSeenAt = new Date().toISOString();
        cust.lastInteractionAt = new Date().toISOString();
        return cust;
      }
    }

    const id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newCustomer: CanonicalCustomer = {
      id,
      workspaceId,
      displayName,
      identities: [{ channel, channelUserId, handle }],
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      interestedServices: [],
      lifecycleStage: 'inquiry',
      bookingIntent: 'low',
      lastInteractionAt: new Date().toISOString(),
      tags: ['신규유입'],
    };
    this.customers.set(id, newCustomer);
    return newCustomer;
  }

  // 2. 인바운드 메시지 처리 및 Risk Policy 판정 (GREEN/YELLOW/RED)
  processInboundMessage(input: {
    workspaceId: string;
    customerId: string;
    channel: ChannelKey;
    externalThreadId: string;
    text: string;
    sourceContentId?: string;
  }): {
    conversation: CustomerConversation;
    riskTier: MessageRiskTier;
    escalatedCard?: HumanDecisionCard;
    autoReplyText?: string;
    detectedIntent: 'general_info' | 'booking_inquiry' | 'complaint_refund' | 'price_discount';
  } {
    const { workspaceId, customerId, channel, externalThreadId, text, sourceContentId } = input;
    const now = new Date().toISOString();

    let conversation = Array.from(this.conversations.values()).find(
      c => c.workspaceId === workspaceId && c.customerId === customerId && c.channel === channel
    );

    if (!conversation) {
      conversation = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        customerId,
        channel,
        externalThreadId,
        status: 'UNREAD',
        messages: [],
        riskTier: 'GREEN',
        escalationRequired: false,
        sourceContentId,
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.set(conversation.id, conversation);
    }

    let riskTier: MessageRiskTier = 'GREEN';
    let detectedIntent: 'general_info' | 'booking_inquiry' | 'complaint_refund' | 'price_discount' = 'general_info';
    let escalatedCard: HumanDecisionCard | undefined;
    let autoReplyText: string | undefined;

    const lower = text.toLowerCase();
    if (lower.includes('환불') || lower.includes('불만') || lower.includes('망했') || lower.includes('피해보상')) {
      riskTier = 'RED';
      detectedIntent = 'complaint_refund';
      conversation.status = 'TRIAGED';
      conversation.riskTier = 'RED';
      conversation.escalationRequired = true;
      conversation.escalationReason = '환불 및 고객 불만 인입 (RED Action - 사람 확인 필수)';

      escalatedCard = {
        id: `card-${Date.now()}`,
        workspaceId,
        conversationId: conversation.id,
        customerId,
        title: '환불/불만 고객 긴급 확인 요청',
        question: '고객 환불 및 서비스 불만 메시지가 접수되었습니다. 사장님 직접 확인 및 답변이 필요합니다.',
        customerContext: `메시지: "${text}"`,
        soheeFindings: '규정상 환불 및 보상 관련 확답은 자율 발송이 금지되어 있습니다.',
        options: [
          { id: 'opt-1', label: '사장님 직접 통화/DM 답변', actionType: 'manual_reply' },
          { id: 'opt-2', label: '방문 점검 및 무료 리터치 안내', actionType: 'approve_custom' },
        ],
        status: 'pending',
      };
      this.decisionCards.set(escalatedCard.id, escalatedCard);

    } else if (lower.includes('영업시간') || lower.includes('운영시간') || lower.includes('위치') || lower.includes('주차') || lower.includes('어디')) {
      riskTier = 'GREEN';
      detectedIntent = 'general_info';
      conversation.status = 'CONSULTING';
      autoReplyText = '매장 운영시간과 위치는 확인 후 안내해 드리겠습니다.';

    } else if (lower.includes('예약') || lower.includes('슬롯') || lower.includes('비었') || lower.includes('시술 가능') || lower.includes('가능할까') || lower.includes('가능한가요')) {
      riskTier = 'YELLOW';
      detectedIntent = 'booking_inquiry';
      conversation.status = 'BOOKING_INTENT';
      conversation.riskTier = 'YELLOW';

      const customer = this.customers.get(customerId);
      if (customer) {
        customer.bookingIntent = 'high';
        customer.lifecycleStage = 'consulting';
      }

      // 실제 예약 가용 슬롯 조회
      let available: ReturnType<typeof AvailabilitySourceService.getAvailableSlots>;
      try {
        available = AvailabilitySourceService.getAvailableSlots(workspaceId);
      } catch (error) {
        if (!(error instanceof CapacityNotObservedError)) throw error;
        available = [];
      }
      const slotDesc = available.length > 0 ? `가장 빠른 가능 시간: ${available[0].slotStart.slice(5, 16)}` : '현재 가용 슬롯 확인 중';
      autoReplyText = `안녕하세요 매장입니다! 문의주신 예약 가능 시간을 확인해 드릴게요 (${slotDesc}). 원하시는 서비스 항목을 알려주시면 바로 확정 안내해 드리겠습니다 :)`;

    } else {
      riskTier = 'GREEN';
      detectedIntent = 'general_info';
      conversation.status = 'CONSULTING';
      autoReplyText = '안녕하세요! 궁금하신 점을 남겨주시면 친절하게 안내해 드릴게요 :)';
    }

    const incomingMsg: MessageItem = {
      id: `msg-${Date.now()}-in`,
      sender: 'customer',
      text,
      sentAt: now,
      riskTier,
      escalationRequired: riskTier === 'RED',
      escalationReason: escalatedCard?.question,
      decisionCardId: escalatedCard?.id,
    };
    conversation.messages.push(incomingMsg);

    if (autoReplyText) {
      conversation.messages.push({
        id: `msg-${Date.now()}-out`,
        sender: 'sohee',
        text: autoReplyText,
        sentAt: new Date(Date.now() + 1000).toISOString(),
        riskTier,
      });
    }

    return {
      conversation,
      riskTier,
      escalatedCard,
      autoReplyText,
      detectedIntent,
    };
  }

  // 3. 예약 슬롯 생성 및 확정 (P0 Reservation Domain - Source backed)
  createReservationProposal(input: {
    workspaceId: string;
    customerId: string;
    serviceId: string;
    serviceName?: string;
    proposedSlots: string[];
    sourceChannel: ChannelKey;
    sourceConversationId?: string;
    sourceContentId?: string;
  }): ReservationDomain {
    const { workspaceId, customerId, serviceId, proposedSlots, sourceChannel, sourceConversationId, sourceContentId } = input;
    const now = new Date().toISOString();

    // Service Catalog에서 실제 가격 및 정보 조회 (하드코딩 배제)
    const catalogItem = isMarketingFixtureWorkspace(workspaceId)
      ? BYREUM_SERVICE_CATALOG.find(s => s.id === serviceId) : undefined;
    const serviceName = catalogItem?.name || input.serviceName || '맞춤 시그니처 서비스';
    const totalAmount = catalogItem?.price;

    const reservation: ReservationDomain = {
      id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      workspaceId,
      customerId,
      serviceId,
      serviceName,
      requestedSlots: proposedSlots,
      status: 'SLOT_PROPOSED',
      sourceChannel,
      sourceConversationId,
      sourceContentId,
      createdBy: 'sohee',
      proposedAt: now,
      visitStatus: 'scheduled',
      totalAmount,
      createdAt: now,
      updatedAt: now,
    };

    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  confirmReservation(
    reservationId: string,
    selectedSlot: string,
    depositPaidAmount?: number
  ): ReservationDomain {
    const res = this.reservations.get(reservationId);
    if (!res) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    if (!isMarketingFixtureWorkspace(res.workspaceId)) throw new CapacityNotObservedError();

    if (depositPaidAmount !== undefined) {
      res.depositAmount = Math.max(0, depositPaidAmount);
    }

    res.selectedSlot = selectedSlot;
    res.status = 'CONFIRMED';
    res.confirmedAt = new Date().toISOString();
    res.updatedAt = new Date().toISOString();

    const customer = this.customers.get(res.customerId);
    if (customer) {
      customer.lifecycleStage = 'booked';
      customer.tags.push('예약확정고객');
    }

    if (res.sourceConversationId) {
      const conv = this.conversations.get(res.sourceConversationId);
      if (conv) {
        conv.status = 'BOOKED';
      }
    }

    // Missing payment evidence is unknown, not a measured zero.
    const paymentAmount = res.depositAmount ?? depositPaidAmount;
    const realizedRevenue = paymentAmount === undefined ? null : Math.max(0, paymentAmount);

    this.recordRevenueLoopEvent({
      workspaceId: res.workspaceId,
      contentId: res.sourceContentId,
      channelKey: res.sourceChannel,
      engagementType: 'dm_inquiry',
      customerId: res.customerId,
      conversationId: res.sourceConversationId || '',
      reservationId: res.id,
      realizedRevenue,
      attributionConfidence: realizedRevenue !== null && realizedRevenue > 0 ? 0.9 : 0.0,
      stepCompleted: 'reservation',
    });

    return res;
  }

  recordRevenueLoopEvent(input: Omit<RevenueLoopTrace, 'id' | 'createdAt'>): RevenueLoopTrace {
    const trace: RevenueLoopTrace = {
      ...input,
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    this.revenueTraces.push(trace);
    return trace;
  }

  getRevenueTraces(workspaceId: string): RevenueLoopTrace[] {
    return this.revenueTraces.filter(t => t.workspaceId === workspaceId);
  }

  getReservations(workspaceId: string): ReservationDomain[] {
    return Array.from(this.reservations.values()).filter(r => r.workspaceId === workspaceId);
  }

  getCustomers(workspaceId: string): CanonicalCustomer[] {
    return Array.from(this.customers.values()).filter(c => c.workspaceId === workspaceId);
  }

  getConversations(workspaceId: string): CustomerConversation[] {
    return Array.from(this.conversations.values()).filter(c => c.workspaceId === workspaceId);
  }
}
