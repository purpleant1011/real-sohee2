import type { SupabaseClient } from '@supabase/supabase-js'
import { readWorkspaceDataset, type ReportingDatasetMode } from './dataset'
import { MAX_REPORTING_RANGE_DAYS, currentReportingEnd, formatObservation, type ReportingObservation, type ReportingPeriod } from './observation'
import { filterSuppressedOrRejectedHypotheses } from '../mission-learning/learning-contract'
import { parseConfirmedPublishAttempt } from '@/features/publishing/publication-proof'

export interface WeeklyLearningHypothesisProjection {
  id: string
  hypothesis: string
  status: string
  sampleConfidence?: string
  conclusionState?: string
  evidenceRefs: string[]
  createdAt: string
}

export interface WeeklyProposedNextAction {
  id: string
  title: string
  channel?: string | null
  requiresApproval: boolean
  sourceMissionId?: string | null
}

export interface WeeklyCeoReportData {
  workspaceId: string
  datasetMode: ReportingDatasetMode
  periodLabel: string
  period: ReportingPeriod
  hoursSaved: number | null
  costSavedWon: number | null
  confirmedBookingsCount: number | null
  totalRevenueWon: number | null
  publishedPostsCount: number | null
  /** Stored comments, not unique customers, inquiries, or delivered replies. */
  engagementCount: number | null
  metrics: Record<'bookingConfirmed' | 'bookingCanceled' | 'verifiedPublishedPosts' | 'publicationPending' |
    'storedComments' | 'paymentCapturedVerified' | 'revenue' | 'visitCompletedVerified' |
    'hoursSaved' | 'costSavedWon', ReportingObservation>
  executiveSummary: string
  generatedAt: string
  learningHypothesesState?: 'OBSERVED' | 'ERROR' | 'NOT_OBSERVED'
  learningHypotheses?: WeeklyLearningHypothesisProjection[] | null
  proposedNextActions?: WeeklyProposedNextAction[]
}

type Row = Record<string, unknown>
type ReadResult = { state: 'OBSERVED'; rows: Row[] } | { state: 'ERROR' | 'NOT_OBSERVED' | 'CONNECTION_REQUIRED'; rows: null }
const PAGE_SIZE = 500
const DAY_MS = 24 * 60 * 60 * 1000

export class WeeklyCeoReportService {
  // registry는 운영 metadata다. 업무 행은 사용자 RLS client로 읽고 이 예외를 확대하지 않는다.
  constructor(private readonly client?: SupabaseClient, private readonly registryClient = client) {}

  private async readRows(workspaceId: string, table: string, columns: string, timeColumn: string | null, period: ReportingPeriod): Promise<ReadResult> {
    if (!this.client) return { state: 'NOT_OBSERVED', rows: null }
    const rows: Row[] = []
    try {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        let query = this.client.from(table).select(`workspace_id,${columns}`).eq('workspace_id', workspaceId)
          .order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1)
        if (timeColumn) query = query.gte(timeColumn, period.start).lt(timeColumn, period.end)
        const { data, error } = await query
        const output: unknown = data
        if (error || !Array.isArray(output) || output.some(row => !row || typeof row !== 'object' || Array.isArray(row) || row.workspace_id !== workspaceId)) return { state: 'ERROR', rows: null }
        rows.push(...output as Row[])
        if (output.length < PAGE_SIZE) return { state: 'OBSERVED', rows }
      }
    } catch {
      return { state: 'ERROR', rows: null }
    }
  }

  async generateReport(workspaceId: string, baseDate: Date = currentReportingEnd()): Promise<WeeklyCeoReportData> {
    if (!workspaceId.trim() || !Number.isFinite(baseDate.getTime())) throw new Error('유효한 사업장과 조회 기간이 필요합니다.')
    const period: ReportingPeriod = {
      start: new Date(baseDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      end: baseDate.toISOString(),
    }
    return this.buildReport(workspaceId, period)
  }

  /**
   * 직접 선택 구간(ANI-1782). 구간은 [start, end) 반개구간이며 넘긴 값을 그대로 조회한다.
   * 라우트가 이미 검증하지만, 라우트 밖 호출자를 위해 같은 규칙을 한 번 더 확인한다.
   */
  async generateRangeReport(workspaceId: string, period: ReportingPeriod): Promise<WeeklyCeoReportData> {
    const startMs = new Date(period.start).getTime()
    const endMs = new Date(period.end).getTime()
    if (!workspaceId.trim() || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs ||
        (endMs - startMs) / DAY_MS > MAX_REPORTING_RANGE_DAYS || endMs > currentReportingEnd().getTime()) {
      throw new Error('유효한 사업장과 조회 기간이 필요합니다.')
    }
    return this.buildReport(workspaceId, { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() })
  }

  /** 주간 보고 본문(읽기·집계·요약). 기본 경로와 직접 선택 경로가 같은 계산을 공유한다. */
  private async buildReport(workspaceId: string, period: ReportingPeriod): Promise<WeeklyCeoReportData> {
    const generatedAt = new Date().toISOString()
    const dataset = await readWorkspaceDataset(this.registryClient, workspaceId)
    const read = (table: string, columns: string, timeColumn: string | null): Promise<ReadResult> => {
      if (dataset.mode !== 'ACTUAL') return Promise.resolve({ state: dataset.state === 'ERROR' ? 'ERROR' : 'NOT_OBSERVED', rows: null })
      return this.readRows(workspaceId, table, columns, timeColumn, period)
    }
    const [reservations, receipts, attemptsResult, comments, connections, learnings, missions] = await Promise.all([
      read('reservations', 'id, status', 'created_at'),
      read('external_action_receipts', 'id, receipt_kind, provider_reference, observed_payload', 'recorded_at'),
      read('publish_attempts', 'id, schedule_id, status, error_code, provider_request_id, provider_reference, finished_at', 'finished_at'),
      read('social_comments', 'id', 'created_at'),
      read('channel_connections', 'id, channel, status', null),
      // 전체 candidate 상태 조회(timeColumn: null)하여 보고 기간 밖의 거절/승인 가설도 tenant 전체에서 확인
      read('performance_learning_candidates', 'id, observation, interpretation, proposed_impact, status, created_at', null),
      read('marketing_missions', 'id, status, target_channel, metadata', 'updated_at'),
    ])
    const observation = (result: ReadResult, source: string, ids: string[]): ReportingObservation => ({
      value: result.state === 'OBSERVED' ? ids.length : null,
      state: result.state, source, period,
      observedAt: result.state === 'OBSERVED' ? generatedAt : null,
      evidenceIds: ids,
    })
    const idsForStatus = (status: string) => [...new Set((reservations.rows ?? [])
      .filter((row) => row.status === status && typeof row.id === 'string').map((row) => row.id as string))]
    const verifiedPostIds = new Map<string, string>()
    const receiptEvidenceIds = new Set<string>()
    const attemptEvidenceIds = new Set<string>()
    for (const row of receipts.rows ?? []) {
      const payload = row.observed_payload as Record<string, unknown> | null
      if (row.receipt_kind !== 'observed_result' || payload?.verified !== true || payload.read_after_write !== true ||
          typeof row.id !== 'string' || typeof row.provider_reference !== 'string' || !row.provider_reference ||
          payload.published_post_id !== row.provider_reference || typeof payload.channel !== 'string' || !payload.channel) continue
      const key = JSON.stringify([payload.channel.toLowerCase(), row.provider_reference])
      if (!verifiedPostIds.has(key)) {
        verifiedPostIds.set(key, row.id)
        receiptEvidenceIds.add(row.id)
      }
    }

    let publishAttemptsError = false
    if (this.client && attemptsResult.state === 'OBSERVED' && Array.isArray(attemptsResult.rows)) {
      const succeededAttempts = attemptsResult.rows.filter(row => row.status === 'succeeded' && typeof row.schedule_id === 'string' && typeof row.id === 'string')
      if (succeededAttempts.length > 0 && connections.state !== 'OBSERVED') {
        publishAttemptsError = true
      } else if (succeededAttempts.length > 0) {
        const scheduleIds = [...new Set(succeededAttempts.map(a => a.schedule_id as string))]
        const attemptIds = succeededAttempts.map(a => a.id as string)

        try {
          const [schedulesRes, trackingRes] = await Promise.all([
            this.client.from('schedules').select('id, workspace_id, channel_connection_id').eq('workspace_id', workspaceId).in('id', scheduleIds),
            this.client.from('social_post_tracking').select('id, workspace_id, publish_attempt_id, destination_url').eq('workspace_id', workspaceId).in('publish_attempt_id', attemptIds),
          ])

          if (schedulesRes.error || !Array.isArray(schedulesRes.data) || trackingRes.error || !Array.isArray(trackingRes.data) ||
              schedulesRes.data.some(s => !s || typeof s !== 'object' || s.workspace_id !== workspaceId) ||
              trackingRes.data.some(t => !t || typeof t !== 'object' || t.workspace_id !== workspaceId)) {
            publishAttemptsError = true
          } else {
            const schedulesMap = new Map((schedulesRes.data as Row[]).map(s => [s.id as string, s]))
            const trackingMap = new Map((trackingRes.data as Row[]).map(t => [t.publish_attempt_id as string, t]))
            const connectionsMap = new Map((connections.rows ?? []).filter(c => c && c.workspace_id === workspaceId).map(c => [c.id as string, c.channel as string]))

            for (const attempt of succeededAttempts) {
              const schedule = schedulesMap.get(attempt.schedule_id as string)
              if (!schedule) {
                // 필수 schedule 행이 누락되면 집계 완전성 불명으로 처리
                publishAttemptsError = true
                break
              }
              const channel = connectionsMap.get(schedule.channel_connection_id as string)
              if (!channel) {
                // 필수 channel_connection FK 행이 누락되면 집계 완전성 불명으로 처리
                publishAttemptsError = true
                break
              }
              const tracking = trackingMap.get(attempt.id as string)
              const proof = parseConfirmedPublishAttempt({
                attempt,
                tracking,
                workspaceId,
                scheduleId: schedule.id as string,
                channel,
              })
              if (proof) {
                const key = JSON.stringify([proof.channel.toLowerCase(), proof.providerReference])
                if (!verifiedPostIds.has(key)) {
                  verifiedPostIds.set(key, proof.evidenceId)
                  attemptEvidenceIds.add(proof.evidenceId)
                }
              }
            }
          }
        } catch {
          publishAttemptsError = true
        }
      }
    }

    const pendingPosts = new Map<string, string>()
    for (const row of receipts.rows ?? []) {
      const payload = row.observed_payload as Record<string, unknown> | null
      if (typeof row.id !== 'string' || typeof row.provider_reference !== 'string' || !row.provider_reference ||
          payload?.published_post_id !== row.provider_reference || typeof payload.channel !== 'string' || !payload.channel) continue
      const key = JSON.stringify([payload.channel.toLowerCase(), row.provider_reference])
      if (!verifiedPostIds.has(key) && !pendingPosts.has(key)) pendingPosts.set(key, row.id)
    }
    const unobserved = (source: string): ReportingObservation => ({
      value: null, state: 'NOT_OBSERVED', source, period, observedAt: null, evidenceIds: [],
    })
    const socialAvailability = (result: ReadResult, ids: string[]): ReadResult => {
      if (result.state !== 'OBSERVED' || ids.length > 0) return result
      if (connections.state !== 'OBSERVED') return connections
      const connected = connections.rows.some((row) =>
        ['instagram', 'threads'].includes(String(row.channel).toLowerCase()) && String(row.status).toLowerCase() === 'connected')
      return connected ? result : { state: 'CONNECTION_REQUIRED', rows: null }
    }
    const postIds = [...verifiedPostIds.values()]
    const pendingIds = [...pendingPosts.values()]
    const commentIds = [...new Set((comments.rows ?? []).filter((row) => typeof row.id === 'string').map((row) => row.id as string))]
    const publishReadResult: ReadResult = receipts.state === 'ERROR' || attemptsResult.state === 'ERROR' || publishAttemptsError
      ? { state: 'ERROR', rows: null }
      : receipts
    const hasReceiptEvidence = postIds.some(id => receiptEvidenceIds.has(id))
    const hasAttemptEvidence = postIds.some(id => attemptEvidenceIds.has(id))
    const verifiedPublishSource = hasReceiptEvidence && hasAttemptEvidence
      ? 'external_action_receipts.recorded_at+publish_attempts.finished_at/independent_publish_readback'
      : hasAttemptEvidence
        ? 'publish_attempts.finished_at/permalink_readback'
        : 'external_action_receipts.recorded_at/independent_publish_readback'
    const metrics: WeeklyCeoReportData['metrics'] = {
      bookingConfirmed: observation(reservations, 'reservations.created_at/current_status', idsForStatus('CONFIRMED')),
      bookingCanceled: observation(reservations, 'reservations.created_at/current_status', idsForStatus('CANCELLED')),
      verifiedPublishedPosts: observation(socialAvailability(publishReadResult, postIds), verifiedPublishSource, postIds),
      publicationPending: observation(socialAvailability(publishReadResult, pendingIds), 'external_action_receipts.recorded_at/unverified_publish_result', pendingIds),
      storedComments: observation(socialAvailability(comments, commentIds), 'social_comments.created_at', commentIds),
      paymentCapturedVerified: unobserved('verified_payment_ledger_not_connected'),
      revenue: unobserved('verified_revenue_ledger_not_connected'),
      visitCompletedVerified: unobserved('verified_visit_ledger_not_connected'),
      hoursSaved: unobserved('measured_work_duration_not_connected'),
      costSavedWon: unobserved('measured_cost_comparison_not_connected'),
    }
    const periodLabel = `${period.start.slice(0, 10)} ~ ${period.end.slice(0, 10)} (UTC)`
    const executiveSummary = `이 기간에 생성된 예약 기록 중 현재 확정 ${formatObservation(metrics.bookingConfirmed)}, 취소 ${formatObservation(metrics.bookingCanceled)}입니다.\n` +
      `같은 기간에 게시 확인 근거가 저장된 게시물은 ${formatObservation(metrics.verifiedPublishedPosts)}, 게시 확인 대기 ${formatObservation(metrics.publicationPending)}, 저장된 댓글은 ${formatObservation(metrics.storedComments)}입니다.\n` +
      '수납·매출·방문 완료와 절감 시간·비용은 확인 근거가 연결되지 않아 계산하지 않았어요.'

    const candidateStatusMap = new Map<string, string>()
    for (const row of learnings.rows ?? []) {
      if (typeof row.id === 'string' && typeof row.status === 'string') {
        candidateStatusMap.set(row.id, row.status)
      }
    }

    const learningHypothesesState: 'OBSERVED' | 'ERROR' | 'NOT_OBSERVED' =
      learnings.state === 'ERROR'
        ? 'ERROR'
        : learnings.state === 'OBSERVED'
          ? 'OBSERVED'
          : 'NOT_OBSERVED'

    let learningHypotheses: WeeklyLearningHypothesisProjection[] | null = null
    if (learnings.state === 'OBSERVED') {
      const startMs = new Date(period.start).getTime()
      const endMs = new Date(period.end).getTime()
      // 주간 가설 목록은 해당 보고 기간(created_at 기준) 내의 후보만 필터링
      const periodLearnings = (learnings.rows ?? []).filter((row) => {
        if (typeof row.created_at !== 'string') return false
        const t = new Date(row.created_at).getTime()
        return t >= startMs && t < endMs
      })

      const activeLearnings = filterSuppressedOrRejectedHypotheses(
        periodLearnings.filter(
          (row): row is Row & { id: string; status: string } =>
            typeof row.id === 'string' && typeof row.status === 'string'
        )
      )
      learningHypotheses = activeLearnings
        .filter((row) => row.interpretation && typeof row.interpretation === 'object')
        .map((row) => {
          const interp = row.interpretation as Record<string, unknown>
          const obs = (row.observation as Record<string, unknown>) || {}
          return {
            id: row.id,
            hypothesis: typeof interp.hypothesis === 'string' ? interp.hypothesis : '관측된 성과 가설',
            status: row.status,
            sampleConfidence: typeof interp.sampleConfidence === 'string' ? interp.sampleConfidence : undefined,
            conclusionState: typeof interp.conclusionState === 'string' ? interp.conclusionState : undefined,
            evidenceRefs: Array.isArray(obs.evidenceRefs) ? (obs.evidenceRefs as string[]) : [],
            createdAt: typeof row.created_at === 'string' ? row.created_at : generatedAt,
          }
        })
    }

    const proposedNextActions: WeeklyProposedNextAction[] = []
    for (const row of missions.rows ?? []) {
      const meta = row.metadata as Record<string, unknown> | null
      const learningCandidateId = meta?.learning_candidate_id as string | undefined

      if (learningCandidateId) {
        // learning 조회가 ERROR/미관측이면 가설 상태를 검증할 수 없으므로 fail-closed 차단
        if (learnings.state !== 'OBSERVED') {
          continue
        }
        // learning 조회 성공으로 확인된 candidate ID만 제안 투영하고, 거절/대체 가설은 보고 기간 밖이라도 차단
        const candidateStatus = candidateStatusMap.get(learningCandidateId)
        if (!candidateStatus || candidateStatus === 'rejected' || candidateStatus === 'superseded') {
          continue
        }
      }

      // 기존 가설과 무관한 제안은 정상 투영 유지
      const nba = meta?.next_best_action as Record<string, unknown> | null
      if (nba && typeof nba.title === 'string') {
        proposedNextActions.push({
          id: typeof nba.actionId === 'string' ? nba.actionId : `nba_${row.id}`,
          title: nba.title,
          channel: typeof nba.channel === 'string' ? nba.channel : (row.target_channel as string | null),
          requiresApproval: nba.requiresApproval !== false,
          sourceMissionId: typeof row.id === 'string' ? row.id : null,
        })
      }
    }

    return {
      workspaceId, datasetMode: dataset.mode, periodLabel, period, metrics, executiveSummary, generatedAt,
      confirmedBookingsCount: metrics.bookingConfirmed.value,
      totalRevenueWon: metrics.revenue.value,
      publishedPostsCount: metrics.verifiedPublishedPosts.value,
      engagementCount: metrics.storedComments.value,
      hoursSaved: metrics.hoursSaved.value,
      costSavedWon: metrics.costSavedWon.value,
      learningHypothesesState,
      learningHypotheses,
      proposedNextActions,
    }
  }
}
