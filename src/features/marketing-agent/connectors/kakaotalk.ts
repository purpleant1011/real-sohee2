export interface KakaoSegmentCandidate {
  customerIdentifier: string;
  customerName: string;
  lastVisitDate: string;
  marketingConsent: boolean;
  serviceCategory: string;
  cooldownSatisfied: boolean;
}

export interface KakaoMessageSendResult {
  status: 'sent' | 'queued' | 'consent_denied' | 'error';
  externalMessageId?: string;
  error?: string;
}

export function filterRecontactSegment(
  candidates: KakaoSegmentCandidate[],
  cooldownDays: number = 7,
  now: Date = new Date()
): KakaoSegmentCandidate[] {
  return candidates.filter((c) => {
    if (!c.marketingConsent) return false;
    const lastVisit = new Date(c.lastVisitDate);
    const diffDays = (now.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= cooldownDays;
  });
}

export function generateKakaoFollowupDraft(
  customerName: string,
  proposedSlot: string,
  storeName: string = "바이름 청라"
): { templateId: string; message: string; isInformational: boolean } {
  return {
    templateId: "tpl_slot_followup_v1",
    message: `[홍보/안내] 안녕하세요, ${customerName}님! ${storeName}입니다. 문의주셨던 시술 관련하여 이번 주 ${proposedSlot} 잔여 예약 가능 슬롯이 있어 안내드립니다. 추가 질문이 있으시면 편하게 말씀해 주세요.`,
    isInformational: false,
  };
}

export async function sendKakaoFollowupMessage(params: {
  customer: KakaoSegmentCandidate;
  message: string;
  idempotencyKey: string;
}): Promise<KakaoMessageSendResult> {
  if (!params.customer.marketingConsent) {
    return {
      status: 'consent_denied',
      error: '고객 마케팅 수신 미동의로 전송이 차단되었습니다.',
    };
  }

  // Safe Provider Staging Execution Mock
  return {
    status: 'sent',
    externalMessageId: `kko-tx-${Date.now()}-${params.customer.customerIdentifier}`,
  };
}
