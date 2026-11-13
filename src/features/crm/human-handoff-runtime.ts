import { HandoffTicket, HandoffStatus } from './types';

export const SENSITIVE_KEYWORDS = [
  '환불',
  '고소',
  '소송',
  '경찰',
  '부작용',
  '화상',
  '염증',
  '피해보상',
  '사장님 바꿔',
  '상담원 연결',
  '사람이랑 통화',
  '손해배상',
];

export class HumanHandoffRuntime {
  private tickets: Map<string, HandoffTicket> = new Map();
  private activeHandoffsByCustomer: Map<string, string> = new Map(); // customerId -> ticketId

  /**
   * 고객 발화 분석 후 사람 운영자 핸드오프 필요성 평가 (ANI-853)
   */
  evaluateHandoffTrigger(params: {
    message: string;
    confidenceScore: number; // 0.0 ~ 1.0
  }): {
    shouldHandoff: boolean;
    reason?: HandoffTicket['triggerReason'];
    matchedKeyword?: string;
  } {
    const { message, confidenceScore } = params;
    const lower = message.toLowerCase();

    // 1. 민감 키워드 검사 (컴플레인, 부작용, 환불 등)
    for (const kw of SENSITIVE_KEYWORDS) {
      if (lower.includes(kw)) {
        if (kw.includes('환불')) {
          return { shouldHandoff: true, reason: 'REFUND_REQUEST', matchedKeyword: kw };
        }
        if (kw.includes('상담원') || kw.includes('사람') || kw.includes('사장님')) {
          return { shouldHandoff: true, reason: 'USER_EXPLICIT_REQUEST', matchedKeyword: kw };
        }
        return { shouldHandoff: true, reason: 'COMPLAINT_DETECTED', matchedKeyword: kw };
      }
    }

    // 2. 신뢰도 기준 미달 (confidence < 0.70)
    if (confidenceScore < 0.7) {
      return { shouldHandoff: true, reason: 'LOW_CONFIDENCE' };
    }

    return { shouldHandoff: false };
  }

  /**
   * 핸드오프 티켓 발급 및 봇 응답 차단 모드 진입
   */
  initiateHandoff(params: {
    workspaceId: string;
    customerId: string;
    channel: string;
    triggerReason: HandoffTicket['triggerReason'];
    confidenceScore: number;
    lastCustomerMessage: string;
  }): HandoffTicket {
    const {
      workspaceId,
      customerId,
      channel,
      triggerReason,
      confidenceScore,
      lastCustomerMessage,
    } = params;

    // 이미 활성 핸드오프가 있는 경우 기존 티켓 반환
    const existingTicketId = this.activeHandoffsByCustomer.get(customerId);
    if (existingTicketId) {
      const existing = this.tickets.get(existingTicketId);
      if (existing && existing.handoffStatus === 'HANDED_OFF') {
        return existing;
      }
    }

    const ticketId = `hnd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const ticket: HandoffTicket = {
      ticketId,
      workspaceId,
      customerId,
      channel,
      triggerReason,
      confidenceScore,
      lastCustomerMessage,
      handoffStatus: 'HANDED_OFF',
      handedOffAt: now,
    };

    this.tickets.set(ticketId, ticket);
    this.activeHandoffsByCustomer.set(customerId, ticketId);

    return ticket;
  }

  /**
   * 특정 고객이 현재 사람 운영자에게 이관된 상태인지 확인 (봇 응답 여부 결정)
   */
  isCustomerInHumanMode(customerId: string): boolean {
    const ticketId = this.activeHandoffsByCustomer.get(customerId);
    if (!ticketId) return false;
    const ticket = this.tickets.get(ticketId);
    return ticket?.handoffStatus === 'HANDED_OFF';
  }

  /**
   * 상담 완료 후 봇 자동응대 모드로 복귀
   */
  returnToBot(ticketId: string, operatorId: string, resolutionNote: string): HandoffTicket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) {
      throw new Error(`Handoff ticket not found: ${ticketId}`);
    }

    ticket.handoffStatus = 'RETURNED_TO_BOT';
    ticket.assignedOperatorId = operatorId;
    ticket.resolvedAt = new Date().toISOString();
    ticket.resolutionNote = resolutionNote;

    this.activeHandoffsByCustomer.delete(ticket.customerId);
    return ticket;
  }

  listUnresolvedTickets(workspaceId?: string): HandoffTicket[] {
    return Array.from(this.tickets.values()).filter((t) => {
      if (workspaceId && t.workspaceId !== workspaceId) return false;
      return t.handoffStatus === 'HANDED_OFF';
    });
  }
}
