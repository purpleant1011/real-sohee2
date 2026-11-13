/**
 * CRM & Booking & Human Handoff SSOT Types
 * 
 * ANI-850: Customer Identity Resolution Graph
 * ANI-851: Booking Lifecycle Closed Loop
 * ANI-852: CRM Write Provenance & Consent
 * ANI-853: Human Handoff Runtime
 */

export type ChannelIdentityType =
  | 'PHONE_NUMBER'
  | 'INSTAGRAM_HANDLE'
  | 'KAKAO_TALK_ID'
  | 'NAVER_USER_ID'
  | 'WEB_COOKIE_ID'
  | 'EMAIL';

export interface ChannelIdentity {
  type: ChannelIdentityType;
  value: string;
  sourceChannel: string;
  firstSeenAt: string;
  lastSeenAt: string;
  confidenceScore: number; // 0.0 ~ 1.0
}

export interface CanonicalCustomer {
  customerId: string;
  workspaceId: string;
  primaryName?: string;
  primaryPhone?: string;
  identities: ChannelIdentity[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  notes?: string;
}

/**
 * ANI-851: 예약 라이프사이클 8단계 상태 머신
 */
export type BookingStatus =
  | 'LEAD'
  | 'INTENT'
  | 'HOLD'
  | 'CONFIRMED'
  | 'VISITED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'REVENUE_ATTRIBUTED';

export interface BookingRecord {
  bookingId: string;
  workspaceId: string;
  customerId: string;
  serviceName: string;
  slotStartTime: string;
  slotEndTime: string;
  status: BookingStatus;
  statusHistory: Array<{
    status: BookingStatus;
    changedAt: string;
    reason?: string;
  }>;
  holdExpiresAt?: string; // HOLD 상태의 선점 만료 시간
  revenueKrw?: number; // VISITED / REVENUE_ATTRIBUTED 시 확정 매출
  attributedSourceEventId?: string; // 성과 귀속 대상 마케팅 이벤트
  createdAt: string;
  updatedAt: string;
}

/**
 * ANI-852: CRM 필드 쓰기 출처 및 개인정보 동의 기록
 */
export type ConsentStatus = 'CONSENT_GRANTED' | 'CONSENT_DENIED' | 'CONSENT_EXPIRED';

export interface CrmFieldWriteProvenance {
  recordId: string;
  workspaceId: string;
  customerId: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  source: 'INSTAGRAM_DM_PARSER' | 'KAKAO_BOT' | 'NAVER_BOOKING' | 'MANUAL_ADMIN_INPUT' | 'CSV_IMPORT';
  consentStatus: ConsentStatus;
  consentAcquiredAt?: string;
  retentionExpiresAt: string; // 개인정보 보존 만료일 (기본 1년/3년)
  operatorId?: string;
  writtenAt: string;
  auditDigest: string; // SHA-256
}

/**
 * ANI-853: 사람 운영자 핸드오프 런타임
 */
export type HandoffStatus = 'ROBOT_ACTIVE' | 'HANDED_OFF' | 'RETURNED_TO_BOT';

export interface HandoffTicket {
  ticketId: string;
  workspaceId: string;
  customerId: string;
  channel: string;
  triggerReason: 'LOW_CONFIDENCE' | 'COMPLAINT_DETECTED' | 'REFUND_REQUEST' | 'USER_EXPLICIT_REQUEST';
  confidenceScore: number;
  lastCustomerMessage: string;
  handoffStatus: HandoffStatus;
  assignedOperatorId?: string;
  handedOffAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}
