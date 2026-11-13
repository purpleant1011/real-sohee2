import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { redactAuditValue } from '@/features/operator-audit/redact-audit-value'
import { KNOWLEDGE_JOURNAL_NOTICE, knowledgeJournalSchema, type KnowledgeJournal, type KnowledgeJournalEntry } from './knowledge-journal'

const uuid = z.string().uuid()
const timestamp = z.string().datetime({ offset: true })
const base = z.object({ id: uuid, workspace_id: uuid })
const requestRow = base.extend({ thread_id: uuid, role: z.literal('user'), status: z.literal('completed'), content: z.string(), created_at: timestamp })
const executionRow = base.extend({ thread_id: uuid, status: z.string(), queued_at: timestamp, completed_at: timestamp.nullable(), attention_resolved_at: timestamp.nullable() })
const automationRow = base.extend({ kind: z.string(), active: z.boolean(), next_run_at: timestamp.nullable(), updated_at: timestamp })
const scheduleRow = base.extend({ status: z.string(), publish_at: timestamp, timezone: z.string().max(64), updated_at: timestamp })
const learningRow = base.extend({ kind: z.enum(['fact', 'goal']), category: z.string(), content: z.string(), status: z.string(), created_at: timestamp })
const memoryRow = base.extend({ subject: z.string(), fact_content: z.string(), status: z.string(), created_at: timestamp })

type Kind = KnowledgeJournalEntry['kind']
type SourceType = KnowledgeJournalEntry['sourceType']
const sourceTypesByKind: Record<Kind, SourceType> = { instruction: 'message', execution: 'conversation_job', automation: 'automation_rule', schedule: 'schedule', learning: 'studio_proposal', memory: 'agent_memory' }
type SourceTable = 'messages' | 'conversation_jobs' | 'automation_rules' | 'schedules' | 'sohee_studio_proposals' | 'knowledge_candidates' | 'agent_memories'
type Source = { kind: Kind; sourceType?: SourceType; table: SourceTable; fields: string; time: string; filters?: readonly [string, string][]; project(value: unknown): KnowledgeJournalEntry }

function preview(value: string): string {
  const redacted = redactAuditValue(value.replace(/\s+/gu, ' ').trim())
  if (redacted === '[REDACTED]') return '민감한 정보가 포함된 기록입니다. 원본 대화에서 확인해 주세요.'
  if (redacted === '[LIMIT_EXCEEDED]') return '긴 기록입니다. 원본에서 전체 내용을 확인해 주세요.'
  return typeof redacted === 'string' ? redacted.slice(0, 400) : '원본 기록에서 확인해 주세요.'
}

const routineLabels: Record<string, string> = {
  daily_performance_report: '일일 성과 보고', twice_daily_performance_report: '하루 두 번 성과 보고',
  weekly_plan_proposal: '주간 계획 검토', connection_health_check: '채널 연결 점검', approved_schedule_readiness: '승인 일정 준비 점검',
}
const executionLabels: Record<string, string> = { queued: '접수·실행 대기', running: '실행 중', cancel_requested: '중단 요청됨', succeeded: '완료', needs_attention: '결과 확인 필요', cancelled: '중단됨' }
const scheduleLabels: Record<string, string> = { scheduled: '게시 예정', cancelled: '취소됨', published: '게시 결과 기록됨', failed: '실패 기록' }

/** Read-only projection: messages and domain ledgers remain the durable sources, not copied facts. */
export async function loadKnowledgeJournal(input: { client: ServerSupabaseClient; workspaceId: string; limit?: number }): Promise<KnowledgeJournal> {
  const workspaceId = uuid.parse(input.workspaceId)
  const limit = z.number().int().min(1).max(80).parse(input.limit ?? 30)
  const entry = (kind: Kind, raw: { id: string; workspace_id: string }, occurredAt: string, title: string, summary: string, statusLabel: string, href: string, sourceType: SourceType = sourceTypesByKind[kind]): KnowledgeJournalEntry => {
    if (raw.workspace_id !== workspaceId) throw new Error('KNOWLEDGE_JOURNAL_SCOPE_MISMATCH')
    return { id: `${sourceType}:${raw.id}`, sourceId: raw.id, sourceType, kind, occurredAt, title: preview(title).slice(0, 200) || '기록', summary: preview(summary), statusLabel, href }
  }
  const sources: Source[] = [
    { kind: 'instruction', table: 'messages', fields: 'id,workspace_id,thread_id,role,status,content,created_at', time: 'created_at', filters: [['role', 'user'], ['status', 'completed']],
      project(value) { const row = requestRow.parse(value); return entry('instruction', row, row.created_at, '대화 지시·요청', row.content, '원문 기록됨', `/app/conversations/${row.thread_id}`) } },
    { kind: 'execution', table: 'conversation_jobs', fields: 'id,workspace_id,thread_id,status,queued_at,completed_at,attention_resolved_at', time: 'queued_at',
      project(value) { const row = executionRow.parse(value); const status = row.status === 'needs_attention' && row.attention_resolved_at ? '확인 후 종료됨' : executionLabels[row.status] ?? '상태 확인 필요'; return entry('execution', row, row.completed_at ?? row.queued_at, '대화 업무 실행', '접수된 업무의 실제 실행 상태입니다. 지식이나 외부 실행 성공으로 자동 승격하지 않습니다.', status, `/app/conversations/${row.thread_id}`) } },
    { kind: 'automation', table: 'automation_rules', fields: 'id,workspace_id,kind,active,next_run_at,updated_at', time: 'updated_at',
      project(value) { const row = automationRow.parse(value); return entry('automation', row, row.updated_at, routineLabels[row.kind] ?? '자동화 설정', row.next_run_at ? `현재 설정의 다음 실행 예정: ${row.next_run_at}` : '현재 설정에 다음 실행 시각이 없습니다. 설정 활성과 실제 실행 결과는 다릅니다.', row.active ? '활성 설정' : '비활성 설정', '/app/account/automation') } },
    { kind: 'schedule', table: 'schedules', fields: 'id,workspace_id,status,publish_at,timezone,updated_at', time: 'updated_at',
      project(value) { const row = scheduleRow.parse(value); const local = new Intl.DateTimeFormat('ko-KR', { timeZone: row.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.publish_at)); return entry('schedule', row, row.updated_at, '게시 일정 상태', `게시 예정 ${local} · ${row.timezone}. 실제 게시 완료는 결과 원장에서 확인합니다.`, scheduleLabels[row.status] ?? '상태 확인 필요', '/app/schedule') } },
    { kind: 'learning', table: 'sohee_studio_proposals', fields: 'id,workspace_id,kind,category,content,status,created_at', time: 'created_at',
      project(value) { const row = learningRow.parse(value); const labels: Record<string, string> = { proposed: '검토 전 후보', confirmed: '확정 이력', rejected: '채택하지 않음' }; return entry('learning', row, row.created_at, row.kind === 'goal' ? '목표 검토 기록' : `지식 검토 · ${row.category}`, row.content, labels[row.status] ?? '검토 상태 확인', '/app/sohee?tab=studio') } },
    { kind: 'learning', sourceType: 'knowledge_candidate', table: 'knowledge_candidates', fields: 'id,workspace_id,category,content,status,created_at', time: 'created_at',
      project(value) { const row = base.extend({ category: z.string(), content: z.string(), status: z.string(), created_at: timestamp }).parse(value); const labels: Record<string, string> = { approved: '승인 이력', rejected: '채택하지 않음', pending: '검토 전 후보', candidate: '검토 전 후보' }; return entry('learning', row, row.created_at, `학습 후보 · ${row.category}`, row.content, labels[row.status] ?? '검토 상태 확인', '/app/sohee?tab=studio', 'knowledge_candidate') } },
    { kind: 'memory', table: 'agent_memories', fields: 'id,workspace_id,subject,fact_content,status,created_at', time: 'created_at',
      project(value) { const row = memoryRow.parse(value); const labels: Record<string, string> = { approved: '승인된 기억', canonical: '정본 기억', proposed: '검토 전 후보', candidate: '검토 전 후보', archived: '이전 기록' }; return entry('memory', row, row.created_at, row.subject || '학습·기억 기록', row.fact_content, labels[row.status] ?? '기억 상태 확인', '/app/sohee?tab=studio') } },
  ]
  const loaded = await Promise.all(sources.map(async source => {
    const sourceType = source.sourceType ?? sourceTypesByKind[source.kind]
    try {
      let query = input.client.from(source.table).select(source.fields).eq('workspace_id', workspaceId)
      for (const [field, value] of source.filters ?? []) query = query.eq(field, value)
      const response = await query.order(source.time, { ascending: false }).limit(limit + 1)
      if (response.error || !Array.isArray(response.data)) throw new Error('KNOWLEDGE_JOURNAL_SOURCE_UNAVAILABLE')
      const entries = response.data.map(source.project)
      return { kind: source.kind, sourceType, entries: entries.slice(0, limit), state: entries.length ? 'ready' as const : 'confirmed_empty' as const, returnedCount: Math.min(limit, entries.length), more: entries.length > limit }
    } catch {
      return { kind: source.kind, sourceType, entries: [], state: 'unavailable' as const, returnedCount: null, more: false }
    }
  }))
  const combined = loaded.flatMap(source => source.entries).sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || left.id.localeCompare(right.id))
  return knowledgeJournalSchema.parse({ workspaceId, observedAt: new Date().toISOString(), entries: combined.slice(0, limit),
    sources: loaded.map(({ kind, sourceType, state, returnedCount }) => ({ kind, sourceType, state, returnedCount })),
    partial: combined.length > limit || loaded.some(source => source.more || source.state === 'unavailable'), notice: KNOWLEDGE_JOURNAL_NOTICE })
}
