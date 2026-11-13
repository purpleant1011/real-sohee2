import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { ObservationConfirmation } from '@/features/reporting/observation'

/** 예약 건수를 읽는 원장. 화면에 그대로 노출하지 않고 근거 표기용으로만 쓴다. */
const BOOKINGS_SOURCE = 'reservations.created_at/current_status'

export type HomeStatusBadge =
  | 'IN_PROGRESS'
  | 'ACTION_REQUIRED'
  | 'COMPLETED'
  | 'CONFIRMING'
  | 'FAILED'
  | 'CONNECTION_REQUIRED'
  | 'IDLE'

export type RevenueObservationState = 'OBSERVED' | 'NOT_OBSERVED' | 'ERROR'

export interface Home5PriorityView {
  hasActiveMission: boolean
  priority1_todayGoal: {
    goal: string
    targetChannel: string
    missionId?: string | null
    startedAt?: string | null
  }
  priority2_soheeWorkingOn: {
    statusBadge: HomeStatusBadge
    currentTaskSummary: string
    currentStage: string
    progressPercent: number
  }
  priority3_ownerDecisions: {
    requiresAction: boolean
    actionTitle: string
    actionType?: string | null
    targetId?: string | null
  }
  priority4_verifiedOutcome: {
    /** null = 예약 기록 조회 실패. 0건으로 단정하지 않는다. */
    confirmedBookingsCount: number | null
    /** 입금/결제 관측 근거가 연결되기 전에는 항상 null. 예약 금액을 매출로 대체하지 않는다. */
    verifiedRevenueKrw: number | null
    revenueState: RevenueObservationState
    /** 예약 건수를 읽은 원장. 조회 실패면 null. */
    bookingCountSource: string | null
    /** 예약 건수의 확인 상태. 조회 실패는 ERROR, 읽어서 확인한 0건은 CONFIRMED. */
    bookingCountConfirmation: ObservationConfirmation
    /** 수납(입금) 금액을 읽은 원장. 수납 원장 연결 전에는 null. */
    revenueSource: string | null
    /** 수납 확인 상태. 입금 근거가 연결되지 않았으므로 숫자를 그리지 않는다. */
    revenueConfirmation: ObservationConfirmation
    /** 예약 건수 근거가 서버 조회로 확인되었는지 여부 (조회 실패 시 false). */
    isSourceBacked: boolean
    narrative: string
  }
  priority5_nextBestAction: {
    actionId?: string | null
    title: string
    confidence: number
    requiresApproval: boolean
  }
}

export class Home5PriorityBuilder {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Constructs the concise Home 5 Priority Command Center view for salon owners.
   */
  public async buildHome5Priority(workspaceId: string): Promise<Home5PriorityView> {
    // 1. Fetch the latest active marketing mission
    const { data: missions } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)

    const activeMission = missions && missions.length > 0 ? missions[0] : null

    // 2. Fetch confirmed reservations for verified outcomes
    const { data: reservations, error: reservationsError } = await (this.client as any)
      .from('reservations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'CONFIRMED')

    const reservationsLookupFailed = Boolean(reservationsError)
    const confirmedBookingsCount = reservationsLookupFailed ? null : (reservations || []).length

    const priority4VerifiedOutcome: Home5PriorityView['priority4_verifiedOutcome'] = {
      confirmedBookingsCount,
      // 예약 금액(total_amount_krw/servicePrice)은 입금/결제 관측 근거가 아니므로 매출로 합산하지 않는다.
      verifiedRevenueKrw: null,
      revenueState: reservationsLookupFailed ? 'ERROR' : 'NOT_OBSERVED',
      // 예약 건수는 이 원장을 실제로 읽었을 때만 확인된 숫자다. 조회 실패면 출처도 남기지 않는다.
      bookingCountSource: reservationsLookupFailed ? null : BOOKINGS_SOURCE,
      bookingCountConfirmation: reservationsLookupFailed ? 'ERROR' : 'CONFIRMED',
      // 수납 원장은 아직 연결되지 않았다. 금액·출처를 만들지 않고 '확인 안 됨'으로 닫는다.
      revenueSource: null,
      revenueConfirmation: 'UNCONFIRMED',
      isSourceBacked: !reservationsLookupFailed,
      narrative: buildVerifiedOutcomeNarrative(confirmedBookingsCount),
    }

    if (!activeMission) {
      return {
        hasActiveMission: false,
        priority1_todayGoal: {
          goal: '현재 진행 중인 마케팅 업무가 없습니다. 소희에게 새로운 목표를 말씀해 주세요.',
          targetChannel: '인스타그램',
          missionId: null,
          startedAt: null,
        },
        priority2_soheeWorkingOn: {
          statusBadge: 'IDLE',
          currentTaskSummary: '소희가 사장님의 새로운 마케팅 지시를 대기하고 있습니다.',
          currentStage: '대기 중',
          progressPercent: 0,
        },
        priority3_ownerDecisions: {
          requiresAction: false,
          actionTitle: '현재 결정해야 할 대기 업무가 없습니다.',
        },
        priority4_verifiedOutcome: priority4VerifiedOutcome,
        priority5_nextBestAction: {
          actionId: null,
          title: '신규 마케팅 목표를 정하고 소희에게 대화로 시작해 보세요.',
          confidence: 90,
          requiresApproval: false,
        },
      }
    }

    // Map Mission Status to Badge & Task Summary
    let statusBadge: HomeStatusBadge = 'IN_PROGRESS'
    let currentTaskSummary = '소희가 마케팅 콘텐츠를 분석 및 준비 중입니다.'
    let progressPercent = 30
    let requiresOwnerAction = Boolean(activeMission.metadata?.owner_action_required)
    let decisionTitle = '현재 즉시 결정할 사항이 없습니다.'
    let actionType: string | null = null
    let targetId: string | null = null

    switch (activeMission.status) {
      case 'RECEIVED':
      case 'PLANNING':
        currentTaskSummary = '사장님의 요청을 바탕으로 최적의 마케팅 전략과 슬롯을 기획 중입니다.'
        progressPercent = 20
        break
      case 'PRODUCING':
        currentTaskSummary = '사장님의 매장 분위기에 맞춘 인스타그램 콘텐츠 및 이미지를 제작 중입니다.'
        progressPercent = 40
        break
      case 'AWAITING_APPROVAL':
        statusBadge = 'ACTION_REQUIRED'
        requiresOwnerAction = true
        currentTaskSummary = '콘텐츠 생성이 완료되어 사장님의 최종 버전 승인을 기다리고 있습니다.'
        decisionTitle = '새로운 마케팅 콘텐츠 초안 확인 및 발행 승인'
        actionType = 'CONTENT_APPROVAL'
        targetId = activeMission.content_version_id || activeMission.content_id
        progressPercent = 50
        break
      case 'APPROVED':
      case 'EXECUTING':
        currentTaskSummary = '승인된 콘텐츠를 인스타그램 피드에 정밀 발행 중입니다.'
        progressPercent = 65
        break
      case 'PUBLISHED_VERIFIED':
      case 'LISTENING':
        currentTaskSummary = '콘텐츠가 성공적으로 발행되어 고객 댓글 및 DM 반응을 실시간 모니터링 중입니다.'
        progressPercent = 75
        break
      case 'CUSTOMER_ENGAGED':
        currentTaskSummary = '새로운 고객 문의가 접수되어 소희가 1:1 응대 및 서비스 정보를 안내하고 있습니다.'
        progressPercent = 80
        break
      case 'BOOKING_INTENT':
        currentTaskSummary = '고객이 서비스 예약 의사를 밝혀 최적의 빈 슬롯 2~3개를 조율하고 있습니다.'
        progressPercent = 85
        break
      case 'BOOKED':
        statusBadge = 'COMPLETED'
        currentTaskSummary = `고객 예약이 확정되었습니다! (예약번호: ${activeMission.booking_id || '확인 완료'})`
        progressPercent = 90
        break
      case 'OUTCOME_OBSERVED':
      case 'LEARNING':
        currentTaskSummary = '예약 확정 성과를 바탕으로 이번 캠페인의 성공 패턴을 분석 및 학습 중입니다.'
        progressPercent = 95
        break
      case 'NEXT_ACTION_READY':
        statusBadge = 'ACTION_REQUIRED'
        requiresOwnerAction = true
        currentTaskSummary = '성과 학습이 완료되어 소희가 후속 마케팅 추천 행동을 준비했습니다.'
        decisionTitle = activeMission.metadata?.next_best_action?.title || '후속 마케팅 추천 행동 확인 및 실행'
        actionType = 'NEXT_BEST_ACTION'
        targetId = activeMission.metadata?.next_best_action?.actionId
        progressPercent = 100
        break
    }

    const nba = activeMission.metadata?.next_best_action || {
      actionId: null,
      title: '고객 반응 데이터를 지속 수집하고 있습니다.',
      confidence: 85,
      requiresApproval: false,
    }

    return {
      hasActiveMission: true,
      priority1_todayGoal: {
        goal: activeMission.goal,
        targetChannel: activeMission.target_channel === 'instagram' ? '인스타그램' : activeMission.target_channel || '인스타그램',
        missionId: activeMission.id,
        startedAt: activeMission.created_at,
      },
      priority2_soheeWorkingOn: {
        statusBadge,
        currentTaskSummary,
        currentStage: activeMission.status,
        progressPercent,
      },
      priority3_ownerDecisions: {
        requiresAction: requiresOwnerAction,
        actionTitle: decisionTitle,
        actionType,
        targetId,
      },
      priority4_verifiedOutcome: priority4VerifiedOutcome,
      priority5_nextBestAction: {
        actionId: nba.actionId,
        title: nba.title,
        confidence: nba.confidence || 90,
        requiresApproval: Boolean(nba.requiresApproval),
      },
    }
  }
}

function buildVerifiedOutcomeNarrative(confirmedBookingsCount: number | null): string {
  if (confirmedBookingsCount === null) {
    return '예약 기록을 확인하지 못했어요. 0건으로 계산하지 않았어요.'
  }
  if (confirmedBookingsCount > 0) {
    return `확정 예약 ${confirmedBookingsCount}건이 확인되었습니다. 매출은 입금 확인 근거가 연결되지 않아 표시하지 않아요.`
  }
  return '아직 확정된 예약 성과가 없습니다.'
}
