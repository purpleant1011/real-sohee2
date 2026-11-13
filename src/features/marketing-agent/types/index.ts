/**
 * 소희 V0.8.7 마케팅 자율 에이전트 도메인 타입 정의
 * [ANI-136, ANI-137, ANI-138, ANI-139, ANI-140, ANI-141, ANI-142, ANI-145]
 */

// ==========================================
// 1. Data Provenance & Common
// ==========================================
export type DataProvenance = "measured" | "calculated" | "estimated";

export interface ProvenanceMetric<T = number> {
  value: T;
  provenance: DataProvenance;
  sourceDescription: string;
  measuredAt?: string;
}

// ==========================================
// 2. Goal Engine Types [ANI-136]
// ==========================================
export type GoalType = "booking_count" | "revenue_amount" | "reactivation_count" | "inquiry_conversion";
export type GoalPeriod = "weekly" | "monthly" | "custom";
export type GoalStatus = "active" | "achieved" | "missed" | "paused";

export interface BusinessGoal {
  id: string;
  workspaceId: string;
  title: string;
  type: GoalType;
  period: GoalPeriod;
  targetValue: number;
  currentValue: ProvenanceMetric<number>;
  unit: string;
  startDate: string;
  endDate: string;
  status: GoalStatus;
  remainingDays: number;
  remainingHours: number;
  gap: number;
  progressPercent: number;
  rationale: string;
}

// ==========================================
// 3. Opportunity Radar Types [ANI-137]
// ==========================================
export type OpportunityType = 
  | "empty_slot"            // 빈 예약 슬롯 발생
  | "unbooked_inquiry"      // 미예약 문의 고객 재접촉
  | "revisit_timing"        // 시술 주기 도래 기존 고객
  | "review_gap"            // 리뷰 미작성 고객 또는 미답변 리뷰
  | "content_anomaly"       // 특정 콘텐츠 반응 급상승/저하
  | "channel_health_alert";  // 채널 토큰 만료 또는 연결 불안정

export type OpportunityUrgency = "today" | "within_3_days" | "this_week" | "low";
export type OpportunityConfidence = "high" | "medium" | "low";
export type OpportunityStatus = "detected" | "converted_to_mission" | "dismissed" | "expired";

export interface OpportunityEvidence {
  label: string;
  value: string;
  provenance: DataProvenance;
}

export interface Opportunity {
  id: string;
  workspaceId: string;
  title: string;
  type: OpportunityType;
  urgency: OpportunityUrgency;
  confidence: OpportunityConfidence;
  confidenceScore: number; // 0 ~ 100
  summary: string;
  detailedWhy: string;
  evidences: OpportunityEvidence[];
  expectedImpact: {
    label: string;
    value: string;
    provenance: DataProvenance;
  };
  expectedCost: {
    amount: number;
    unit: string;
    provenance: DataProvenance;
  };
  recommendedActionTitle: string;
  recommendedActionDescription: string;
  requiresApproval: boolean;
  status: OpportunityStatus;
  createdAt: string;
  expiresAt: string;
}

// ==========================================
// 4. Mission Engine Types [ANI-138]
// ==========================================
export type ActionRiskTier = "autonomous_safe" | "approval_required" | "prohibited";
export type MissionStepStatus = "pending" | "in_progress" | "awaiting_approval" | "completed" | "failed" | "skipped";
export type MissionStatus = "planning" | "running" | "paused" | "completed" | "aborted";

export interface MissionStep {
  id: string;
  stepNumber: number;
  title: string;
  description: string;
  channelKey?: ChannelKey;
  riskTier: ActionRiskTier;
  status: MissionStepStatus;
  approvalRequiredReason?: string;
  payloadDraft?: Record<string, unknown>;
  executedAt?: string;
  resultSummary?: string;
}

export interface Mission {
  id: string;
  workspaceId: string;
  opportunityId?: string;
  goalId?: string;
  title: string;
  objective: string;
  status: MissionStatus;
  steps: MissionStep[];
  currentStepIndex: number;
  stopCondition: string;
  fallbackPlan: string;
  startedAt: string;
  completedAt?: string;
}

// ==========================================
// 5. Channel Capability Registry [ANI-142, ANI-143]
// ==========================================
export type ChannelKey = 
  | "instagram"
  | "threads"
  | "naver_blog"
  | "naver_place"
  | "daangn"
  | "kakaotalk_channel"
  | "google_business";

export type ActionExecutionMode = "api_direct" | "browser_connector" | "assisted_export" | "unsupported";

export interface ChannelCapability {
  channelKey: ChannelKey;
  channelDisplayName: string;
  connected: boolean;
  tokenExpiresAt?: string;
  isTokenExpiringSoon: boolean; // e.g. within 72h
  webhookActive: boolean;
  capabilities: {
    publishPost: ActionExecutionMode;
    schedulePost: ActionExecutionMode;
    replyComments: ActionExecutionMode;
    sendDirectMessage: ActionExecutionMode;
    replyReviews: ActionExecutionMode;
    collectAnalytics: ActionExecutionMode;
    manageProfile: ActionExecutionMode;
  };
  rateLimitRemaining?: number;
  lastHealthCheck: string;
  healthStatus: "healthy" | "warning" | "error" | "disconnected";
  statusMessage: string;
}

// ==========================================
// 6. Attribution Ledger Types [ANI-140]
// ==========================================
export type AttributionTouchpointType = 
  | "content_post" 
  | "direct_message_reply" 
  | "review_reply" 
  | "reactivation_ping" 
  | "place_optimization";

export type ContributionLevel = "direct" | "assisted" | "unclear";

export interface AttributionRecord {
  id: string;
  workspaceId: string;
  bookingId?: string;
  customerIdentifier: string; // 익명화 식별자
  touchpointType: AttributionTouchpointType;
  channelKey: ChannelKey;
  missionId?: string;
  occurredAt: string;
  conversionDate: string;
  revenueAmount: number;
  contributionLevel: ContributionLevel;
  confidenceScore: number;
  provenance: DataProvenance;
  evidenceChain: string[];
}

export interface AttributionSummary {
  periodLabel: string;
  totalInquiries: ProvenanceMetric<number>;
  totalRepliesSent: ProvenanceMetric<number>;
  totalBookings: ProvenanceMetric<number>;
  attributedBookingsDirect: ProvenanceMetric<number>;
  attributedBookingsAssisted: ProvenanceMetric<number>;
  totalAttributedRevenue: ProvenanceMetric<number>;
  funnelSteps: {
    label: string;
    count: number;
    subtext?: string;
  }[];
}

// ==========================================
// 7. Marketing Memory Types [ANI-141]
// ==========================================
export type MemoryCategory = 
  | "winning_hook"
  | "high_conversion_timing"
  | "owner_preference"
  | "owner_rejection"
  | "customer_objection"
  | "channel_pattern";

export type MemoryConfidence = "verified_fact" | "high_confidence_inference" | "tentative_inference";

export interface MarketingMemoryItem {
  id: string;
  workspaceId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  confidence: MemoryConfidence;
  sourceMissionId?: string;
  sourceContext: string;
  positiveImpactCount: number;
  negativeFeedbackCount: number;
  createdAt: string;
  lastReinforcedAt: string;
  decayScore: number; // 0 ~ 1.0 (최신성 및 유효성 점수)
  isUserEditable: boolean;
}

// ==========================================
// 8. Autonomy Guardrails & Policy [ANI-145]
// ==========================================
export interface AutonomyPolicy {
  workspaceId: string;
  globalKillSwitchActive: boolean;
  channelKillSwitches: Record<ChannelKey, boolean>;
  maxAutoMessagesPerDay: number;
  maxAdSpendPerMonth: number;
  recontactCooldownDays: number;
  requireApprovalForExternalSend: boolean;
  requireApprovalForPublish: boolean;
  prohibitedKeywords: string[];
  safeHoursOnly: boolean; // e.g. 09:00 ~ 21:00 발송 제한
}
