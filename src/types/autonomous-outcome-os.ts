/**
 * SOHEE V0.9 Autonomous Outcome OS & Admin V0.4 Autonomous Operations Control Tower
 * Canonical Coupled Architecture Contracts (ANI-661 & ANI-686)
 *
 * Inviolable Laws:
 * 1. Owner manages outcomes, Sohee manages work.
 * 2. CODE_COMPLETE != VERIFIED != RELEASE_READY != PRODUCTION_VERIFIED != DONE.
 * 3. Provider Accepted != External Verified (Evidence-Based Completion).
 * 4. Model inference != Execution authorization (Deterministic Preflight required).
 */

export type AutonomyLevel =
  | 'A0_DISABLED'
  | 'A1_RECOMMEND'
  | 'A2_ACTION_APPROVAL'
  | 'A3_ENVELOPE_AUTONOMY'
  | 'A4_EXTENDED_TRUSTED';

export type KnowledgeFactLifecycle =
  | 'OBSERVED'
  | 'CANDIDATE'
  | 'CONFLICTED'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANONICAL'
  | 'SUPERSEDED';

export type GoalMetricType =
  | 'INQUIRY_COUNT'
  | 'CONSULTATION_COUNT'
  | 'BOOKING_COUNT'
  | 'OFFLINE_VISIT_COUNT'
  | 'REVIEW_COUNT'
  | 'REORDER_COUNT'
  | 'BRAND_AWARENESS_ENGAGEMENT';

export type ProposalStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'REVISED'
  | 'EXPIRED'
  | 'SUPERSEDED';

export type ApprovalSurface =
  | 'UI_PROPOSAL_INBOX'
  | 'SECONDARY_CHAT_DRAWER'
  | 'ADMIN_OPERATOR_OVERRIDE';

export type AutomationLifecycleState =
  | 'DRAFT'
  | 'PROPOSED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'RUNNING'
  | 'VERIFYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED'
  | 'ACTION_REQUIRED'
  | 'LEARNING'
  | 'REPLANNED';

export type AutomationTriggerType =
  | 'SCHEDULE_CRON'
  | 'ONE_SHOT_DATETIME'
  | 'WEBHOOK_EVENT'
  | 'OPPORTUNITY_SIGNAL'
  | 'THRESHOLD_GAP'
  | 'MANUAL_DISPATCH';

export type ActionRiskTier = 'R0_LOW' | 'R1_MODERATE' | 'R2_CRITICAL';

export type KillSwitchLevel =
  | 'GLOBAL'
  | 'PROVIDER_MCP'
  | 'WORKSPACE'
  | 'AUTOMATION'
  | 'CHANNEL';

export type AgentEnergyPlanTier =
  | 'FREE_TASTE'
  | 'TIER_150K_STARTER'
  | 'TIER_300K_GROWTH'
  | 'TIER_500K_PRO_SCALE';

// ---------------------------------------------------------------------------
// 1. Versioned Knowledge Harness (ANI-662, ANI-663)
// ---------------------------------------------------------------------------

export interface KnowledgeFactProvenance {
  sourceId: string;
  sourceType: 'USER_INPUT' | 'CHANNEL_READBACK' | 'OCR_DOCUMENT' | 'WEB_INSPECTION' | 'ADMIN_SEED';
  extractedAt: string;
  confidenceScore: number;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface BusinessIdentityFact {
  factKey: string;
  factValue: unknown;
  lifecycle: KnowledgeFactLifecycle;
  provenance: KnowledgeFactProvenance;
  lastConfirmedAt: string;
}

export interface OfferingItem {
  id: string;
  title: string;
  price: number;
  discountCapPercent: number;
  reservationRequired: boolean;
  inventoryState?: 'IN_STOCK' | 'LIMITED' | 'OUT_OF_STOCK';
  promotionalPriority: number; // 1 to 5
}

export interface WorkspaceKnowledgeHarness {
  harnessVersionId: string;
  workspaceId: string;
  versionNo: number;
  compiledAt: string;
  isActive: boolean;
  businessIdentity: {
    businessName: string;
    brandSummary: string;
    locationDistrict: string;
    operatingHours: string;
    contactChannels: string[];
    facts: Record<string, BusinessIdentityFact>;
  };
  offerings: OfferingItem[];
  audience: {
    primaryTarget: string;
    targetRegions: string[];
    restrictedDemographics: string[];
  };
  brandVoice: {
    tone: 'WARM_POLITE' | 'CALM_PROFESSIONAL' | 'VIBRANT_PLAYFUL';
    prohibitedKeywords: string[];
    mandatoryDisclaimers: string[];
    channelSpecificExpressions: Record<string, string>;
  };
  policies: {
    maxDiscountPercent: number;
    allowDirectMessaging: boolean;
    dmRequiresApproval: boolean;
    maxPostsPerDay: number;
    quietHoursStart: string; // e.g. "22:00"
    quietHoursEnd: string;   // e.g. "08:00"
  };
  channelTruth: Record<string, {
    connected: boolean;
    tenantId: string;
    verifiedHandle: string;
    supportedCapabilities: string[];
  }>;
}

// ---------------------------------------------------------------------------
// 2. Goals & Outcome Contracts (ANI-664)
// ---------------------------------------------------------------------------

export interface GoalContract {
  goalId: string;
  workspaceId: string;
  title: string;
  metricType: GoalMetricType;
  targetQuantity: number;
  currentProgress: number;
  periodStart: string;
  periodEnd: string;
  priorityScore: number;
  status: 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'PAUSED';
}

export interface VerifiedOutcomeReceipt {
  workspaceId: string;
  receiptId: string;
  goalId: string;
  automationRunId: string;
  metricType: GoalMetricType;
  deltaAchieved: number;
  evidenceSourceId: string;
  verifiedAt: string;
  costInAgentEnergy: number;
}

// ---------------------------------------------------------------------------
// 3. Work Proposals & Unified Approval Envelope (ANI-665, ANI-666)
// ---------------------------------------------------------------------------

export interface ApprovalEnvelope {
  envelopeId: string;
  workspaceId: string;
  title: string;
  autonomyLevel: AutonomyLevel;
  validFrom: string;
  validUntil: string;
  allowedChannels: string[];
  maxPostsPerDay: number;
  maxDiscountPercentAllowed: number;
  dmPolicy: 'AUTONOMOUS' | 'DRAFT_ONLY' | 'PROHIBITED';
  maxAgentEnergyCap: number;
  riskCeiling: ActionRiskTier;
  prohibitedActions: string[];
  approvedByUserId: string;
  approvedVia: ApprovalSurface;
  approvedAt: string;
}

export interface WorkProposal {
  proposalId: string;
  workspaceId: string;
  goalId: string;
  title: string;
  rationale: string;
  evidenceContext: string[];
  expectedOutcome: {
    metricType: GoalMetricType;
    estimatedMin: number;
    estimatedMax: number;
  };
  executionPlanSummary: string[];
  requiredCapabilities: string[];
  estimatedAgentEnergy: number;
  proposedEnvelope: Omit<ApprovalEnvelope, 'envelopeId' | 'approvedByUserId' | 'approvedVia' | 'approvedAt'>;
  status: ProposalStatus;
  createdAt: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// 4. Automation Definitions & Server State Machine (ANI-667, ANI-668)
// ---------------------------------------------------------------------------

export interface AutomationDefinition {
  automationId: string;
  workspaceId: string;
  goalId: string;
  harnessVersionId: string;
  agentBuildId: string;
  title: string;
  currentState: AutomationLifecycleState;
  triggerType: AutomationTriggerType;
  triggerSpec: {
    cronExpression?: string;
    oneShotAt?: string;
    eventFilter?: string;
    thresholdCondition?: string;
  };
  approvalEnvelopeId: string;
  requiredCapabilities: string[];
  targetChannels: string[];
  riskCeiling: ActionRiskTier;
  energyBudgetPerRun: number;
  monthlyEnergyBudget: number;
  cooldownMinutes: number;
  quietHoursEnforced: boolean;
  maxConcurrency: number;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunStep {
  stepId: string;
  runId: string;
  capabilityName: string;
  toolName: string;
  riskTier: ActionRiskTier;
  state: 'QUEUED' | 'EXECUTING' | 'VERIFYING' | 'COMPLETED' | 'FAILED' | 'RECONCILING';
  idempotencyKey: string;
  inputPayload: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
  externalEvidenceUrl?: string;
  externalObjectId?: string;
  errorDetail?: string;
  costEnergyUnits: number;
  startedAt: string;
  completedAt?: string;
}

export interface AutomationRun {
  runId: string;
  automationId: string;
  workspaceId: string;
  harnessVersionId: string;
  agentBuildId: string;
  state: AutomationLifecycleState;
  reservedEnergy: number;
  settledEnergy: number;
  steps: AutomationRunStep[];
  failureCode?: string;
  ownerInterventionRequired: boolean;
  startedAt: string;
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// 5. Agent Builds & Gemini 3.8 Flash Governance (ANI-669)
// ---------------------------------------------------------------------------

export interface AgentBuild {
  agentBuildId: string;
  buildTag: string; // e.g. "v0.9.0-gemini-flash-prod"
  primaryPlannerModel: 'gemini-3.8-flash';
  thinkingBudget: 'low' | 'medium' | 'high';
  systemPromptVersion: string;
  toolSchemaVersion: string;
  policyContractVersion: string;
  evalBenchmarkScore: number;
  isCanaryActive: boolean;
  releasedAt: string;
}

// ---------------------------------------------------------------------------
// 6. Deterministic Executor Preflight (ANI-671)
// ---------------------------------------------------------------------------

export interface DeterministicPreflightChecklist {
  workspaceLifecycleActive: boolean;
  agentEnergySufficient: boolean;
  channelConnectedAndValid: boolean;
  mcpCapabilityEntitled: boolean;
  consentDelegationValid: boolean;
  withinApprovalEnvelope: boolean;
  withinRiskCeiling: boolean;
  quietHoursRespected: boolean;
  cooldownSatisfied: boolean;
  killSwitchUnengaged: boolean;
  idempotencyReserved: boolean;
}

export interface PreflightEvaluation {
  allowed: boolean;
  reason?: string;
  failedCheck?: keyof DeterministicPreflightChecklist;
  checklist: DeterministicPreflightChecklist;
}

// ---------------------------------------------------------------------------
// 7. Agent Energy Ledger (ANI-673, ANI-679)
// ---------------------------------------------------------------------------

export interface AgentEnergyLedger {
  workspaceId: string;
  planTier: AgentEnergyPlanTier;
  monthlyTotalEnergy: number;
  usedEnergyCurrentMonth: number;
  reservedEnergyActiveRuns: number;
  remainingAvailableEnergy: number;
  burnRatePercentage: number;
  budgetAlertStage: 'NORMAL' | 'STAGE_70_OPTIMIZE' | 'STAGE_85_DEFER' | 'STAGE_95_RESTRICT' | 'EXHAUSTED';
  forecastRunOutDays: number | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 8. Hierarchical Kill Switch (ANI-693)
// ---------------------------------------------------------------------------

export interface HierarchicalKillSwitchRecord {
  id: string;
  level: KillSwitchLevel;
  targetIdentifier: string; // e.g. "GLOBAL", "meta_publishing", "workspace_123", "automation_456"
  isEngaged: boolean;
  engagedReason: string;
  engagedByAdminId: string;
  engagedAt: string;
  releasedAt?: string;
}

// ---------------------------------------------------------------------------
// 9. V0.9 3rd Revision Release Gate & Done Evidence State Machine (ANI-755)
// ---------------------------------------------------------------------------

export type ReleaseLifecycleState =
  | 'CODE_COMPLETE'
  | 'TESTED'
  | 'RELEASE_READY'
  | 'DEPLOYED'
  | 'PRODUCTION_VERIFIED'
  | 'DONE';

export interface ProductionReleaseEvidenceBundle {
  issueId: string;
  commitSha: string;
  gitCleanTree: boolean;
  ciWorkflowRunId: string;
  ciWorkflowStatus: 'SUCCESS' | 'FAILED';
  deployedProductionSha: string;
  deployedEnvironment: 'production' | 'staging';
  authenticatedWorkspaceActor: {
    userId: string;
    workspaceId: string;
    accountRole: string;
    isDemoSandbox: boolean;
  };
  authoritativeReceipt: {
    receiptId: string;
    providerObjectId: string;
    externalUrl: string;
    verifiedAt: string;
    verificationMethod: string;
  };
  creditReconciliation: {
    reservedCredits: number;
    settledCredits: number;
    reconciledAt: string;
  };
  gateAttestationTimestamp: string;
  verifiedByAuditor: string;
  status: 'VERIFIED_DONE' | 'REJECTED_EVIDENCE_INSUFFICIENT';
}

// ---------------------------------------------------------------------------
// 10. Canonical External Action Verification State Machine (ANI-758)
// ---------------------------------------------------------------------------

export type CanonicalActionVerificationState =
  | 'PLANNED'
  | 'QUEUED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'RESULT_UNKNOWN'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFY_FAILED'
  | 'FAILED';

// ---------------------------------------------------------------------------
// 11. Universal Cost→Credit Metering & Weekly Credit Economy (ANI-759, ANI-779)
// ---------------------------------------------------------------------------

export type CreditGrantType =
  | 'FREE_TASTE'
  | 'WEEKLY_BASE'
  | 'ADMIN_BONUS'
  | 'PROMOTION'
  | 'COMPENSATION'
  | 'RESET_PASS_REFILL';

export interface ModelPricingCard {
  modelId: string;
  provider: string;
  displayName: string;
  version: string;
  inputTokenCostPerMillionUsd: number;
  outputTokenCostPerMillionUsd: number;
  cachedTokenCostPerMillionUsd: number;
  reasoningTokenCostPerMillionUsd: number;
  imageCostPerUnitUsd?: number;
  videoCostPerMinuteUsd?: number;
  browserCostPerMinuteUsd?: number;
  fixedCostPerInvocationUsd?: number;
  usdToKrwFxRate: number;
  cogsToCreditMultiplier: number; // 1 credit = e.g. 10 KRW
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface UniversalProviderUsageSnapshot {
  workspaceId: string;
  runId: string;
  actionId: string;
  capabilityId: string;
  provider: string;
  model: string;
  modelPricingVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  imageUnits: number;
  videoMinutes: number;
  browserDurationMs: number;
  rawProviderCostUsd: number;
  normalizedInternalCogsKrw: number;
  chargeableCogsKrw: number;
  chargedCredits: number;
  capturedAt: string;
}

export interface WeeklyCreditCycle {
  cycleId: string;
  workspaceId: string;
  entitlementId: string;
  planTier: AgentEnergyPlanTier;
  cycleStartAt: string;
  nextResetAt: string;
  weeklyAllowanceCredits: number;
  usedBaseCredits: number;
  usedBonusCredits: number;
  reservedCredits: number;
  remainingBaseCredits: number;
  bonusRemainingCredits: number;
  totalAvailableCredits: number;
  cycleStatus: 'ACTIVE' | 'EXPIRED' | 'RECONCILED';
}

export interface ResetPassRecord {
  passId: string;
  workspaceId: string;
  passCode: string;
  maxRefillCeilingCredits: number;
  actualRefilledCredits: number;
  redeemedAt?: string;
  redeemedByUserId?: string;
  expiresAt: string;
  status: 'AVAILABLE' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';
}

