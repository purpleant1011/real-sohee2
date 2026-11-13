export type SurfaceRoute =
  | 'home'
  | 'content'
  | 'customers'
  | 'results'
  | 'sohee'
  | 'ads'
  | 'system'
  | 'missions'
  | 'unknown';

export interface SurfaceContextState {
  route: string;
  routeName: SurfaceRoute;
  tab?: string;
  selectedItemId?: string;
  missionId?: string;
  entityType?: 'post' | 'customer' | 'campaign' | 'rule' | 'ad' | 'setting' | 'mission';
  metadata?: Record<string, unknown>;
}

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export type ProposalType =
  | 'RULE_UPDATE'
  | 'SETTING_UPDATE'
  | 'CAMPAIGN_TRIGGER'
  | 'CONTENT_DRAFT'
  | 'AD_GUARDRAIL_UPDATE';

export interface ProposalPayload {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  targetField?: string;
  currentValue?: unknown;
  proposedValue: unknown;
  status: ProposalStatus;
  createdAt: string;
  /** 서버 승인 레코드 버전. 있으면 승인 요청에 expectedVersion 으로 보낸다 (ANI-1778). */
  version?: number;
  /** 서버 원본 proposalType (예: DM_SEND_APPROVAL). 실행될 외부 쓰기 종류를 가른다. */
  approvalType?: string;
}

export type ExceptionSeverity = 'WARNING' | 'CRITICAL' | 'INFO';
export type ExceptionCategory =
  | 'TONE_CHECK'
  | 'IMAGE_APPROVAL'
  | 'BUDGET_LIMIT'
  | 'SYSTEM_BLOCKED'
  | 'OWNER_ACTION_REQUIRED';

export interface OwnerException {
  id: string;
  title: string;
  description: string;
  severity: ExceptionSeverity;
  category: ExceptionCategory;
  proposal?: ProposalPayload;
  createdAt: string;
}

export type NaturalLanguageCommandType = 'PAUSE' | 'RESUME' | 'EMERGENCY_STOP' | 'NONE';

export interface ParsedControlCommand {
  type: NaturalLanguageCommandType;
  rawQuery: string;
  confidence: number;
  reason: string;
}
