import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { DynamicAuditReadConsole } from '../../../features/operator-refine/operator-dynamic-views'
import { listOperatorAuditEvents } from '../../../features/operator-audit/audit-read-repository'
import { getOperatorAuditEvent } from '../../../features/operator-audit/audit-read-repository'
import { listOperatorAuditExportJobs } from '../../../features/operator-audit/audit-export-job-repository'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OperatorAuditPage({ searchParams }: { searchParams?: SearchParams } = {}) {
  await requireOperatorAnyScope('audit.read')
  const params = searchParams ? await searchParams : {}
  const scalar = (key: string) => typeof params[key] === 'string' ? params[key] as string : undefined
  const selected = scalar('event')
  const filters = { from: scalar('from'), to: scalar('to'), workspaceId: scalar('workspace'), actorId: scalar('actor'), action: scalar('action'), targetType: scalar('target'), result: scalar('result') as 'succeeded' | 'failed' | 'denied' | undefined, factKind: scalar('fact') as 'observed' | 'user_claim' | 'inference' | 'unknown' | undefined, cursor: scalar('cursor'), limit: 50 }
  const [result, jobs, detail] = await Promise.all([listOperatorAuditEvents(filters), listOperatorAuditExportJobs(), selected ? getOperatorAuditEvent(selected) : Promise.resolve({ data: null, error: null })])
  const exportJob = jobs.data?.[0]
  const mappedJob = exportJob ? { scope: exportJob.scope, workspaceName: exportJob.workspace_name, period: `${exportJob.export_from} ~ ${exportJob.export_to}`, generatedAt: exportJob.generated_at ?? '생성 전', rowCount: exportJob.row_count, fingerprintState: exportJob.filter_fingerprint_present ? `기록됨 · ${exportJob.filter_fingerprint_prefix ?? '접두어 확인 전'}` : '확인 전', hashState: exportJob.integrity_state, eventChainState: exportJob.event_chain_state, expiresAt: exportJob.expires_at, freshness: exportJob.freshness } : undefined
  return result.data === null ? (
    <DynamicAuditReadConsole
      events={[]}
      error={result.error}
      filters={filters}
      detail={detail.data}
      detailError={detail.error}
      exportStatus={jobs.error ? '연결 실패' : jobs.data?.length ? '연결됨' : '자료 없음'}
      exportJob={mappedJob}
    />
  ) : (
    <DynamicAuditReadConsole
      events={result.data.items}
      error={null}
      filters={filters}
      detail={detail.data}
      detailError={detail.error}
      exportStatus={jobs.error ? '연결 실패' : jobs.data?.length ? '연결됨' : '자료 없음'}
      exportJob={mappedJob}
    />
  )
}
