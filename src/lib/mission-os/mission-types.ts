export type MissionStatus =
  | 'RECEIVED'
  | 'PLANNING'
  | 'PRODUCING'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'PUBLISHED_VERIFIED'
  | 'LISTENING'
  | 'CUSTOMER_ENGAGED'
  | 'BOOKING_INTENT'
  | 'BOOKED'
  | 'OUTCOME_OBSERVED'
  | 'LEARNING'
  | 'NEXT_ACTION_READY'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'RESULT_UNKNOWN'
  | 'PAUSED'
  | 'CANCELLED'

export type {
  ExecutionState,
  OutcomeState,
  ObservationStatus,
  MissionContract,
  ObservationEvidence,
  SuccessCriterion,
  ObservationWindow,
  BudgetCaps,
  AttentionPolicy,
  OwnerActor,
} from './mission-contract'

export type MissionActorType = 'user' | 'agent' | 'system' | 'provider' | 'operator'

export function normalizeActorType(raw?: string | null): MissionActorType {
  if (!raw) return 'agent'
  const lower = raw.toLowerCase()
  if (lower === 'user') return 'user'
  if (lower === 'ai_agent' || lower === 'agent') return 'agent'
  if (lower === 'system') return 'system'
  if (lower === 'provider') return 'provider'
  if (lower === 'operator') return 'operator'
  return 'agent'
}

export interface MissionEvent {
  id: string
  workspace_id: string
  mission_id: string
  trace_id: string
  from_status: MissionStatus | null
  to_status: MissionStatus
  actor_type: MissionActorType
  actor_id?: string | null
  event_name: string
  payload?: Record<string, unknown>
  occurred_at: string
}

export interface MarketingMissionAggregate {
  id: string
  workspace_id: string
  trace_id: string
  status: MissionStatus
  goal: string
  strategy_summary?: string | null
  target_channel?: string | null
  target_audience?: string | null
  source_message_id?: string | null
  source_conversation_job_id?: string | null
  content_id?: string | null
  content_version_id?: string | null
  approval_id?: string | null
  external_action_request_id?: string | null
  external_action_attempt_id?: string | null
  external_action_receipt_id?: string | null
  customer_id?: string | null
  booking_id?: string | null
  outcome_id?: string | null
  next_action_id?: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}
