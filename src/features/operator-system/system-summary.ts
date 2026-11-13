import type { NaverPostQueueSummary } from './schemas'

export type QueueKind = 'waiting' | 'running' | 'retryable_failure' | 'dead_letter'
export type QueueInput = Readonly<{ kind: QueueKind; count: number | null; state: string }>

export const QUEUE_LABELS: Record<QueueKind, string> = {
  waiting: '대기',
  running: '처리 중',
  retryable_failure: '재시도 필요',
  dead_letter: '실패 보관',
}

export const QUEUE_HINTS: Record<QueueKind, string> = {
  waiting: '아직 시작하지 않은 작업',
  running: '지금 처리하고 있는 작업',
  retryable_failure: '실패했지만 다시 시도할 작업',
  dead_letter: '재시도를 모두 소진해 따로 보관한 작업',
}

export type QueueTile = Readonly<{ kind: QueueKind; label: string; hint: string; value: number | null; tone: 'default' | 'warn' | 'bad' }>

/** 큐 관측값. 조회 실패/미관측이면 값은 null(확인할 수 없어요), 0으로 바꾸지 않는다. */
export function buildQueueTiles(queue: readonly QueueInput[] | null | undefined): QueueTile[] {
  const kinds: QueueKind[] = ['waiting', 'running', 'retryable_failure', 'dead_letter']
  return kinds.map((kind) => {
    const found = queue?.find((q) => q.kind === kind)
    const value = found && found.state !== 'error' && found.count !== null ? found.count : null
    const tone = value !== null && value > 0 ? (kind === 'dead_letter' ? 'bad' : kind === 'retryable_failure' ? 'warn' : 'default') : 'default'
    return { kind, label: QUEUE_LABELS[kind], hint: QUEUE_HINTS[kind], value, tone }
  })
}

export type NaverQueueKind = 'pending' | 'running' | 'failed' | 'credit_reconcile_needed'

export const NAVER_QUEUE_LABELS: Record<NaverQueueKind, string> = {
  pending: '대기',
  running: '진행 중',
  failed: '실패',
  credit_reconcile_needed: '환불 대기',
}

export const NAVER_QUEUE_HINTS: Record<NaverQueueKind, string> = {
  pending: '발행 처리를 기다리는 네이버 블로그 작업',
  running: '네이버 블로그에 발행 중인 작업',
  failed: '발행 중 오류가 발생한 작업',
  credit_reconcile_needed: '실패 후 크레딧 환불 대사가 필요한 작업',
}

export type NaverQueueTile = Readonly<{
  kind: NaverQueueKind
  label: string
  hint: string
  value: number | null
  tone: 'default' | 'warn' | 'bad'
}>

export function buildNaverQueueTiles(summary: NaverPostQueueSummary | null | undefined): NaverQueueTile[] {
  return [
    {
      kind: 'pending',
      label: NAVER_QUEUE_LABELS.pending,
      hint: NAVER_QUEUE_HINTS.pending,
      value: summary ? summary.pending : null,
      tone: 'default',
    },
    {
      kind: 'running',
      label: NAVER_QUEUE_LABELS.running,
      hint: NAVER_QUEUE_HINTS.running,
      value: summary ? summary.running : null,
      tone: 'default',
    },
    {
      kind: 'failed',
      label: NAVER_QUEUE_LABELS.failed,
      hint: NAVER_QUEUE_HINTS.failed,
      value: summary ? summary.failed : null,
      tone: summary?.failed && summary.failed > 0 ? 'warn' : 'default',
    },
    {
      kind: 'credit_reconcile_needed',
      label: NAVER_QUEUE_LABELS.credit_reconcile_needed,
      hint: NAVER_QUEUE_HINTS.credit_reconcile_needed,
      value: summary ? summary.creditReconcileNeededCount : null,
      tone: summary?.creditReconcileNeededCount && summary.creditReconcileNeededCount > 0 ? 'bad' : 'default',
    },
  ]
}

const SOURCE_LABELS: Record<string, string> = {
  conversation_jobs: '대화 처리 작업',
  provider_webhooks: '채널 알림 수신',
  operation_events: '운영 이벤트',
  cloudflare: '서비스 인프라',
  queue: '작업 큐',
  cron: '예약 작업',
  release: '배포',
}
export function systemSourceLabel(source: string): string { return SOURCE_LABELS[source] ?? '기타 항목' }

const STATE_LABELS: Record<string, string> = { healthy: '정상', degraded: '성능 저하', error: '오류', empty: '기록 없음', unknown: '확인 안 됨' }
export function systemStateLabel(state: string): string { return STATE_LABELS[state] ?? '확인 안 됨' }

const FRESHNESS_LABELS: Record<string, string> = { fresh: '최신', stale: '오래됨', empty: '기록 없음', unknown: '확인 안 됨', error: '오류' }
export function freshnessLabel(value: string): string { return FRESHNESS_LABELS[value] ?? '확인 안 됨' }

const VERIFICATION_LABELS: Record<string, string> = { verified: '검증 완료', failed: '검증 실패', pending: '검증 대기', unknown: '검증 여부 확인 안 됨' }
export function verificationLabel(value: string | null | undefined): string { return value ? VERIFICATION_LABELS[value] ?? '검증 여부 확인 안 됨' : '확인할 수 없어요' }

const SEVERITY_LABELS: Record<string, string> = { low: '낮음', medium: '보통', high: '높음', critical: '긴급' }
export function severityLabel(value: string): string { return SEVERITY_LABELS[value] ?? '확인 필요' }

const INCIDENT_STATUS_LABELS: Record<string, string> = { open: '처리 전', acknowledged: '확인함', resolved: '해결됨' }
export function incidentStatusLabel(value: string): string { return INCIDENT_STATUS_LABELS[value] ?? '확인 필요' }

export type OverallHealth = 'unknown' | 'healthy' | 'attention'

/**
 * 종합 상태. 관측 조회가 실패했거나 관측값이 하나도 없으면 unknown,
 * 오류·성능 저하 또는 미해결 인시던트(조회 성공 시)가 있으면 attention, 그 외 healthy.
 */
export function deriveOverallHealth(input: Readonly<{
  observations: readonly { state: string }[] | null
  activeIncidentCount: number | null
  naverReconcileNeededCount?: number | null
}>): OverallHealth {
  const obs = input.observations
  if (!obs || obs.length === 0) return 'unknown'
  if (obs.some((o) => o.state === 'error' || o.state === 'degraded')) return 'attention'
  if (input.activeIncidentCount !== null && input.activeIncidentCount > 0) return 'attention'
  if (input.naverReconcileNeededCount !== null && input.naverReconcileNeededCount !== undefined && input.naverReconcileNeededCount > 0) return 'attention'
  if (obs.every((o) => o.state === 'unknown' || o.state === 'empty')) return 'unknown'
  return 'healthy'
}
