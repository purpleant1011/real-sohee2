import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { mapLegacyStatusToDualState } from '@/lib/mission-os/mission-state-machine'
import type { ExecutionState, OutcomeState } from '@/lib/mission-os/mission-types'

export type TraceActorBadge = 'USER' | 'AGENT' | 'DB' | 'PROVIDER' | 'CUSTOMER' | 'OPERATOR'

export type TraceStageStatus = 'OBSERVED' | 'NOT_OBSERVED'

export interface TraceStageItem {
  stageIndex: number
  stageName:
    | 'USER_REQUEST'
    | 'AGENT_PLANNING'
    | 'CONTENT_PRODUCED'
    | 'EXACT_APPROVAL'
    | 'PROVIDER_PUBLISH'
    | 'INBOUND_CUSTOMER'
    | 'BOOKING_CONFIRMED'
    | 'NEXT_ACTION_READY'
  title: string
  actorBadge: TraceActorBadge
  status: TraceStageStatus
  occurredAt?: string | null
  evidenceRef?: string | null
  details?: Record<string, unknown>
}

export interface MissionTraceView {
  missionId: string
  workspaceId: string
  traceId: string
  overallStatus: string
  executionState?: ExecutionState
  execution_state?: ExecutionState
  outcomeState?: OutcomeState
  outcome_state?: OutcomeState
  goal: string
  stages: TraceStageItem[]
  totalObservedStages?: number
  generatedAt: string
}

export class AdminMissionTraceProjection {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Projects a single mission into an authoritative end-to-end 8-stage timeline.
   */
  public async projectMissionTrace(
    workspaceId: string,
    missionId: string
  ): Promise<MissionTraceView> {
    const { data: mission, error } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (error || !mission) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found for workspace '${workspaceId}'`)
    }

    return projectMissionTraceTimeline(mission)
  }
}

export function projectMissionTraceTimeline(
  mission: any,
  _auditEvents?: any[]
): MissionTraceView {
  const dualState = mapLegacyStatusToDualState(mission?.status, mission?.metadata)

  const stages: TraceStageItem[] = []

  // Stage 1: USER_REQUEST
  const hasUserRequest = Boolean(mission?.goal || mission?.created_at)
  stages.push({
    stageIndex: 1,
    stageName: 'USER_REQUEST',
    title: mission?.goal ? `원장님 마케팅 요청: "${mission.goal}"` : '마케팅 요청 대기',
    actorBadge: 'USER',
    status: hasUserRequest ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasUserRequest ? (mission?.created_at || null) : null,
    evidenceRef: mission?.source_message_id || null,
  })

  // Stage 2: AGENT_PLANNING
  const hasPlanning =
    Boolean((mission?.status && mission.status !== 'RECEIVED' && mission.status !== 'DRAFT') || mission?.strategy_summary)
  stages.push({
    stageIndex: 2,
    stageName: 'AGENT_PLANNING',
    title: '소희 AI 마케팅 미션 및 전략 수립',
    actorBadge: 'AGENT',
    status: hasPlanning ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasPlanning ? (mission?.created_at || null) : null,
    evidenceRef: hasPlanning && mission?.id ? `mission:${mission.id}` : null,
    details: {
      targetChannel: mission?.target_channel || null,
      strategySummary: mission?.strategy_summary || null,
    },
  })

  // Stage 3: CONTENT_PRODUCED
  const hasContent = Boolean(mission?.content_id || mission?.content_version_id)
  stages.push({
    stageIndex: 3,
    stageName: 'CONTENT_PRODUCED',
    title: hasContent
      ? `맞춤 마케팅 콘텐츠 및 에셋 생성 완료 (${mission.content_version_id || mission.content_id})`
      : '콘텐츠 생성 미완료',
    actorBadge: 'AGENT',
    status: hasContent ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasContent ? (mission?.updated_at || mission?.created_at || null) : null,
    evidenceRef: hasContent ? (mission?.content_version_id || mission?.content_id) : null,
  })

  // Stage 4: EXACT_APPROVAL
  const hasApproval = Boolean(mission?.approval_id)
  stages.push({
    stageIndex: 4,
    stageName: 'EXACT_APPROVAL',
    title: hasApproval
      ? `원장님 정밀 버전 승인 완료 (${mission.approval_id})`
      : '승인 대기 중',
    actorBadge: 'USER',
    status: hasApproval ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasApproval ? (mission?.updated_at || null) : null,
    evidenceRef: hasApproval ? mission?.approval_id : null,
  })

  // Stage 5: PROVIDER_PUBLISH
  const hasPublishRef = Boolean(mission?.external_action_receipt_id || mission?.metadata?.provider_post_reference)
  const isPublishVerified = Boolean(
    mission?.status === 'PUBLISHED_VERIFIED' ||
    mission?.metadata?.readbackConfirmedAt ||
    mission?.metadata?.readback_status === 'VERIFIED' ||
    mission?.metadata?.executionResult?.overallStatus === 'ALL_VERIFIED'
  )
  stages.push({
    stageIndex: 5,
    stageName: 'PROVIDER_PUBLISH',
    title: !hasPublishRef
      ? '채널 발행 미완료'
      : isPublishVerified
        ? `외부 채널 실제 발행 검증 완료 (Post Ref: ${mission?.metadata?.provider_post_reference || mission?.external_action_receipt_id})`
        : `외부 채널 접수 기록 연결 (발행 검증 미확인 - Post Ref: ${mission?.metadata?.provider_post_reference || mission?.external_action_receipt_id || '접수 기록'})`,
    actorBadge: 'PROVIDER',
    status: hasPublishRef ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasPublishRef ? (mission?.updated_at || null) : null,
    evidenceRef: hasPublishRef ? (mission?.external_action_receipt_id || mission?.metadata?.provider_post_reference || null) : null,
  })

  // Stage 6: INBOUND_CUSTOMER
  const hasCustomer = Boolean(mission?.customer_id)
  stages.push({
    stageIndex: 6,
    stageName: 'INBOUND_CUSTOMER',
    title: hasCustomer
      ? `고객 인바운드 반응/댓글/DM 감지 (${mission.customer_id})`
      : '인바운드 반응 미감지',
    actorBadge: 'CUSTOMER',
    status: hasCustomer ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasCustomer ? (mission?.updated_at || null) : null,
    evidenceRef: hasCustomer ? mission?.customer_id : null,
  })

  // Stage 7: BOOKING_CONFIRMED
  const hasBooking = Boolean(mission?.booking_id)
  const isPaymentVerified = Boolean(
    mission?.metadata?.payment_verified ||
    mission?.metadata?.booking_payment_confirmed ||
    mission?.metadata?.verified_revenue_krw
  )
  stages.push({
    stageIndex: 7,
    stageName: 'BOOKING_CONFIRMED',
    title: !hasBooking
      ? '예약 확정 미관찰'
      : isPaymentVerified
        ? `예약 슬롯 확정 및 결제/영수증 연계 검증 완료 (${mission.booking_id})`
        : `예약 접수 기록 연결 (${mission.booking_id}) · 결제/정산 검증 미확인`,
    actorBadge: 'CUSTOMER',
    status: hasBooking ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasBooking ? (mission?.updated_at || null) : null,
    evidenceRef: hasBooking ? mission?.booking_id : null,
  })

  // Stage 8: NEXT_ACTION_READY
  const nextAction = mission?.metadata?.next_best_action
  const hasNextAction = Boolean(nextAction && (nextAction.title || nextAction.actionId))
  stages.push({
    stageIndex: 8,
    stageName: 'NEXT_ACTION_READY',
    title: hasNextAction
      ? `차기 추천 행동 수립: "${nextAction.title}"`
      : '차기 행동 수립 대기',
    actorBadge: 'AGENT',
    status: hasNextAction ? 'OBSERVED' : 'NOT_OBSERVED',
    occurredAt: hasNextAction ? (mission?.updated_at || null) : null,
    evidenceRef: hasNextAction ? (nextAction?.actionId || null) : null,
    details: hasNextAction ? nextAction : undefined,
  })

  const observedStages = stages.filter(s => s.status === 'OBSERVED')

  return {
    missionId: mission?.id,
    workspaceId: mission?.workspace_id,
    traceId: mission?.trace_id,
    overallStatus: mission?.status || 'UNKNOWN',
    executionState: dualState.executionState,
    execution_state: dualState.executionState,
    outcomeState: dualState.outcomeState,
    outcome_state: dualState.outcomeState,
    goal: mission?.goal,
    stages,
    totalObservedStages: observedStages.length,
    generatedAt: new Date().toISOString(),
  }
}

