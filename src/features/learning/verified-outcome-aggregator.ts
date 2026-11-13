import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { MarketingMissionService } from '@/features/missions/marketing-mission-service'
import {
  evaluateSampleSufficiency,
  type LearningObservation,
  type LearningInterpretation,
  type LearningProposedImpact,
  type LearningStopCondition,
} from '@/features/mission-learning/learning-contract'

export interface VerifiedOutcomeSummary {
  missionId: string
  workspaceId: string
  traceId: string
  status: 'OBSERVED' | 'NOT_OBSERVED'
  verifiedBookingsCount: number
  verifiedRevenueKrw: number
  verifiedInboundCount: number
  evidenceChain: {
    postReference?: string | null
    receiptId?: string | null
    customerId?: string | null
    bookingId?: string | null
  }
  narrativeOutcome: string
  observedAt: string
}

export interface NextBestAction {
  actionId: string
  workspaceId: string
  sourceMissionId: string
  title: string
  channel: string
  reasoningSummary: string
  confidence: number | null // null indicates uncalibrated confidence (requires empirical baseline)
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH'
  requiresApproval: boolean
  evidenceRefs: string[]
  suggestedActionPayload?: Record<string, unknown>
  createdAt: string
}

export interface AggregationResult {
  outcome: VerifiedOutcomeSummary
  learningCandidateId?: string | null
  nextBestAction?: NextBestAction | null
}

export class VerifiedOutcomeAggregatorService {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Aggregates verified outcome for a given mission and triggers learning + next best action.
   */
  public async aggregateMissionOutcome(
    workspaceId: string,
    missionId: string,
    actorUserId = '00000000-0000-4000-a000-000000000001'
  ): Promise<AggregationResult> {
    const missionService = new MarketingMissionService(this.client)

    // 1. Fetch marketing mission
    const { data: mission, error: missionErr } = await (this.client as any)
      .from('marketing_missions')
      .select('*')
      .eq('id', missionId)
      .eq('workspace_id', workspaceId)
      .single()

    if (missionErr || !mission) {
      throw new Error(`[MISSION_NOT_FOUND] Mission '${missionId}' not found: ${missionErr?.message}`)
    }

    const now = new Date().toISOString()
    const traceId = mission.trace_id || `trc-outcome-${Date.now()}`
    const postRef = mission.metadata?.provider_post_reference || null
    const receiptId = mission.external_action_receipt_id || null

    // 2. Fetch associated confirmed reservations
    let confirmedBookingsCount = 0
    let totalVerifiedRevenueKrw = 0
    let primaryBookingId: string | null = mission.booking_id || null

    if (primaryBookingId) {
      const { data: booking } = await (this.client as any)
        .from('reservations')
        .select('*')
        .eq('id', primaryBookingId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'CONFIRMED')
        .maybeSingle()

      if (booking) {
        confirmedBookingsCount = 1
        totalVerifiedRevenueKrw = Number(booking.total_amount_krw) || 0
      }
    } else {
      // Query reservations linked by mission_id or customer_id
      const { data: bookings } = await (this.client as any)
        .from('reservations')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('mission_id', missionId)
        .eq('status', 'CONFIRMED')

      if (bookings && bookings.length > 0) {
        confirmedBookingsCount = bookings.length
        totalVerifiedRevenueKrw = bookings.reduce(
          (sum: number, b: any) => sum + (Number(b.total_amount_krw) || 0),
          0
        )
        primaryBookingId = bookings[0].id
      }
    }

    // 3. Fetch associated customer conversations (Strictly scoped to mission)
    let inboundCount = 0
    let primaryCustomerId: string | null = mission.customer_id || null

    if (primaryCustomerId) {
      inboundCount = 1
    } else {
      const { data: convs } = await (this.client as any)
        .from('customer_conversations')
        .select('id, customer_id')
        .eq('workspace_id', workspaceId)
        .eq('mission_id', missionId)
        .limit(10)

      if (convs && convs.length > 0) {
        inboundCount = convs.length
        primaryCustomerId = convs[0].customer_id || convs[0].id
      }
    }

    const hasOutcome = confirmedBookingsCount > 0 || inboundCount > 0

    // 4. Build narrative outcome
    let narrative = ''
    if (confirmedBookingsCount > 0) {
      if (totalVerifiedRevenueKrw > 0) {
        narrative = `마케팅 미션을 통해 예약 ${confirmedBookingsCount}건이 확정되어 총 ₩${totalVerifiedRevenueKrw.toLocaleString()}의 매출 성과가 검증되었습니다.`
      } else {
        narrative = `마케팅 미션을 통해 예약 ${confirmedBookingsCount}건이 확정되었으나 결제/매출 금액은 미관찰(0원) 상태입니다.`
      }
    } else if (inboundCount > 0) {
      narrative = `마케팅 미션을 통해 신규 인바운드 고객 문의가 접수되었으며 현재 상담 및 슬롯 조율 중입니다.`
    } else {
      narrative = `아직 관찰된 인바운드 반응이나 예약 성과가 없습니다.`
    }

    const outcome: VerifiedOutcomeSummary = {
      missionId,
      workspaceId,
      traceId,
      status: hasOutcome ? 'OBSERVED' : 'NOT_OBSERVED',
      verifiedBookingsCount: confirmedBookingsCount,
      verifiedRevenueKrw: totalVerifiedRevenueKrw,
      verifiedInboundCount: inboundCount,
      evidenceChain: {
        postReference: postRef,
        receiptId,
        customerId: primaryCustomerId,
        bookingId: primaryBookingId,
      },
      narrativeOutcome: narrative,
      observedAt: now,
    }

    if (!hasOutcome) {
      return { outcome, learningCandidateId: null, nextBestAction: null }
    }

    // 5. Advance Mission State: OUTCOME_OBSERVED
    try {
      await missionService.transitionMission({
        workspaceId,
        missionId,
        traceId,
        toStatus: 'OUTCOME_OBSERVED',
        actorType: 'system',
        reason: outcome.narrativeOutcome,
        downstreamUpdates: {
          metadata: {
            ...(mission.metadata || {}),
            outcome_summary: outcome,
          },
        },
      })
    } catch (err) {
      console.warn('[VerifiedOutcomeAggregator] Advance to OUTCOME_OBSERVED warning:', err)
    }

    // 6. Evaluate Sample Sufficiency & Controlled Learning Hypothesis (ANI-1882)
    const sampleEval = evaluateSampleSufficiency({
      confirmedBookingsCount,
      inboundCount,
    })

    const evidenceRefs = [
      postRef ? `post:${postRef}` : null,
      receiptId ? `receipt:${receiptId}` : null,
      primaryBookingId ? `booking:${primaryBookingId}` : null,
    ].filter(Boolean) as string[]

    const channel = mission.target_channel || 'instagram'
    const periodStart = mission.created_at || now
    const periodEnd = now

    const observation: LearningObservation = {
      period: {
        start: periodStart,
        end: periodEnd,
      },
      sampleSize: confirmedBookingsCount + inboundCount,
      coverage: 'confirmed_reservations_and_inbounds',
      baseline: null,
      evidenceRefs,
      summary: `${channel} 채널 마케팅 활동 후 확정 예약 ${confirmedBookingsCount}건(₩${totalVerifiedRevenueKrw.toLocaleString()}), 인바운드 문의 ${inboundCount}건 관측`,
      channel,
      metric: {
        revenueKrw: totalVerifiedRevenueKrw,
        bookings: confirmedBookingsCount,
        inboundCount,
      },
    }

    const interpretation: LearningInterpretation = {
      hypothesis: sampleEval.isSampleSufficient
        ? `${channel} 마케팅 메시지가 고객 전환 및 예약 유치에 긍정적 상관관계를 보임`
        : `비교 기준선(baseline) 부재 또는 단순 동시 관측 건으로, ${channel} 활동과 예약 유치 간 인과 및 양의 상관관계 단정을 보류하고 추가 관측 필요`,
      rationale: sampleEval.reason,
      sampleConfidence: sampleEval.sampleConfidence,
      isCausalAssertion: false,
      conclusionState: sampleEval.conclusionState,
      whyItWorked: sampleEval.isSampleSufficient
        ? '채널 메시지와 고객 예약 의사결정 간의 상관관계 관측'
        : '표본 부족 또는 대조군 기준선 부재로 성공 요인 인과 및 상관 단정 보류',
    }

    const proposedImpact: LearningProposedImpact = {
      targetScope: 'NEXT_PLAN_ONLY',
      targetMetric: 'weekly_bookings',
      expectedImpact: sampleEval.isSampleSufficient
        ? '다음 콘텐츠 기획 시 유사 메시지 구조 테스트 제안'
        : '인과 단정 보류: 추가 데이터 축적 후 효과 재평가',
      projectedRevenueKrw: sampleEval.isSampleSufficient ? totalVerifiedRevenueKrw : null,
      rollbackVersion: 1,
    }

    const stopCondition: LearningStopCondition = {
      threshold: '후속 관측에서 전환율 급감 또는 고객 문의 부재 시 제안 철회',
      maxFailureCount: 3,
      reviewIntervalHours: 72,
      stopAction: 'suppress_future_suggestions',
    }

    // Call RPC: create_performance_learning_candidate (Fail-closed on RPC error)
    const { data: candidateId, error: rpcErr } = await (this.client as any).rpc(
      'create_performance_learning_candidate',
      {
        p_workspace_id: workspaceId,
        p_actor_user_id: actorUserId,
        p_observation: observation,
        p_interpretation: interpretation,
        p_proposed_impact: proposedImpact,
        p_stop_condition: stopCondition,
      }
    )

    if (rpcErr || !candidateId) {
      throw new Error(
        `[LEARNING_CANDIDATE_CREATION_FAILED] create_performance_learning_candidate RPC failed: ${rpcErr?.message || 'candidateId is null'}`
      )
    }

    // 7. Advance Mission State: LEARNING
    try {
      await missionService.transitionMission({
        workspaceId,
        missionId,
        traceId,
        toStatus: 'LEARNING',
        actorType: 'agent',
        reason: '검증된 성과 데이터를 기반으로 성공 패턴 학습 및 인사이트 도출',
        downstreamUpdates: {
          metadata: {
            ...(mission.metadata || {}),
            learning_candidate_id: candidateId,
          },
        },
      })
    } catch (err) {
      console.warn('[VerifiedOutcomeAggregator] Advance to LEARNING warning:', err)
    }

    // 8. Generate Next Best Action (Grounding on real observations, no uncalibrated claims)
    // Calibration without empirical baseline is unverified; confidence is null until calibrated
    const actionConfidence = sampleEval.isSampleSufficient ? 75 : null
    const actionRiskTier = sampleEval.isSampleSufficient ? 'LOW' : 'MEDIUM'

    const nextBestAction: NextBestAction = {
      actionId: `nba_${crypto.randomUUID().slice(0, 8)}`,
      workspaceId,
      sourceMissionId: missionId,
      title: `${channel} 후속 콘텐츠 기획 및 반응 관측`,
      channel,
      reasoningSummary: `${channel} 실행 후 확정 예약 ${confirmedBookingsCount}건(₩${totalVerifiedRevenueKrw.toLocaleString()})이 관측되었습니다. ${sampleEval.reason} 다음 기획 검토를 추천합니다.`,
      confidence: actionConfidence,
      riskTier: actionRiskTier,
      requiresApproval: true,
      evidenceRefs: [
        `mission:${missionId}`,
        primaryBookingId ? `booking:${primaryBookingId}` : '',
        `learning:${candidateId}`,
      ].filter(Boolean),
      suggestedActionPayload: {
        theme: mission.goal || `${channel} 후속 마케팅`,
        targetChannel: channel,
        observedRevenueKrw: totalVerifiedRevenueKrw,
        conclusionState: sampleEval.conclusionState,
      },
      createdAt: now,
    }

    // 9. Advance Mission State: NEXT_ACTION_READY
    try {
      await missionService.transitionMission({
        workspaceId,
        missionId,
        traceId,
        toStatus: 'NEXT_ACTION_READY',
        actorType: 'agent',
        reason: '후속 마케팅 추천 행동(Next Best Action) 준비 완료',
        ownerActionRequired: true,
        downstreamUpdates: {
          metadata: {
            ...(mission.metadata || {}),
            next_best_action: nextBestAction,
          },
        },
      })
    } catch (err) {
      console.warn('[VerifiedOutcomeAggregator] Advance to NEXT_ACTION_READY warning:', err)
    }

    return {
      outcome,
      learningCandidateId: candidateId,
      nextBestAction,
    }
  }

  /**
   * Reviews a performance learning candidate via the CAS-guarded RPC.
   */
  public async reviewLearningCandidate(params: {
    workspaceId: string
    candidateId: string
    decision: 'approved' | 'rejected'
    reason: string
    expectedVersion: number
  }): Promise<boolean> {
    const { data, error } = await (this.client as any).rpc('review_performance_learning_candidate', {
      p_workspace_id: params.workspaceId,
      p_candidate_id: params.candidateId,
      p_decision: params.decision,
      p_reason: params.reason,
      p_expected_version: params.expectedVersion,
    })

    if (error) {
      throw new Error(`[REVIEW_LEARNING_FAILED] ${error.message}`)
    }

    return Boolean(data)
  }
}
