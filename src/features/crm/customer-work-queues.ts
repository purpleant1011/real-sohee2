/**
 * Customer 4 Work Queues & Customer 360 Detail Model (ANI-1263)
 *
 * Replaces generic CRM table with 4 actionable operational queues:
 * 1. Now Reply Queue (지금 답해야 할 고객)
 * 2. High Probability Booking Queue (예약 가능성이 높은 고객)
 * 3. Confirmed / Changed Booking Queue (예약 확정 및 변경 고객)
 * 4. Human Review Queue (사람이 직접 확인해야 할 대화)
 */

export type CustomerWorkQueueType =
  | 'NOW_REPLY'
  | 'HIGH_PROBABILITY_BOOKING'
  | 'CONFIRMED_OR_CHANGED_BOOKING'
  | 'HUMAN_REVIEW';

export type CustomerIntentCategory =
  | 'PRICE_INQUIRY'
  | 'SERVICE_INQUIRY'
  | 'AVAILABILITY_CHECK'
  | 'BOOKING_INTENT'
  | 'COMPLAINT_OR_DISPUTE'
  | 'SENSITIVE_CARE'
  | 'GENERAL_CHAT';

export interface CustomerSummaryCard {
  customerId: string;
  workspaceId: string;
  channel: 'INSTAGRAM' | 'THREADS' | 'NAVER_TALKTALK' | 'SMS';
  customerHandle: string; // e.g. "@beauty_lover" or "010-****-5678"
  primaryIntent: CustomerIntentCategory;
  intentConfidence: number;
  lastMessageSnippet: string;
  lastInboundAt: string;
  waitTimeMinutes: number;
  isUrgent: boolean;
  assignedQueue: CustomerWorkQueueType;
  bookingStatus?: 'NONE' | 'SLOT_PROPOSED' | 'CONFIRMED' | 'CANCELLED';
  suggestedSlot?: string;
  soheeNextAction: string;
  relatedMissionId?: string;
}

export interface CustomerDetailRecord {
  customerId: string;
  workspaceId: string;
  channel: string;
  customerHandle: string;
  primaryIntent: CustomerIntentCategory;
  intentConfidence: number;
  recentMessages: Array<{
    sender: 'CUSTOMER' | 'SOHEE' | 'OWNER';
    text: string;
    timestamp: string;
  }>;
  interestedServices: string[];
  proposedSlots: string[];
  currentBookingId?: string;
  bookingStatus: 'NONE' | 'SLOT_PROPOSED' | 'CONFIRMED' | 'CANCELLED';
  relatedContentTitle?: string;
  relatedMissionId?: string;
  soheeNextAction: string;
  requiresHumanReview: boolean;
  humanReviewReason?: string;
  dataObservationState: 'OBSERVED' | 'NOT_OBSERVED';
}

export interface CustomerQueueAggregatedView {
  workspaceId: string;
  nowReplyQueue: CustomerSummaryCard[];
  highProbabilityBookingQueue: CustomerSummaryCard[];
  confirmedOrChangedBookingQueue: CustomerSummaryCard[];
  humanReviewQueue: CustomerSummaryCard[];
  totalActionableCount: number;
  observationStatus: 'OBSERVED' | 'NOT_OBSERVED';
  aggregatedAt: string;
}

export class CustomerWorkQueueManager {
  /**
   * 실시간 고객 대화 및 예약 상태로부터 4대 업무 큐를 분류 및 집계
   */
  classifyCustomerQueues(params: {
    workspaceId: string;
    customers: CustomerSummaryCard[];
    hasObservedIngress: boolean;
  }): CustomerQueueAggregatedView {
    const { workspaceId, customers, hasObservedIngress } = params;
    const now = new Date().toISOString();

    if (!hasObservedIngress && customers.length === 0) {
      return {
        workspaceId,
        nowReplyQueue: [],
        highProbabilityBookingQueue: [],
        confirmedOrChangedBookingQueue: [],
        humanReviewQueue: [],
        totalActionableCount: 0,
        observationStatus: 'NOT_OBSERVED',
        aggregatedAt: now,
      };
    }

    // Deduplication by customerId (keep latest)
    const uniqueMap = new Map<string, CustomerSummaryCard>();
    for (const c of customers) {
      uniqueMap.set(c.customerId, c);
    }
    const uniqueList = Array.from(uniqueMap.values());

    const nowReplyQueue: CustomerSummaryCard[] = [];
    const highProbabilityBookingQueue: CustomerSummaryCard[] = [];
    const confirmedOrChangedBookingQueue: CustomerSummaryCard[] = [];
    const humanReviewQueue: CustomerSummaryCard[] = [];

    for (const item of uniqueList) {
      // 1. 사람 확인이 필요한 대화 (최우선 분류)
      if (
        item.assignedQueue === 'HUMAN_REVIEW' ||
        item.primaryIntent === 'COMPLAINT_OR_DISPUTE' ||
        item.primaryIntent === 'SENSITIVE_CARE' ||
        item.intentConfidence < 0.65
      ) {
        humanReviewQueue.push({ ...item, assignedQueue: 'HUMAN_REVIEW' });
        continue;
      }

      // 2. 예약 확정 또는 변경 건
      if (
        item.assignedQueue === 'CONFIRMED_OR_CHANGED_BOOKING' ||
        item.bookingStatus === 'CONFIRMED'
      ) {
        confirmedOrChangedBookingQueue.push({ ...item, assignedQueue: 'CONFIRMED_OR_CHANGED_BOOKING' });
        continue;
      }

      // 3. 예약 가능성이 높은 고객 (예약 의도 감지 또는 슬롯 제안)
      if (
        item.assignedQueue === 'HIGH_PROBABILITY_BOOKING' ||
        item.primaryIntent === 'BOOKING_INTENT' ||
        item.bookingStatus === 'SLOT_PROPOSED'
      ) {
        highProbabilityBookingQueue.push({ ...item, assignedQueue: 'HIGH_PROBABILITY_BOOKING' });
        continue;
      }

      // 4. 일반 문의 및 지금 답해야 할 고객
      nowReplyQueue.push({ ...item, assignedQueue: 'NOW_REPLY' });
    }

    // 정렬: 대기 시간 긴 순서대로
    const sortByWait = (a: CustomerSummaryCard, b: CustomerSummaryCard) => b.waitTimeMinutes - a.waitTimeMinutes;
    nowReplyQueue.sort(sortByWait);
    highProbabilityBookingQueue.sort(sortByWait);
    confirmedOrChangedBookingQueue.sort(sortByWait);
    humanReviewQueue.sort(sortByWait);

    return {
      workspaceId,
      nowReplyQueue,
      highProbabilityBookingQueue,
      confirmedOrChangedBookingQueue,
      humanReviewQueue,
      totalActionableCount: uniqueList.length,
      observationStatus: 'OBSERVED',
      aggregatedAt: now,
    };
  }

  /**
   * 개인정보 보호 마스킹 뷰 생성
   */
  maskCustomerIdentity(handle: string): string {
    if (handle.startsWith('010')) {
      return handle.replace(/(\d{3})-?(\d{4})-?(\d{4})/, '$1-****-$3');
    }
    if (handle.startsWith('@') && handle.length > 4) {
      return `${handle.slice(0, 3)}***${handle.slice(-1)}`;
    }
    return handle;
  }
}
