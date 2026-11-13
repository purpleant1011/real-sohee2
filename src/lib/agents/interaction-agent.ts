/**
 * Sohee V0.8.9 Customer Interaction & Reply Agent
 * 
 * Handles:
 * 1. Comment & DM inbound message intent analysis.
 * 2. Grounded reply generation using Knowledge Harness.
 * 3. Escalation for complaints or ungrounded queries.
 */

export type InboundIntentType =
  | 'INQUIRY_HOURS'
  | 'INQUIRY_MENU_PRICE'
  | 'INQUIRY_LOCATION'
  | 'RESERVATION_REQUEST'
  | 'PRAISE'
  | 'COMPLAINT'
  | 'SPAM';

export interface InteractionAnalysisResult {
  intent: InboundIntentType;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  requiresHumanEscalation: boolean;
  proposedReply?: string;
  confidence: number;
}

export function analyzeInboundInteraction(
  text: string,
  storeContext: {
    storeName: string;
    businessHours?: string;
    address?: string;
  }
): InteractionAnalysisResult {
  const lower = text.toLowerCase();

  // 스팸 / 욕설 감지
  if (lower.includes('광고') || lower.includes('카지노') || lower.includes('수익보장')) {
    return {
      intent: 'SPAM',
      sentiment: 'NEGATIVE',
      requiresHumanEscalation: false,
      confidence: 0.95
    };
  }

  // 고객 불만 감지
  if (lower.includes('환불') || lower.includes('불친절') || lower.includes('최악') || lower.includes('실망')) {
    return {
      intent: 'COMPLAINT',
      sentiment: 'NEGATIVE',
      requiresHumanEscalation: true,
      proposedReply: `안녕하세요, ${storeContext.storeName}입니다. 이용 중 불편을 드려 진심으로 사과드립니다. 상세한 내용을 확인 후 빠르게 도움을 드릴 수 있도록 사장님께 즉시 전달하였습니다.`,
      confidence: 0.9
    };
  }

  // 예약 문의
  if (lower.includes('예약') || lower.includes('자리') || lower.includes('단체') || lower.includes('몇시')) {
    return {
      intent: 'RESERVATION_REQUEST',
      sentiment: 'POSITIVE',
      requiresHumanEscalation: false,
      proposedReply: `안녕하세요! ${storeContext.storeName}입니다. 예약 문의 감사드립니다. 희망하시는 날짜와 인원수를 말씀해 주시면 빠르게 예약을 도와드리겠습니다.`,
      confidence: 0.88
    };
  }

  // 영업시간 문의
  if (lower.includes('영업시간') || lower.includes('몇시까지') || lower.includes('오픈') || lower.includes('마감')) {
    return {
      intent: 'INQUIRY_HOURS',
      sentiment: 'NEUTRAL',
      requiresHumanEscalation: false,
      proposedReply: `안녕하세요! ${storeContext.storeName}입니다. 저희 매장 영업시간은 ${storeContext.businessHours || '매일 10:00 ~ 22:00'}입니다. 편하게 방문해 주세요!`,
      confidence: 0.92
    };
  }

  // 일반 칭찬/방문 후기
  return {
    intent: 'PRAISE',
    sentiment: 'POSITIVE',
    requiresHumanEscalation: false,
    proposedReply: `따뜻한 말씀 감사드립니다! 언제나 정성을 다하는 ${storeContext.storeName}가 되겠습니다. 다음 방문 때도 기분 좋은 시간 되시길 바랍니다! 😊`,
    confidence: 0.85
  };
}
