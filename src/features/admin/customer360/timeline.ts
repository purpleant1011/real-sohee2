import {
  actionKindLabel,
  channelLabel,
  contentStatusLabel,
  creditKindLabel,
  publishStateLabel,
  receiptKindLabel,
} from '@/components/admin-ui/labels'
import { maskText, summarizeMasked } from './mask'
import type { Chain, ChainLink, Customer360Timeline, DbRead, SourceKey, SourceReport, TimelineEvent } from './types'

type Row = Record<string, any>
interface SourceResult { report: SourceReport; events: TimelineEvent[]; rows?: Record<string, Row[]> }

const cid = (type: string, id: string) => `${type}:${id}`
const LABELS: Record<SourceKey, string> = {
  workspace: '가입', onboarding: '온보딩', content: '초안', approvals: '승인', vault: '보관',
  preflight: '재검사', external_actions: '발행 요청·시도·결과', credits: '크레딧', inquiries: '문의·불만', operator: '운영자 개입',
}

interface ReadResult {
  rows: Row[]
  error: string | null
  truncated: boolean
}

/** Every query is scoped by workspace_id; rows from another workspace are additionally dropped defensively. */
async function read(db: DbRead, table: string, columns: string, workspaceId: string, workspaceColumn = 'workspace_id'): Promise<ReadResult> {
  try {
    const answer = await db.from(table).select(columns).eq(workspaceColumn, workspaceId)
    if (answer.error || !Array.isArray(answer.data)) return { rows: [], error: String(answer.error?.code ?? 'QUERY_FAILED'), truncated: false }
    const raw = answer.data as Row[]
    const truncated = raw.length >= 1000
    const rows = raw.filter(r => r[workspaceColumn] === undefined || r[workspaceColumn] === workspaceId)
    return { rows, error: null, truncated }
  } catch {
    return { rows: [], error: 'QUERY_FAILED', truncated: false }
  }
}

function failed(source: SourceKey, code: string): SourceResult {
  return { report: { source, label: LABELS[source], status: 'error', count: 0, message: `조회 실패 (${code})` }, events: [] }
}
function done(source: SourceKey, events: TimelineEvent[], rows?: Record<string, Row[]>, truncated = false): SourceResult {
  if (truncated) {
    return {
      report: { source, label: LABELS[source], status: 'truncated', count: events.length, message: '1000행 초과로 일부가 절단되었습니다' },
      events,
      rows,
    }
  }
  return { report: { source, label: LABELS[source], status: 'ok', count: events.length }, events, rows }
}
const iso = (v: unknown): string => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? '' : d.toISOString() }
const ev = (e: Omit<TimelineEvent, 'detail'> & { detail?: unknown }): TimelineEvent =>
  ({ ...e, occurredAt: iso(e.occurredAt), title: maskText(e.title), detail: typeof e.detail === 'string' ? maskText(e.detail) : summarizeMasked(e.detail) })

async function workspaceSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'workspaces', 'id,created_at', ws, 'id')
  if (error) return failed('workspace', error)
  return done('workspace', rows.map(r => ev({ canonicalId: cid('workspace', r.id), kind: 'signup', source: 'workspace', occurredAt: r.created_at, title: '가입 (사업장 생성)', outcome: 'ok', refs: { workspace: cid('workspace', r.id) } })), undefined, truncated)
}

async function onboardingSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'onboarding_sessions', 'id,workspace_id,status,active_step,created_at,completed_at', ws)
  if (error) return failed('onboarding', error)
  const events: TimelineEvent[] = []
  for (const r of rows) {
    events.push(ev({ canonicalId: cid('onboarding_session', r.id), kind: 'onboarding', source: 'onboarding', occurredAt: r.created_at, title: '온보딩 시작', detail: `단계 ${r.active_step}`, outcome: 'neutral', refs: {} }))
    if (r.completed_at) events.push(ev({ canonicalId: cid('onboarding_completed', r.id), kind: 'onboarding', source: 'onboarding', occurredAt: r.completed_at, title: '온보딩 완료', outcome: 'ok', refs: {} }))
  }
  return done('onboarding', events, undefined, truncated)
}

async function contentSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'content_items', 'id,workspace_id,title,status,created_at', ws)
  if (error) return failed('content', error)
  return done('content', rows.map(r => ev({ canonicalId: cid('content', r.id), kind: 'draft', source: 'content', occurredAt: r.created_at, title: '초안 생성', detail: `${r.title ?? ''} · 현재 ${contentStatusLabel(r.status)}`, outcome: 'neutral', refs: { content: cid('content', r.id) } })), undefined, truncated)
}

async function approvalSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'approvals', 'id,workspace_id,content_id,version_id,status,reason,decided_at', ws)
  if (error) return failed('approvals', error)
  return done('approvals', rows.map(r => ev({ canonicalId: cid('approval', r.id), kind: 'approval', source: 'approvals', occurredAt: r.decided_at, title: r.status === 'approved' ? '승인' : '반려', detail: r.reason, outcome: r.status === 'approved' ? 'ok' : 'fail', refs: { content: cid('content', r.content_id) } })), undefined, truncated)
}

async function vaultSource(db: DbRead, ws: string): Promise<SourceResult> {
  const [events, items] = await Promise.all([
    read(db, 'vault_events', 'id,workspace_id,vault_item_id,event_type,payload,occurred_at', ws),
    read(db, 'vault_items', 'id,workspace_id,content_id,channel,release_gate,hold_reason,created_at', ws),
  ])
  if (events.error || items.error) return failed('vault', events.error ?? items.error ?? 'QUERY_FAILED')
  const out = events.rows.map(r => {
    const item = items.rows.find(i => i.id === r.vault_item_id)
    const release = String(r.event_type).includes('release')
    return ev({
      canonicalId: cid('vault_event', r.id), kind: release ? 'release_request' : 'vault', source: 'vault', occurredAt: r.occurred_at,
      title: release ? `발행 요청 기록 (${r.event_type})` : `보관 이벤트 (${r.event_type})`, detail: r.payload, outcome: 'neutral',
      refs: { vault_item: cid('vault_item', r.vault_item_id), content: item ? cid('content', item.content_id) : null },
    })
  })
  return done('vault', out, { vault_items: items.rows }, events.truncated || items.truncated)
}

async function preflightSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'preflight_runs', 'id,workspace_id,vault_item_id,run_at,overall,items', ws)
  if (error) return failed('preflight', error)
  return done('preflight', rows.map(r => {
    const reasons = (Array.isArray(r.items) ? r.items : []).filter((i: Row) => i?.status === 'FAIL' || i?.status === 'UNKNOWN').map((i: Row) => String(i.message ?? i.code ?? ''))
    return ev({
      canonicalId: cid('preflight_run', r.id), kind: 'preflight', source: 'preflight', occurredAt: r.run_at,
      title: r.overall === 'PASS' ? '재검사 통과' : r.overall === 'FAIL' ? '재검사 실패' : '재검사 판정 불가',
      detail: r.overall === 'PASS' ? '' : `사유: ${reasons.join(' / ') || '확인된 사유 없음'}`,
      outcome: r.overall === 'PASS' ? 'ok' : r.overall === 'FAIL' ? 'fail' : 'unknown', refs: { vault_item: cid('vault_item', r.vault_item_id) },
    })
  }), undefined, truncated)
}

async function externalSource(db: DbRead, ws: string): Promise<SourceResult> {
  const [reqs, atts, recs] = await Promise.all([
    read(db, 'external_action_requests', 'id,workspace_id,channel,action_kind,status,failure_code,content_version_id,created_at', ws),
    read(db, 'external_action_attempts', 'id,workspace_id,action_request_id,attempt_number,status,failure_code,started_at', ws),
    read(db, 'external_action_receipts', 'id,workspace_id,action_request_id,attempt_id,receipt_kind,recorded_at', ws),
  ])
  const err = reqs.error ?? atts.error ?? recs.error
  if (err) return failed('external_actions', err)
  const out: TimelineEvent[] = []
  for (const r of reqs.rows) out.push(ev({ canonicalId: cid('external_action_request', r.id), kind: 'release_request', source: 'external_actions', occurredAt: r.created_at, title: '발행 요청', detail: `${channelLabel(r.channel)} · ${actionKindLabel(r.action_kind)} · 현재 ${publishStateLabel(r.status)}${r.failure_code ? ` · ${r.failure_code}` : ''}`, outcome: r.status === 'failed' ? 'fail' : 'neutral', refs: { request: cid('external_action_request', r.id) } }))
  for (const a of atts.rows) out.push(ev({ canonicalId: cid('external_action_attempt', a.id), kind: 'publish_attempt', source: 'external_actions', occurredAt: a.started_at, title: `발행 시도 ${a.attempt_number}회`, detail: `${publishStateLabel(a.status)}${a.failure_code ? ` · ${a.failure_code}` : ''}`, outcome: a.status === 'succeeded' ? 'ok' : a.status === 'failed' ? 'fail' : 'unknown', refs: { request: cid('external_action_request', a.action_request_id) } }))
  for (const c of recs.rows) out.push(ev({ canonicalId: cid('external_action_receipt', c.id), kind: 'receipt', source: 'external_actions', occurredAt: c.recorded_at, title: `영수증 (${receiptKindLabel(c.receipt_kind)})`, outcome: 'neutral', refs: { request: cid('external_action_request', c.action_request_id), attempt: c.attempt_id ? cid('external_action_attempt', c.attempt_id) : null } }))
  return done('external_actions', out, { requests: reqs.rows, attempts: atts.rows, receipts: recs.rows }, reqs.truncated || atts.truncated || recs.truncated)
}

async function creditSource(db: DbRead, ws: string): Promise<SourceResult> {
  const { rows, error, truncated } = await read(db, 'credit_ledger_entries', 'id,workspace_id,kind,action,amount,idempotency_key,occurred_at', ws)
  if (error) return failed('credits', error)
  return done('credits', rows.map(r => ev({ canonicalId: cid('credit_ledger_entry', r.id), kind: 'credit', source: 'credits', occurredAt: r.occurred_at, title: `크레딧 ${creditKindLabel(r.kind)} ${r.amount > 0 ? '+' : ''}${r.amount}`, detail: r.action ?? '', outcome: 'neutral', refs: { idem: r.idempotency_key } })), { ledger: rows }, truncated)
}

async function operatorSource(db: DbRead, ws: string): Promise<SourceResult> {
  const [platform, missions] = await Promise.all([
    read(db, 'platform_audit_events', 'id,workspace_id,action,target_type,target_id,reason,result,created_at', ws),
    read(db, 'mission_events', 'id,workspace_id,mission_id,event_name,actor_type,to_status,occurred_at', ws),
  ])
  const err = platform.error ?? missions.error
  if (err) return failed('operator', err)
  const out = [
    ...platform.rows.map(r => ev({ canonicalId: cid('platform_audit_event', r.id), kind: 'operator' as const, source: 'operator' as const, occurredAt: r.created_at, title: `운영자 조치 (${r.action})`, detail: r.reason, outcome: r.result === 'succeeded' ? 'ok' as const : 'fail' as const, refs: {} })),
    ...missions.rows.filter(r => r.actor_type === 'operator').map(r => ev({ canonicalId: cid('mission_event', r.id), kind: 'operator' as const, source: 'operator' as const, occurredAt: r.occurred_at, title: `운영자 개입 (${r.event_name})`, detail: `상태 ${r.to_status}`, outcome: 'neutral' as const, refs: { mission: cid('marketing_mission', r.mission_id) } })),
  ]
  return done('operator', out, undefined, platform.truncated || missions.truncated)
}

/** No inquiry/complaint table exists yet; shown as 연결 전, never as an empty list. */
function inquirySource(): SourceResult {
  return { report: { source: 'inquiries', label: LABELS.inquiries, status: 'not_connected', count: 0, message: '연결 전' }, events: [] }
}

const NOT_LINKED: ChainLink = { label: '연결 전', href: null, canonicalId: null }
const anchor = (ws: string, id: string) => `/admin/workspaces/${ws}/timeline#${id}`

export function buildChains(ws: string, events: TimelineEvent[], ledger: Row[], missions: Row[], vaultItems: Row[]): Chain[] {
  const chains: Chain[] = []
  const has = (id: string | null | undefined) => (id ? events.some(e => e.canonicalId === id) : false)
  const link = (label: string, id: string | null | undefined, href?: string): ChainLink =>
    id && (href || has(id)) ? { label, canonicalId: id, href: href ?? anchor(ws, id) } : { ...NOT_LINKED, label: `${label} · 연결 전` }
  const wsId = cid('workspace', ws)

  // 1) 보관 → 재검사 → 발행 요청 → 결과
  for (const item of vaultItems) {
    const itemId = cid('vault_item', item.id)
    const mine = events.filter(e => e.refs.vault_item === itemId)
    const saved = mine.find(e => e.kind === 'vault')
    const preflights = mine.filter(e => e.kind === 'preflight').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    const release = mine.find(e => e.kind === 'release_request')
    const requests = events.filter(e => e.kind === 'release_request' && e.source === 'external_actions')
    const result = events.filter(e => e.kind === 'publish_attempt' || e.kind === 'receipt')
    const lastPre = preflights[0]
    const verdict = !lastPre ? '재검사 기록이 없어 발행 가능 여부를 알 수 없습니다.'
      : lastPre.outcome === 'ok' ? '재검사를 통과했습니다.'
      : `재검사 ${lastPre.outcome === 'fail' ? '실패' : '판정 불가'}: ${lastPre.detail.replace(/^사유: /, '')}`
    chains.push({
      title: `보관 글 ${itemId}`, verdict,
      steps: [
        link('보관', saved?.canonicalId),
        link('재검사', lastPre?.canonicalId),
        link('발행 요청', release?.canonicalId ?? (requests.length === 1 ? requests[0].canonicalId : null)),
        link('결과', result.length === 1 ? result[0].canonicalId : null),
      ],
    })
  }

  // 2) workspace → mission → action_run(attempt) → receipt → ledger
  for (const m of missions) {
    const mid = cid('marketing_mission', m.id)
    const reqId = m.external_action_request_id ? cid('external_action_request', m.external_action_request_id) : null
    const attId = m.external_action_attempt_id ? cid('external_action_attempt', m.external_action_attempt_id) : null
    const recId = m.external_action_receipt_id ? cid('external_action_receipt', m.external_action_receipt_id) : null
    const ledgerHit = reqId ? ledger.find(l => String(l.idempotency_key ?? '').includes(m.external_action_request_id)) : null
    chains.push({
      title: `미션 ${mid}`,
      verdict: recId ? '영수증까지 연결되었습니다.' : attId ? '발행 시도는 있으나 영수증이 연결되지 않았습니다.' : reqId ? '발행 요청만 있고 시도 기록이 없습니다.' : '발행 요청이 연결되지 않아 게시되지 않았습니다.',
      steps: [
        { label: '사업장', canonicalId: wsId, href: anchor(ws, wsId) },
        { label: '미션', canonicalId: mid, href: `/admin/missions/${m.id}` },
        link('발행 시도', attId),
        link('영수증', recId),
        ledgerHit ? { label: '크레딧 내역', canonicalId: cid('credit_ledger_entry', ledgerHit.id), href: anchor(ws, cid('credit_ledger_entry', ledgerHit.id)) } : { ...NOT_LINKED, label: '크레딧 내역 · 연결 전' },
      ],
    })
  }
  return chains
}

export async function buildCustomer360Timeline(db: DbRead, workspaceId: string): Promise<Customer360Timeline> {
  const [ws, onboarding, content, approvals, vault, preflight, external, credits, operator, missionRows] = await Promise.all([
    workspaceSource(db, workspaceId), onboardingSource(db, workspaceId), contentSource(db, workspaceId), approvalSource(db, workspaceId),
    vaultSource(db, workspaceId), preflightSource(db, workspaceId), externalSource(db, workspaceId), creditSource(db, workspaceId),
    operatorSource(db, workspaceId),
    read(db, 'marketing_missions', 'id,workspace_id,external_action_request_id,external_action_attempt_id,external_action_receipt_id', workspaceId),
  ])
  const all = [ws, onboarding, content, approvals, vault, preflight, external, credits, operator, inquirySource()]
  const events = all.flatMap(r => r.events)
    .filter(e => e.occurredAt)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.canonicalId.localeCompare(b.canonicalId))
  const chains = buildChains(workspaceId, events, credits.rows?.ledger ?? [], missionRows.error ? [] : missionRows.rows, vault.rows?.vault_items ?? [])
  const sources = all.map(r => r.report)
  if (missionRows.error) sources.push({ source: 'operator', label: '미션 연결', status: 'error', count: 0, message: `조회 실패 (${missionRows.error})` })
  return { workspaceId, events, sources, chains }
}
