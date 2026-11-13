export type RevenueGoalType = 'BOOKINGS' | 'OCCUPANCY' | 'REVENUE' | 'REPEAT_VISIT';

export interface RevenueGoal {
  id: string;
  workspaceId: string;
  goalType: RevenueGoalType;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  periodStart: string;
  periodEnd: string;
  targetServices: string[];
  targetSlots: string[];
  constraints: string[];
  status: 'ACTIVE' | 'ACHIEVED' | 'PAUSED' | 'CANCELLED';
}

export type OpportunityType =
  | 'UNDERFILLED_SLOT'
  | 'CANCELLATION_RECOVERY'
  | 'UNANSWERED_BOOKING_INTENT'
  | 'CONSULTATION_DROPOFF'
  | 'REPEAT_VISIT_DUE'
  | 'WAITLIST_MATCH'
  | 'HIGH_CONVERTING_CONTENT'
  | 'CHANNEL_RESPONSE_GAP';

export type OpportunityStatus = 'OPEN' | 'ACTING' | 'WAITING' | 'CONVERTED' | 'EXPIRED' | 'DISMISSED';

export interface RevenueOpportunity {
  id: string;
  workspaceId: string;
  type: OpportunityType;
  title: string;
  description: string;
  status: OpportunityStatus;
  evidenceRefs: string[];
  valueBand: { min: number; max: number; currency: string };
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  confidenceRationale: string;
  urgency: 'P0' | 'P1' | 'P2';
  expiresAt: string;
  targetSlotIds: string[];
  candidateCustomerIds: string[];
  allowedActionTypes: string[];
  constraints: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ActionCandidate {
  id: string;
  opportunityId: string;
  actionType: string;
  channel: 'instagram' | 'threads' | 'naver_blog' | 'kakao' | 'direct_dm';
  targetIdentity?: string;
  rationale: string;
  expectedOutcomeBand: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  approvalPolicy: 'AUTO' | 'CONFIRMATION_REQUIRED' | 'REVERSIBLE_GRACE';
  estimatedCreditCost: number;
  contactCost: number;
  stopConditions: string[];
  status: 'PENDING' | 'SELECTED' | 'EXECUTING' | 'VERIFIED' | 'CANCELLED_BY_STOP_CONDITION';
}

export interface CustomerReachability {
  customerId: string;
  workspaceId: string;
  channel: string;
  consentStatus: 'GRANTED' | 'WITHDRAWN' | 'TRANSACTIONAL_ONLY' | 'PENDING';
  lastOutboundAt?: string;
  outboundCountWindow: number; // rolling 7 days count
  cooldownUntil?: string;
  quietHours: { start: string; end: string }; // e.g. "21:00", "09:00"
  blockedReason?: string;
}

export interface DecisionRequest {
  id: string;
  workspaceId: string;
  subjectType: 'CUSTOMER_ESCALATION' | 'PRICE_DISCOUNT' | 'EXPENSIVE_CAMPAIGN' | 'POLICY_OVERRIDE';
  subjectId: string;
  question: string;
  evidenceRefs: string[];
  recommendation: string;
  impactIfApproved: string;
  impactIfRejected: string;
  riskLevel: 'RED' | 'YELLOW';
  deadline?: string;
  status: 'PENDING' | 'APPROVED_ONCE' | 'APPROVED_ALWAYS_POLICY' | 'REJECTED' | 'HANDLED_MANUALLY';
}

export interface AttributionLink {
  id: string;
  workspaceId: string;
  fromEntityType: 'CONTENT' | 'DM_MESSAGE' | 'CAMPAIGN' | 'REVIEW_REPLY';
  fromEntityId: string;
  toEntityType: 'RESERVATION' | 'PAYMENT' | 'CUSTOMER_VISIT';
  toEntityId: string;
  attributionType: 'DIRECT' | 'ASSISTED' | 'UNKNOWN';
  bookedValue?: number;
  realizedValue?: number;
  confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  evidenceRefs: string[];
  createdAt: string;
}
