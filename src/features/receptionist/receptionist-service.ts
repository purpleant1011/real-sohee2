export interface CallIntakeLog {
  id: string
  callerNumber: string
  callerName: string
  callTimestamp: string
  transcriptSummary: string
  requestedDateTime: string
  requestedService: string
  urgency: string
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED'
}

export class ReceptionistService {
  /**
   * Simulates/creates an AI receptionist call intake during busy treatment hours
   */
  static createIntakeRecord(params?: Partial<CallIntakeLog>): CallIntakeLog {
    return {
      id: `call_${Date.now()}`,
      callerNumber: params?.callerNumber || '010-9876-5432',
      callerName: params?.callerName || '이수진 님',
      callTimestamp: params?.callTimestamp || new Date().toISOString(),
      transcriptSummary:
        params?.transcriptSummary ||
        '시술 중 걸려온 전화: "내일 오후 4시 반에 속건조 앰플 케어 받을 수 있나요? 가격은 얼마인가요?" ➡️ 소희가 기본 가격(5만원) 및 내일 16:30 원장님 비어있는 슬롯으로 가예약 안내 완료.',
      requestedDateTime: params?.requestedDateTime || '2026-10-21 16:30',
      requestedService: params?.requestedService || '속건조 진정 앰플 케어',
      urgency: '시술 중 전화 접수 (30분 이내 확정 권장)',
      status: 'PENDING_CONFIRMATION',
    }
  }
}
