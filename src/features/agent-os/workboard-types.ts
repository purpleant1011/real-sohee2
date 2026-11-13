export type WorkboardRuntimeState =
  | 'RUNNING'
  | 'LEARNING'
  | 'OWNER_ACTION_REQUIRED'
  | 'PAUSED'
  | 'IDLE'
  | 'BLOCKED'
  | 'DEGRADED'

export type MissionStage =
  | 'DETECT'
  | 'PLAN'
  | 'CREATE_OR_EXECUTE'
  | 'VERIFY'
  | 'ATTRIBUTE'

export type RuleSourceType =
  | 'BUSINESS_TRUTH'
  | 'POLICY'
  | 'HARNESS'
  | 'CHARTER'

export type VerificationState =
  | 'VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'FAILED'

export type DataFreshness = 'FRESH' | 'STALE' | 'UNKNOWN'

export interface AppliedRule {
  id: string
  label: string
  sourceType: RuleSourceType
  sourceVersion: string | null
}

export interface WorkboardProof {
  id: string
  label: string
  verificationState: VerificationState
  verifiedAt: string | null
  evidenceId?: string
}

export interface WorkboardMission {
  id: string
  title: string
  businessGoal: string | null
  stage: MissionStage
  stageProgress: number // 0 ~ 100
}

export interface WorkboardNextAction {
  label: string
  scheduledAt: string | null
}

export interface WorkboardSnapshot {
  workspaceId: string
  runtimeState: WorkboardRuntimeState
  statusReason: string
  mission: WorkboardMission | null
  appliedRules: AppliedRule[]
  lastProof: WorkboardProof | null
  nextAction: WorkboardNextAction | null
  ownerActionRequiredCount: number
  freshness: DataFreshness
  datasetMode?: 'ACTUAL' | 'SHOWCASE_DEMO' | 'TEST'
  updatedAt: string
}
