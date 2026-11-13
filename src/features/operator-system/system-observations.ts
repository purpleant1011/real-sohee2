import { systemView } from '@/features/operator-publishing/operator-admin-configs'
import type { OperatorAdminViewConfig } from '@/features/operator-publishing/operator-admin-view'
import type { SystemObservation } from './schemas'

const sourceLabels: Record<SystemObservation['source'], string> = {
  conversation_jobs: 'DB conversation jobs',
  provider_webhooks: 'Meta webhook 원장',
  operation_events: 'DB operation events',
  cloudflare: 'Cloudflare 관측 스냅샷',
  queue: 'Queue 관측 스냅샷',
  cron: 'Cron 관측 스냅샷',
  release: 'Release 관측 스냅샷',
}

const stateLabels: Record<SystemObservation['state'], string> = {
  healthy: '정상',
  degraded: '주의',
  error: '오류',
  empty: '자료 없음',
  unknown: '미확인',
}

const freshnessLabels: Record<SystemObservation['freshness'], string> = {
  fresh: '최근 확인',
  stale: '오래됨',
  empty: '자료 없음',
  unknown: '확인 전',
  error: '확인 필요',
}

function timestampLabel(value: string | null): string {
  return value === null ? '수집 전' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function find(items: readonly SystemObservation[], source: SystemObservation['source']): SystemObservation | null {
  return items.find((item) => item.source === source) ?? null
}

function statusValue(item: SystemObservation | null): string {
  return item === null ? '확인 전' : stateLabels[item.state]
}

export function buildSystemObservationView(items: readonly SystemObservation[], queue: readonly { kind: string; count: number | null; state: string; freshness: string; observedAt: string | null; safeCode: string | null; factKind: string }[] = [], release?: { versionCode: string | null; commitShaPrefix: string | null; deployedAt: string | null; rollbackCandidateCode: string | null; verificationState: string; source: string; factKind: string; freshness: string }): Readonly<{
  config: OperatorAdminViewConfig
  liveRows: readonly (readonly string[])[]
  liveSummary: readonly (readonly [string, string, string])[]
}> {
  const rows = [...items.map((item) => [
    sourceLabels[item.source],
    item.source.includes('snapshot') || ['cloudflare', 'queue', 'cron', 'release'].includes(item.source) ? '관측 스냅샷 원장' : 'DB 안전 projection',
    stateLabels[item.state],
    timestampLabel(item.observedAt),
    '측정 전',
    freshnessLabels[item.freshness],
    item.safeCode ?? '확인 전', item.factKind,
  ] as const), ...queue.map((item) => [`Queue · ${item.kind}`, 'Queue 안전 projection', item.state, item.observedAt ?? '수집 전', item.count === null ? '수집 전' : String(item.count), item.freshness, item.safeCode ?? '확인 전', item.factKind] as const), ...(release ? [[`Release · ${release.versionCode ?? '버전 확인 전'}`, 'Release 안전 snapshot', release.verificationState, release.deployedAt ?? '수집 전', release.commitShaPrefix ?? '커밋 확인 전', release.freshness, release.rollbackCandidateCode ?? '롤백 후보 확인 전', release.factKind] as const] : [])]
  const jobs = find(items, 'conversation_jobs')
  const database = find(items, 'operation_events')
  const provider = find(items, 'provider_webhooks')
  const observed = items.map((item) => item.observedAt).filter((value): value is string => value !== null).sort().at(-1) ?? null
  const liveSummary = [
    ['서비스 상태', items.some((item) => item.state === 'error') ? '오류' : items.some((item) => item.state === 'degraded') ? '주의' : items.length > 0 ? '정상' : '확인 전', 'DB·스냅샷 안전 projection'],
    ['데이터베이스', statusValue(database), database?.freshness ? freshnessLabels[database.freshness] : '관측 연결 전'],
    ['공급자 API', statusValue(provider), provider?.freshness ? freshnessLabels[provider.freshness] : '외부 관측 연결 전'],
    ['작업 큐', statusValue(jobs), jobs?.metricValue === null || jobs === null ? '대기·주의 건수 확인 전' : '안전한 집계값'],
    ['최근 점검', timestampLabel(observed), observed === null ? '신선도 확인 전' : '관측 timestamp 기준'],
  ] as const
  return { config: { ...systemView, description: `${systemView.description} 최근 24시간 관측 창 기준입니다.`, columns: [...systemView.columns, '사실 구분'] }, liveRows: rows, liveSummary }
}

export const systemObservationLabels = { stateLabels, freshnessLabels, sourceLabels }
