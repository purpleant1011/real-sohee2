import type { SupabaseClient } from '@supabase/supabase-js'
import { failed, ready, unknown, type MobileActivity, type MobileApprovalView, type MobileDecision, type MobileMetric } from '../contracts'
import { WeeklyCeoReportService } from '@/features/reporting/weekly-ceo-report-service'
import { currentReportingEnd, observationTruth } from '@/features/reporting/observation'
import { toKoreanStatus } from '@/lib/status-labels'
import { describeAutonomy } from '@/features/mobile-today/autonomy-state'
import { readRuntimeControl } from '@/features/marketing-agent/engine/runtime-control-read'
import { resolvePublicationEvidence } from './publication-evidence'
import { approvalKey } from '../selectors'
import type { MobileReadDeps, MobileReadContext } from './read-model'

type Row = Record<string, unknown>
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const date = (value: unknown): string | null => {
  const valueText = text(value)
  return valueText && Number.isFinite(Date.parse(valueText)) ? valueText : null
}
const LIMIT = 50
/** 홈 "최근 작업"은 최근 것만 보여주는 표본이다. 전체 개수를 주장하지 않는다. */
const ACTIVITY_LIMIT = 5
/** 홈의 "업무 제어 확인"이 향하는 화면. 홈 뷰의 링크와 같은 경로를 DTO가 내려준다. */
const AGENT_DETAIL_HREF = '/app/sohee?tab=work&section=autonomy'
/** 쿼리의 workspace 조건만 믿지 않는다. 오염 행을 조용히 버리지 않고 조회 전체를 닫는다. */
const scopedRow = (value: unknown, workspaceId: string): value is Row =>
  !!value && typeof value === 'object' && !Array.isArray(value) && (value as Row).workspace_id === workspaceId
const rowArray = (result: { data: unknown; error: unknown }, workspaceId: string): Row[] | null => {
  const output: unknown = result.data
  if (result.error || !Array.isArray(output) || output.some(row => !scopedRow(row, workspaceId))) return null
  return output as Row[]
}

// 업무 행은 사용자 RLS, service-only registry는 인가 뒤 metadata 조회에만 사용한다. 쓰기는 없다.
export function createMobileReadDeps(db: SupabaseClient, now = () => new Date().toISOString(), registryClient = db): MobileReadDeps {
  async function rows(table: string, ctx: MobileReadContext, columns: string, filter?: { field: string; values: string[] }, sort = 'created_at'): Promise<Row[]> {
    let query = db.from(table).select(`workspace_id,${columns}`).eq('workspace_id', ctx.workspaceId)
    if (filter) query = query.in(filter.field, filter.values)
    if (table === 'instagram_dm_threads') query = query.gt('expires_at', now())
    const output = rowArray(await query.order(sort, { ascending: true }).order('id', { ascending: true }).limit(LIMIT + 1), ctx.workspaceId)
    if (!output) throw new Error('조회 실패')
    return output
  }
  async function one(table: string, ctx: MobileReadContext, id: string, columns: string): Promise<Row | null> {
    const { data, error } = await db.from(table).select(columns).eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
    if (error || (data && (!scopedRow(data, ctx.workspaceId) || data.id !== id))) throw new Error('조회 실패')
    return data as Row | null
  }
  return {
    now,
    async readIdentity(ctx) {
      const { data, error } = await db.from('business_profiles').select('workspace_id,business_name').eq('workspace_id', ctx.workspaceId).limit(1).maybeSingle()
      if (error || (data && !scopedRow(data, ctx.workspaceId))) throw new Error('조회 실패')
      const { data: workspace, error: workspaceError } = await db.from('workspaces').select('id,timezone').eq('id', ctx.workspaceId).maybeSingle()
      if (workspace && workspace.id !== ctx.workspaceId) throw new Error('조회 실패')
      let timeZone = workspaceError ? null : text(workspace?.timezone)
      if (timeZone) {
        try { new Intl.DateTimeFormat('ko-KR', { timeZone }).format() } catch { timeZone = null }
      }
      return { businessName: text(data?.business_name), timeZone }
    },
    async readAgent(ctx) {
      try {
        const state = await readRuntimeControl(db, ctx.workspaceId)
        const view = describeAutonomy({
          desiredMode: state.desiredMode, actualMode: state.actualMode,
          activeActionRunCount: state.activeActionRunCount, killSwitchActive: state.killSwitchActive,
          version: state.version, observedAt: state.checkedAt,
        })
        return ready({ label: view.label, detailHref: AGENT_DETAIL_HREF }, state.checkedAt)
      } catch (error) {
        return error instanceof Error && ['CONTROL_STATE_MISSING', 'CONTROL_STATE_UNAVAILABLE'].includes(error.message) ? unknown() : failed()
      }
    },
    async readActivity(ctx) {
      // 정본 작업 원장(content_items)과 게시 시도 원장(schedules)을 함께 읽는다.
      // 게시 실패는 schedules.status 에만 기록되고 content_items.status 는 'scheduled' 로 남기 때문에,
      // 일정을 읽지 않으면 실패한 작업이 "게시 준비"로 보인다(데스크톱 needsRecovery 와 같은 규칙).
      const [contentResult, failureResult] = await Promise.all([
        db.from('content_items')
          .select('id,workspace_id,channel,title,status,updated_at,current_version_id')
          .eq('workspace_id', ctx.workspaceId)
          .neq('status', 'archived')
          .order('updated_at', { ascending: false })
          .limit(ACTIVITY_LIMIT + 1),
        db.from('schedules')
          .select('id,workspace_id,content_id,status,updated_at')
          .eq('workspace_id', ctx.workspaceId)
          .eq('status', 'failed')
          .order('updated_at', { ascending: false })
          .limit(LIMIT),
      ])
      const contentRows = rowArray(contentResult, ctx.workspaceId)
      const failureRows = rowArray(failureResult, ctx.workspaceId)
      // 어느 한쪽 조회가 실패하면 "기록 없음"도 "정상 준비"도 주장할 수 없다.
      if (!contentRows || !failureRows) return { state: 'error', data: null, observedAt: null, validUntil: null }
      const failures = new Map<string, { scheduleId: string; observedAt: string }>()
      for (const row of failureRows) {
        const contentId = text(row.content_id)
        const scheduleId = text(row.id)
        const failedAt = date(row.updated_at)
        if (!contentId || !scheduleId || !failedAt) continue
        const previous = failures.get(contentId)
        if (!previous || Date.parse(failedAt) > Date.parse(previous.observedAt)) failures.set(contentId, { scheduleId, observedAt: failedAt })
      }
      // 최근 창 밖이라도 게시에 실패한 작업은 "지금 확인할 일"이므로 함께 읽는다.
      const known = new Set(contentRows.map(row => text(row.id)).filter((id): id is string => id !== null))
      const missing = [...failures.keys()].filter(id => !known.has(id)).slice(0, LIMIT)
      let extraRows: Row[] = []
      if (missing.length > 0) {
        const extra = rowArray(await db.from('content_items')
          .select('id,workspace_id,channel,title,status,updated_at,current_version_id')
          .eq('workspace_id', ctx.workspaceId)
          .in('id', missing), ctx.workspaceId)
        if (!extra) return { state: 'error', data: null, observedAt: null, validUntil: null }
        extraRows = extra
      }

      // 게시 완료는 외부 플랫폼의 실제 게시 확인(provider readback) 영수증이 있을 때만 인정한다.
      // 원장 상태가 'published'/'completed'라도 외부 확인 영수증이 없으면 '게시 확인 전'으로 표기한다.
      const candidatePublishedItems = [...contentRows, ...extraRows].map(row => ({
        id: text(row.id) ?? '',
        channel: text(row.channel),
        status: text(row.status),
        currentVersionId: text(row.current_version_id),
      }))

      const verifiedPublications = await resolvePublicationEvidence(db, ctx.workspaceId, candidatePublishedItems)

      const items = [...contentRows, ...extraRows].flatMap<MobileActivity>(row => {
        const id = text(row.id)
        const title = text(row.title)
        const observedAt = date(row.updated_at)
        const rawState = text(row.status) ?? ''
        if (!id || !title || !observedAt || rawState === 'archived') return []
        const failure = rawState === 'scheduled' ? failures.get(id) : undefined
        if (failure) {
          return [{
            id: `content:${id}`,
            title,
            statusLabel: '게시 복구 필요',
            // 실패 시각이 더 최근이면 그 시각으로 정렬한다. 오래된 콘텐츠 수정 시각에 묻히지 않게.
            observedAt: Date.parse(failure.observedAt) > Date.parse(observedAt) ? failure.observedAt : observedAt,
            evidenceRef: JSON.stringify({ source: 'schedules.status', contentId: id, scheduleId: failure.scheduleId, status: 'failed', observedAt: failure.observedAt }),
          }]
        }
        if (rawState === 'published' || rawState === 'completed') {
          const verified = verifiedPublications.get(id)
          if (verified) {
            return [{
              id: `content:${id}`,
              title,
              statusLabel: '게시 완료',
              observedAt: Date.parse(verified.observedAt) > Date.parse(observedAt) ? verified.observedAt : observedAt,
              evidenceRef: JSON.stringify({
                source: verified.source,
                contentId: id,
                evidenceId: verified.receiptId,
                ...(verified.source === 'publish_attempts.permalink_readback'
                  ? { publishAttemptId: verified.receiptId }
                  : { receiptId: verified.receiptId }),
                providerReference: verified.providerReference,
                observedAt: verified.observedAt,
                permalink: verified.permalink ?? null,
              }),
            }]
          }
          return [{
            id: `content:${id}`,
            title,
            statusLabel: '게시 확인 전',
            observedAt,
            evidenceRef: JSON.stringify({
              source: 'content_items.status/unverified_publish',
              contentId: id,
              status: rawState,
              observedAt,
            }),
          }]
        }
        return [{
          id: `content:${id}`,
          title,
          statusLabel: toKoreanStatus(rawState),
          observedAt,
          evidenceRef: JSON.stringify({ source: 'content_items.status', contentId: id, status: rawState, observedAt }),
        }]
      }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id))
      return { state: 'ready', data: items.slice(0, ACTIVITY_LIMIT), observedAt: now(), validUntil: null }
    },
    async readResults(ctx) {
      try {
        const report = await new WeeklyCeoReportService(db, registryClient).generateReport(ctx.workspaceId, currentReportingEnd(new Date(now())))
        if (report.datasetMode !== 'ACTUAL') {
          const hasError = Object.values(report.metrics).some(metric => metric.state === 'ERROR')
          return { state: hasError ? 'error' : 'unknown', data: null, observedAt: null, validUntil: null }
        }
        const definitions = [
          ['published', '게시 확인', report.metrics.verifiedPublishedPosts],
          ['bookings', '현재 확정 예약', report.metrics.bookingConfirmed],
          ['revenue', '확인된 매출', report.metrics.revenue],
        ] as const
        const metrics = definitions.map<MobileMetric>(([id, label, metric]) => {
          // 예약·수납(매출)은 출처까지 확인된 관측만 숫자로 그린다. 관측 시각이 없으면 근거로 쓰지 않는다.
          const truth = observationTruth(metric)
          const confirmed = truth.value !== null && metric.observedAt !== null
          return {
            id,
            label: `${label}${metric.state === 'CONNECTION_REQUIRED' ? ' · 채널 연결 필요' : ''} · ${report.periodLabel}`,
            value: confirmed ? truth.value : null,
            unit: id === 'revenue' ? '원' : '건',
            state: confirmed ? 'ready' : metric.state === 'ERROR' ? 'error' : 'unknown',
            // A zero has query provenance, not a fabricated provider receipt ID.
            evidenceRef: confirmed ? JSON.stringify({ source: truth.source, observedAt: metric.observedAt, evidenceIds: metric.evidenceIds }) : null,
            source: confirmed ? truth.source : null,
            datasetMode: 'ACTUAL',
            period: { ...report.period, timeZone: 'UTC' },
          }
        })
        return { state: 'ready', data: metrics, observedAt: report.generatedAt, validUntil: report.period.end }
      } catch {
        return { state: 'error', data: null, observedAt: null, validUntil: null }
      }
    },
    async readDecisions(ctx) {
      const sources = await Promise.allSettled([
        rows('social_comments', ctx, 'id,channel,author_handle,comment_text,status,created_at', { field: 'status', values: ['DRAFTED', 'RECEIVED'] }),
        rows('marketing_missions', ctx, 'id,status,metadata,created_at', { field: 'status', values: ['AWAITING_APPROVAL', 'draft'] }),
        rows('instagram_dm_threads', ctx, 'id,status,customer_handle,last_message_text,last_message_at,expires_at,created_at', { field: 'status', values: ['NEEDS_REPLY', 'NEEDS_CHECK'] }, 'expires_at'),
      ])
      let complete = true
      let hasError = false
      const items: MobileDecision[] = []
      sources.forEach((source, index) => {
        if (source.status === 'rejected') { hasError = true; complete = false; return }
        if (source.value.length > LIMIT) complete = false
        for (const row of source.value.slice(0, LIMIT)) {
          const id = text(row.id)
          const createdAt = date(row.created_at)
          if (!id || !createdAt) { complete = false; continue }
          if (index === 0) {
            if (!text(row.comment_text)) { complete = false; continue }
            items.push({ id: `comment:${id}`, kind: 'comment_reply', title: '고객 댓글 확인',
              targetLabel: text(row.author_handle) || '고객 댓글', createdAt, expiresAt: null })
          } else if (index === 1) {
            const meta = object(row.metadata)
            if (!text(meta.caption) && !text(meta.text)) { complete = false; continue }
            items.push({ id: `post:${id}`, kind: 'post_publish', title: text(meta.topic) || '게시물 검토',
              targetLabel: '콘텐츠 · 게시 전', createdAt, expiresAt: null })
          } else {
            const expiresAt = date(row.expires_at)
            if (!expiresAt) { complete = false; continue }
            if (Date.parse(expiresAt) <= Date.parse(now())) continue
            items.push({ id: `dm:${id}`, kind: 'dm_reply', title: '고객 메시지 확인',
              targetLabel: text(row.customer_handle) || '고객 메시지', createdAt, expiresAt })
          }
        }
      })
      return { state: hasError ? 'error' : 'ready', data: { items, total: complete ? items.length : null, complete }, observedAt: now(), validUntil: null }
    },
    async readApproval(ctx, key) {
      const parsed = approvalKey(key)
      if (!parsed) return null
      let detail: Pick<MobileApprovalView, 'kind' | 'title' | 'targetLabel' | 'sourceText' | 'fullContent'>
      if (parsed.kind === 'dm') {
        const thread = await one('instagram_dm_threads', ctx, parsed.id, 'id,workspace_id,customer_handle,last_message_text,status,expires_at')
        if (!thread) return null
        const { data: draft, error } = await db.from('instagram_dm_drafts').select('workspace_id,draft_text').eq('workspace_id', ctx.workspaceId).eq('thread_id', parsed.id).maybeSingle()
        if (error || (draft && !scopedRow(draft, ctx.workspaceId))) throw new Error('조회 실패')
        detail = { kind: 'dm_reply', title: '고객 답장 검토', targetLabel: text(thread.customer_handle),
          sourceText: text(thread.last_message_text), fullContent: text(draft?.draft_text) }
      } else if (parsed.kind === 'comment') {
        const comment = await one('social_comments', ctx, parsed.id, 'id,workspace_id,author_handle,comment_text')
        if (!comment) return null
        const { data: draft, error } = await db.from('comment_reply_drafts').select('workspace_id,draft_text').eq('workspace_id', ctx.workspaceId).eq('comment_id', parsed.id).maybeSingle()
        if (error || (draft && !scopedRow(draft, ctx.workspaceId))) throw new Error('조회 실패')
        detail = { kind: 'comment_reply', title: '고객 댓글 답글 검토', targetLabel: text(comment.author_handle),
          sourceText: text(comment.comment_text), fullContent: text(draft?.draft_text) }
      } else {
        const post = await one('marketing_missions', ctx, parsed.id, 'id,workspace_id,status,metadata')
        if (!post) return null
        const meta = object(post.metadata)
        detail = { kind: 'post_publish', title: text(meta.topic) || '게시물 검토', targetLabel: null,
          sourceText: text(meta.topic), fullContent: text(meta.caption) || text(meta.text) }
      }
      return { workspaceId: ctx.workspaceId, id: key, ...detail, imageUrls: [], datasetMode: 'UNKNOWN',
        writeState: 'unsupported', reason: '현재는 검토만 가능해요. 실행 전 대상·권한·내용을 다시 확인해야 해요.' }
    },
  }
}
