import { riskItemSchema, type OperatorRiskOverview, type RiskItem, type RiskWorkspaceEvidence } from './risk-schemas'

export type RiskAggregateInput = Readonly<{
  workspaces: readonly Readonly<{ workspaceId: string; workspaceName: string; workspaceStatus: string | null; updatedAt?: string | null; dataFreshness?: 'fresh' | 'stale' | 'unknown' }>[]
  lifecycle: readonly Readonly<{ workspaceId: string; missing: readonly string[]; sourceTimestamp: string | null }>[] | null
  channels: readonly Readonly<{ workspaceId: string; channel: string; status: string; updatedAt: string | null }>[] | null
  publishing: readonly Readonly<{ workspaceId: string; channel: string; displayState: string; freshness: 'fresh' | 'stale' | 'unknown'; approvalStatus: string | null; currentVersionId: string | null; approvedVersionId: string | null }>[] | null
  billing: readonly Readonly<{ workspaceId: string; state: string; balanceState: string; available: number | null; sourceTimestamp: string | null }>[] | null
  audit: readonly Readonly<{ workspaceId: string | null; action: string; result: string; createdAt: string; freshness: 'fresh' | 'stale' | 'unknown' }>[] | null
  support: readonly Readonly<{ workspaceId: string; status: string; startedAt: string; expiresAt: string }>[] | null
  system: readonly Readonly<{ source: string; state: string; freshness: string; observedAt: string | null; safeCode: string | null }>[] | null
  failedSources?: readonly string[]
  truncatedSources?: readonly string[]
}>
type AggregateChannel = { workspaceId: string; channel: string; status: string; updatedAt: string | null }
type AggregatePublishing = { workspaceId: string; channel: string; displayState: string; freshness: 'fresh' | 'stale' | 'unknown'; approvalStatus: string | null; currentVersionId: string | null; approvedVersionId: string | null }
type AggregateAudit = { workspaceId: string | null; action: string; result: string; createdAt: string; freshness: 'fresh' | 'stale' | 'unknown' }
type AggregateSupport = { workspaceId: string; status: string; startedAt: string; expiresAt: string }

type CardMetadata = OperatorRiskOverview['summary']['cardMetadata'][keyof OperatorRiskOverview['summary']['cardMetadata']]

function metadata(sourceLabel: string, windowLabel: string, observedAt: string | null, value: CardMetadata['freshness']): CardMetadata {
  return { sourceLabel, windowLabel, observedAt, freshness: value }
}

function metadataFreshness(timestamp: string | null, now: Date): CardMetadata['freshness'] {
  return freshness(timestamp, now)
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
  const valid = values.filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)))
  if (valid.length === 0) return null
  return valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest)
}

function combineFreshness(values: readonly CardMetadata['freshness'][]): CardMetadata['freshness'] {
  if (values.length === 0 || values.includes('unknown')) return 'unknown'
  if (values.includes('stale')) return 'stale'
  return 'fresh'
}

function freshness(timestamp: string | null, now: Date): RiskItem['freshness'] {
  if (timestamp === null) return 'unknown'
  const value = Date.parse(timestamp)
  if (!Number.isFinite(value) || value > now.getTime()) return 'unknown'
  return now.getTime() - value <= 86_400_000 ? 'fresh' : 'stale'
}

function item(input: RiskItem, now: Date, preserveFreshness = false): RiskItem {
  return riskItemSchema.parse({ ...input, freshness: preserveFreshness ? input.freshness : freshness(input.source_timestamp, now) })
}

export function buildOperatorRiskOverview(evidence: readonly RiskWorkspaceEvidence[], now = new Date()): OperatorRiskOverview {
  const items: RiskItem[] = []
  for (const workspace of evidence) {
    const href = `/admin/workspaces/${workspace.workspaceId}`
    if (workspace.lifecycle.state !== 'ready') items.push(item({ id: `${workspace.workspaceId}:lifecycle`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '가입·계약 자료 확인 필요', detail: workspace.lifecycle.state === 'forbidden' || workspace.lifecycle.state === 'out_of_scope' ? '권한 또는 범위 밖이라 확인할 수 없습니다.' : '라이프사이클 자료가 연결되지 않았습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: workspace.lifecycle.sourceTimestamp, freshness: 'unknown', href: `${href}#workspace-lifecycle` }, now))
    else if (workspace.lifecycle.missing.length > 0) items.push(item({ id: `${workspace.workspaceId}:lifecycle-missing`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '활성화 필수 항목 미완료', detail: workspace.lifecycle.missing.join(', '), severity: 'medium', fact_kind: 'observed', source_timestamp: workspace.lifecycle.sourceTimestamp, freshness: 'unknown', href: `${href}#workspace-lifecycle` }, now))
    if (workspace.channels === null) items.push(item({ id: `${workspace.workspaceId}:channels-unknown`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '채널 상태 확인 필요', detail: '채널 safe read를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: `${href}#workspace-channels` }, now))
    else for (const channel of workspace.channels.filter((channel) => ['error', 'expired', 'reverify_required', 'wrong_account', 'missing_permission'].includes(channel.status))) items.push(item({ id: `${workspace.workspaceId}:channel:${channel.channel}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '채널 운영 위험', detail: `${channel.channel} · ${channel.status}`, severity: channel.status === 'error' ? 'critical' : 'high', fact_kind: 'observed', source_timestamp: channel.updatedAt, freshness: 'unknown', href: `${href}#workspace-channels` }, now))
    if (workspace.publishing === null) items.push(item({ id: `${workspace.workspaceId}:publishing-unknown`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '게시 상태 확인 필요', detail: '게시 safe read를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: `${href}#workspace-publishing` }, now))
    else for (const operation of workspace.publishing) {
      const approvalNeeded = operation.displayState === 'pending' || (operation.currentVersionId !== null && operation.approvedVersionId === null)
      if (operation.displayState === 'failure') items.push(item({ id: `${workspace.workspaceId}:publish:${operation.channel}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '게시 실패', detail: operation.channel, severity: 'critical', fact_kind: 'observed', source_timestamp: null, freshness: operation.freshness, href: `${href}#workspace-publishing` }, now, true))
      else if (operation.displayState === 'unknown') items.push(item({ id: `${workspace.workspaceId}:publish:${operation.channel}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '게시 상태 확인 필요', detail: operation.channel, severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: operation.freshness, href: `${href}#workspace-publishing` }, now, true))
      else if (operation.approvalStatus === 'rejected') items.push(item({ id: `${workspace.workspaceId}:publish:${operation.channel}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '승인 거절 검토 필요', detail: operation.channel, severity: 'high', fact_kind: 'observed', source_timestamp: null, freshness: operation.freshness, href: `${href}#workspace-publishing` }, now, true))
      else if (approvalNeeded) items.push(item({ id: `${workspace.workspaceId}:publish:${operation.channel}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '승인 필요 · 대기', detail: operation.channel, severity: 'medium', fact_kind: 'observed', source_timestamp: null, freshness: operation.freshness, href: `${href}#workspace-publishing` }, now, true))
    }
    if (workspace.billing === null) items.push(item({ id: `${workspace.workspaceId}:billing-unknown`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '결제·크레딧 확인 필요', detail: 'billing safe read를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: `${href}#workspace-billing` }, now))
    else if (workspace.billing.balanceState === 'error' || workspace.billing.balanceState === 'stale' || (workspace.billing.available !== null && workspace.billing.available <= 0)) items.push(item({ id: `${workspace.workspaceId}:billing-risk`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: workspace.billing.available !== null && workspace.billing.available <= 0 ? '크레딧 한도 확인 필요' : '크레딧 원장 확인 필요', detail: workspace.billing.available !== null && workspace.billing.available <= 0 ? '가용 크레딧이 0 이하입니다.' : `원장 상태 · ${workspace.billing.balanceState}`, severity: workspace.billing.balanceState === 'error' ? 'high' : 'medium', fact_kind: 'observed', source_timestamp: workspace.billing.sourceTimestamp, freshness: 'unknown', href: `${href}#workspace-billing` }, now))
    if (workspace.audit === null) items.push(item({ id: `${workspace.workspaceId}:audit-unknown`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '감사 기록 확인 필요', detail: '감사 safe read를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: '/admin/audit' }, now))
    else for (const event of workspace.audit.filter((event) => event.result === 'failed')) items.push(item({ id: `${workspace.workspaceId}:audit:${event.action}:${event.createdAt}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '최근 운영 실패 이벤트', detail: event.action, severity: 'high', fact_kind: 'observed', source_timestamp: event.createdAt, freshness: 'unknown', href: '/admin/audit' }, now))
    if (workspace.support === null) items.push(item({ id: `${workspace.workspaceId}:support-unknown`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: '지원 세션 상태 확인 필요', detail: '지원 session safe read를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: `${href}#workspace-support` }, now))
    else for (const session of workspace.support.filter((session) => session.status === 'active')) { const expired = Date.parse(session.expiresAt) <= now.getTime(); items.push(item({ id: `${workspace.workspaceId}:support:${session.expiresAt}`, workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, title: expired ? '지원 세션 접근 차단 확인 필요' : '진행 중인 보기 전용 지원 세션', detail: expired ? `지원 세션 원장 · 만료 즉시 접근 차단 확인 필요` : `지원 세션 원장 · 만료 시각 ${session.expiresAt}`, severity: expired ? 'high' : 'low', fact_kind: 'observed', source_timestamp: session.startedAt, freshness: 'unknown', href: `${href}#workspace-support` }, now)) }
  }
  const counts = (severity: RiskItem['severity']) => { const count = items.filter((item) => item.severity === severity).length; return count === 0 ? null : count }
  const timestamps = items.map((item) => item.source_timestamp).filter((value): value is string => value !== null).map(Date.parse).filter(Number.isFinite)
  const sourceTimestamp = timestamps.length === 0 ? null : new Date(Math.max(...timestamps)).toISOString()
  const overallFreshness = items.length === 0 ? 'unknown' : items.some((entry) => entry.freshness === 'stale') ? 'stale' : items.every((entry) => entry.freshness === 'unknown') ? 'unknown' : 'fresh'
  return { items, summary: { state: items.length === 0 ? 'empty' : items.every((item) => item.severity === 'unknown') ? 'unknown' : overallFreshness, critical: counts('critical'), high: counts('high'), medium: counts('medium'), activeCount: null, pendingApprovalCount: null, creditRiskCount: null, sourceTimestamp, cardMetadata: { critical: metadata('위험 집계', '현재 연결 source', sourceTimestamp, overallFreshness), activeCustomers: metadata('고객사 원장', '현재 원장', null, 'unknown'), pendingApprovals: metadata('승인·게시 원장', '현재 원장', null, 'unknown'), creditRisk: metadata('크레딧 원장', '현재 원장', null, 'unknown'), overall: metadata('운영 source 전체', '현재 연결 source', sourceTimestamp, overallFreshness) } } }
}

export function buildOperatorRiskOverviewFromAggregates(input: RiskAggregateInput, now = new Date()): OperatorRiskOverview {
  const lifecycle = new Map((input.lifecycle ?? []).map((row) => [row.workspaceId, row]))
  const channels = new Map<string, AggregateChannel[]>()
  for (const row of input.channels ?? []) channels.set(row.workspaceId, [...(channels.get(row.workspaceId) ?? []), row])
  const publishing = new Map<string, AggregatePublishing[]>()
  for (const row of input.publishing ?? []) publishing.set(row.workspaceId, [...(publishing.get(row.workspaceId) ?? []), row])
  const billing = new Map((input.billing ?? []).map((row) => [row.workspaceId, row]))
  const audit = new Map<string, AggregateAudit[]>()
  for (const row of input.audit ?? []) if (row.workspaceId !== null) audit.set(row.workspaceId, [...(audit.get(row.workspaceId) ?? []), row])
  const support = new Map<string, AggregateSupport[]>()
  for (const row of input.support ?? []) support.set(row.workspaceId, [...(support.get(row.workspaceId) ?? []), row])
  const evidence: RiskWorkspaceEvidence[] = input.workspaces.map((workspace) => ({
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    workspaceStatus: workspace.workspaceStatus,
    lifecycle: input.lifecycle === null ? { state: 'unknown' as const, missing: [], sourceTimestamp: null } : { state: 'ready' as const, missing: lifecycle.get(workspace.workspaceId)?.missing ?? [], sourceTimestamp: lifecycle.get(workspace.workspaceId)?.sourceTimestamp ?? null },
    channels: input.channels === null ? null : (channels.get(workspace.workspaceId) ?? []).map((row) => ({ channel: row.channel, status: row.status, updatedAt: row.updatedAt })),
    publishing: input.publishing === null ? null : (publishing.get(workspace.workspaceId) ?? []).map((row) => ({ channel: row.channel, displayState: row.displayState, freshness: row.freshness, approvalStatus: row.approvalStatus, currentVersionId: row.currentVersionId, approvedVersionId: row.approvedVersionId })),
    billing: input.billing === null ? null : (billing.get(workspace.workspaceId) ?? null),
    audit: input.audit === null ? null : (audit.get(workspace.workspaceId) ?? []),
    support: input.support === null ? null : (support.get(workspace.workspaceId) ?? []),
  }))
  const result = buildOperatorRiskOverview(evidence, now)
  const extra: RiskItem[] = []
  for (const source of input.failedSources ?? []) extra.push(item({ id: `source-failed:${source}`, workspace_id: null, workspace_name: '운영 source', title: `${source} 자료 확인 필요`, detail: '해당 safe read source를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: '/admin' }, now))
  for (const source of input.truncatedSources ?? []) extra.push(item({ id: `source-truncated:${source}`, workspace_id: null, workspace_name: '운영 source', title: `${source} 자료 일부만 확인됨`, detail: '페이지네이션 상한에 도달해 전체 위험을 판단할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: '/admin' }, now))
  if (input.system === null) extra.push(item({ id: 'system:unknown', workspace_id: null, workspace_name: '운영 시스템', title: '시스템 상태 확인 필요', detail: '시스템 safe read source를 확인할 수 없습니다.', severity: 'unknown', fact_kind: 'unknown', source_timestamp: null, freshness: 'unknown', href: '/admin' }, now))
  else for (const observation of input.system.filter((observation) => observation.state !== 'healthy')) {
    const severity: RiskItem['severity'] = observation.state === 'error' ? 'critical' : observation.state === 'degraded' ? 'high' : 'unknown'
    const observedFreshness = ['fresh', 'stale', 'unknown'].includes(observation.freshness) ? observation.freshness as RiskItem['freshness'] : 'unknown'
    extra.push(item({ id: `system:${observation.source}`, workspace_id: null, workspace_name: '운영 시스템', title: `시스템 ${observation.source} 상태`, detail: observation.safeCode ?? observation.state, severity, fact_kind: severity === 'unknown' ? 'unknown' : 'observed', source_timestamp: observation.observedAt, freshness: observedFreshness, href: '/admin/system' }, now, true))
  }
  const merged = [...result.items, ...extra]
  const counts = (severity: RiskItem['severity']) => { const count = merged.filter((item) => item.severity === severity).length; return count === 0 ? null : count }
  const timestamps = merged.map((entry) => entry.source_timestamp).filter((value): value is string => value !== null).map(Date.parse).filter(Number.isFinite)
  const activeCount = (input.failedSources ?? []).includes('고객사') ? null : input.workspaces.filter((workspace) => workspace.workspaceStatus === 'active').length
  const pendingApprovalCount = input.publishing === null ? null : input.publishing.filter((item) => item.displayState === 'pending' || (item.currentVersionId !== null && item.approvedVersionId === null)).length
  const creditRiskCount = input.billing === null ? null : input.billing.filter((item) => item.balanceState === 'error' || item.balanceState === 'stale' || (item.available !== null && item.available <= 0)).length
  const sourceTimestamp = timestamps.length === 0 ? null : new Date(Math.max(...timestamps)).toISOString()
  const workspaceTimestamps = input.workspaces.map((workspace) => workspace.updatedAt ?? null)
  const activeFreshness = input.failedSources?.includes('고객사') ? 'unknown' : combineFreshness(input.workspaces.map((workspace) => workspace.dataFreshness ?? 'unknown'))
  const pendingFreshness = input.publishing === null ? 'unknown' : combineFreshness(input.publishing.map((operation) => operation.freshness))
  const billingTimestamps = input.billing?.map((row) => row.sourceTimestamp) ?? []
  const billingFreshness = input.billing === null ? 'unknown' : combineFreshness(input.billing.map((row) => metadataFreshness(row.sourceTimestamp, now)))
  const overallFreshness = merged.length === 0 ? 'unknown' : merged.some((entry) => entry.freshness === 'stale') ? 'stale' : merged.every((entry) => entry.freshness === 'unknown') ? 'unknown' : 'fresh'
  return { items: merged, summary: { state: merged.length === 0 ? 'empty' : merged.every((entry) => entry.severity === 'unknown') ? 'unknown' : overallFreshness, critical: counts('critical'), high: counts('high'), medium: counts('medium'), activeCount, pendingApprovalCount, creditRiskCount, sourceTimestamp, cardMetadata: { critical: metadata('위험 집계', '현재 연결 source', sourceTimestamp, overallFreshness), activeCustomers: metadata(input.failedSources?.includes('고객사') ? '고객사 원장 · 연결 전' : '고객사 원장', '현재 원장', latestTimestamp(workspaceTimestamps), activeFreshness), pendingApprovals: metadata(input.publishing === null ? '승인·게시 원장 · 연결 전' : '승인·게시 원장', '현재 원장', null, pendingFreshness), creditRisk: metadata(input.billing === null ? '크레딧 원장 · 연결 전' : '크레딧 원장', '현재 원장', latestTimestamp(billingTimestamps), billingFreshness), overall: metadata('운영 source 전체', '현재 연결 source', sourceTimestamp, overallFreshness) } } }
}
