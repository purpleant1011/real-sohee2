/**
 * Sohee V0.9 5th Update · Wave 3 Customer CRM
 * Customer Conversation → Intent → Booking → Visit → Revenue Closed Loop Model
 * 
 * Traceability: ANI-928
 */

export type CrmChannel = 'instagram' | 'naver' | 'daangn' | 'threads' | 'kakao';

export type CrmDatasetMode = 'ACTUAL' | 'CANARY' | 'TEST';

export type IntentCategory = 
  | 'PRICE_INQUIRY'
  | 'BOOKING_REQUEST'
  | 'RESCHEDULE'
  | 'RETRAIN_RETOUCH'
  | 'COMPLAINT_REFUND'
  | 'GENERAL_INQUIRY';

export type BookingStatus = 
  | 'SLOT_HELD'
  | 'CONFIRMED'
  | 'VISITED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface CustomerChannelProfile {
  channel: CrmChannel;
  handle: string;
  externalUserId: string;
  consentStatus: 'CONSENTED' | 'OPTED_OUT' | 'PENDING';
  consentedAt: string | null;
}

export interface CustomerIdentity {
  customerId: string;
  workspaceId: string;
  name: string;
  phone?: string;
  channels: CustomerChannelProfile[];
  provenance: {
    firstTouchChannel: CrmChannel;
    firstTouchPostId?: string;
    firstTouchCampaignId?: string;
    joinedAt: string;
  };
  vipLevel: 'NEW' | 'REGULAR' | 'VIP';
  requiresHumanHandoff: boolean;
  handoffReason?: string;
  datasetMode?: 'ACTUAL' | 'CANARY' | 'TEST';
}

export interface DialogueMessage {
  messageId: string;
  conversationId: string;
  sender: 'customer' | 'sohee' | 'owner';
  text: string;
  intent?: IntentCategory;
  confidence?: number;
  timestamp: string;
  requiresHumanHandoff?: boolean;
}

export interface CustomerConversation {
  conversationId: string;
  customerId: string;
  workspaceId: string;
  channel: CrmChannel;
  lastMessageAt: string;
  intent: IntentCategory;
  intentConfidence: number;
  messages: DialogueMessage[];
  status: 'ACTIVE' | 'RESOLVED' | 'HANDOFF_TO_HUMAN';
}

export interface BookingRecord {
  bookingId: string;
  workspaceId: string;
  customerId: string;
  conversationId: string;
  status: BookingStatus;
  serviceName: string;
  slotDateTime: string; // ISO string
  totalPriceKrw: number;
  depositPaidKrw: number;
  depositStatus: 'PAID' | 'PENDING' | 'REFUNDED';
  availabilityVerifiedAt: string; // Proof of availability read before hold
  readbackVerifiedAt?: string;
  createdAt: string;
}

export interface RevenueOutcome {
  outcomeId: string;
  workspaceId: string;
  bookingId: string;
  customerId: string;
  amountKrw: number;
  paidAt: string;
  paymentMethod: 'CARD' | 'BANK_TRANSFER' | 'CASH';
  attributedCampaignId?: string;
  evidenceId?: string;
}

export interface CustomerCanaryTrace {
  traceId: string;
  customerId: string;
  conversationId: string;
  bookingId?: string;
  outcomeId?: string;
  steps: {
    step: 'CONVERSATION' | 'INTENT' | 'SLOT_CHECK' | 'BOOKING_HOLD' | 'DEPOSIT_CONFIRM' | 'VISIT' | 'REVENUE';
    timestamp: string;
    detail: string;
    verified: boolean;
    evidenceId?: string;
  }[];
}

export interface PaymentTransaction {
  transactionId: string;
  workspaceId: string;
  bookingId: string;
  customerId: string;
  amountKrw: number;
  paymentType: 'DEPOSIT' | 'BALANCE' | 'FULL' | 'REFUND';
  paymentStatus: 'COMPLETED' | 'PENDING' | 'REFUNDED' | 'FAILED';
  paidAt: string;
  datasetMode: CrmDatasetMode;
  evidenceId?: string;
}

export interface VerifiedRevenueResult {
  totalKrw: number;
  verifiedCount: number;
  refundCount: number;
  refundedAmountKrw: number;
  hasMissingSource: boolean;
  rejectedCount: number;
}


