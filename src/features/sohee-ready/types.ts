export const SOHEE_READINESS_FACT_KEYS = [
  'BUSINESS_VERIFIED',
  'INSTAGRAM_VERIFIED',
  'THREADS_VERIFIED',
  'BUSINESS_KNOWLEDGE_CONFIRMED',
  'TEXT_HARNESS_CONFIRMED',
  'IMAGE_HARNESS_CONFIRMED',
  'OPERATING_POLICY_CONFIRMED',
] as const;

export type SoheeReadinessFactKey = (typeof SOHEE_READINESS_FACT_KEYS)[number];

export type ReadinessFactStatus = 'VERIFIED' | 'CONFIRMED' | 'PENDING' | 'MISSING' | 'REJECTED' | 'STALE' | 'READY_DEGRADED';

export interface ReadinessFactProvenance {
  key: SoheeReadinessFactKey;
  verified: boolean;
  status: ReadinessFactStatus;
  source: string;
  evidenceId: string | null;
  version: string | number | null;
  verifiedAt: string | null;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN';
  reason?: string;
}

export type ReadinessBlockerCode =
  | 'BUSINESS_NOT_VERIFIED'
  | 'INSTAGRAM_NOT_VERIFIED'
  | 'THREADS_NOT_VERIFIED'
  | 'BUSINESS_KNOWLEDGE_NOT_CONFIRMED'
  | 'TEXT_HARNESS_NOT_CONFIRMED'
  | 'IMAGE_HARNESS_NOT_CONFIRMED'
  | 'OPERATING_POLICY_NOT_CONFIRMED';

export interface ReadinessBlocker {
  code: ReadinessBlockerCode;
  factKey: SoheeReadinessFactKey;
  message: string;
  remediationAction: string;
  remediationHref: string;
}

export interface SoheeReadinessSnapshot {
  workspaceId: string;
  ready: boolean;
  facts: Record<SoheeReadinessFactKey, ReadinessFactProvenance>;
  blockers: ReadinessBlocker[];
  evaluatedAt: string;
}

export interface AdmissionContext {
  action:
    | 'MISSION_CREATE'
    | 'AGENT_EXECUTE'
    | 'PRODUCTION_PUBLISH'
    | 'AUTOMATION_RUN'
    | 'EXTERNAL_DISPATCH'
    | 'TEST_PUBLISH'
    | 'META_PUBLISH'
    | 'INSTANT_PUBLISH'
    | 'CONTENT_CREATE'
    | 'CONTENT_APPROVE'
    | 'IMAGE_GENERATE'
    | (string & {});
  actorId?: string;
  supabaseClient?: any;
  readinessSnapshot?: SoheeReadinessSnapshot;
}

export class SoheeNotReadyError extends Error {
  public readonly code = 'SOHEE_NOT_READY';
  public readonly statusCode = 403;
  public readonly snapshot: SoheeReadinessSnapshot;
  public membershipTier?: string;
  public membershipNotice?: string;
  public notice?: string;

  constructor(
    snapshot: SoheeReadinessSnapshot,
    action?: string,
    extra?: { membershipTier?: string; membershipNotice?: string }
  ) {
    const blockerSummaries = snapshot.blockers.map((b) => b.message).join(' | ');
    const actionLabel = action ? ` (${action})` : '';
    super(
      `[SOHEE_NOT_READY] 소희가 아직 실제 마케팅 업무를 수행할 준비가 되지 않았습니다${actionLabel}. 미완료 필수 준비 항목: [${blockerSummaries}]`
    );
    this.name = 'SoheeNotReadyError';
    this.snapshot = snapshot;
    if (extra?.membershipTier) {
      this.membershipTier = extra.membershipTier;
    }
    if (extra?.membershipNotice) {
      this.membershipNotice = extra.membershipNotice;
      this.notice = extra.membershipNotice;
    }
  }
}
