import type { DecisionPage, MobileMetric, Remote } from './contracts'

export function metricText(metric: Pick<MobileMetric, 'state' | 'value' | 'unit' | 'evidenceRef' | 'source' | 'datasetMode' | 'period'>): string {
  if (metric.state === 'loading') return '확인 중'
  if (metric.state === 'error') return '확인 불가'
  if (metric.state === 'stale') return '업데이트 필요'
  // 출처를 댈 수 없는 값은 숫자가 아니라 '근거 확인 필요'다. 서버가 빈 출처를 보냈거나
  // 파싱 과정에서 출처가 빠져도 숫자는 그리지 않는다(fail-closed).
  const source = typeof metric.source === 'string' ? metric.source.trim() : ''
  if (metric.state !== 'ready' || metric.datasetMode !== 'ACTUAL' || !metric.evidenceRef || source === '' ||
      !metric.period || metric.value === null || !Number.isFinite(metric.value)) return '근거 확인 필요'
  return `${metric.value.toLocaleString('ko-KR')}${metric.unit}`
}

export function confirmedEmpty(source: Pick<Remote<DecisionPage>, 'state' | 'data'>): boolean {
  return source.state === 'ready' && source.data?.complete === true && source.data.total === 0 && source.data.items.length === 0
}

export function selectDecisions<T extends { id: string; createdAt: string; expiresAt: string | null }>(items: readonly T[]): T[] {
  const time = (value: string | null) => {
    const parsed = value ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
  }
  return [...items].sort((a, b) => time(a.expiresAt) - time(b.expiresAt) ||
    time(a.createdAt) - time(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 3)
}

// R1 deliberately has no executable capability. Client flags cannot grant one.
export function canExecuteApproval(view: unknown, now: number): false { void view; void now; return false }

export function approvalKey(value: string): { kind: 'dm' | 'comment' | 'post'; id: string } | null {
  const match = /^(dm|comment|post):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value)
  return match ? { kind: match[1] as 'dm' | 'comment' | 'post', id: match[2] } : null
}

export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app'
  try {
    const url = new URL(value, 'https://sohee.invalid')
    const roots = ['/app/content', '/app/vault', '/app/customers', '/app/engagement', '/app/results', '/app/approvals']
    if (url.origin !== 'https://sohee.invalid' || !(url.pathname === '/app' ||
      roots.some(root => url.pathname === root || url.pathname.startsWith(`${root}/`)))) return '/app'
    return `${url.pathname}${url.search}`
  } catch { return '/app' }
}
