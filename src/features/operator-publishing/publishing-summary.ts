import type { PublishOperation } from './publish-read-schemas'

export const PUBLISH_STATUS_FILTERS = ['pending', 'publishing', 'success', 'failure', 'unknown'] as const
export type PublishStatusFilter = (typeof PUBLISH_STATUS_FILTERS)[number]

export const PUBLISH_STATUS_FILTER_LABELS: Record<PublishStatusFilter, string> = {
  pending: '대기 중',
  publishing: '게시 중',
  success: '게시 완료',
  failure: '실패',
  unknown: '확인 필요',
}

export type PublishingSummary = Readonly<{
  total: number
  published: number
  inProgress: number
  failed: number
  needsCheck: number
  /** 완료 / (완료 + 실패). 끝난 건이 없으면 null (0%로 보이지 않게). */
  successRate: number | null
}>

export function summarizePublishOperations(items: readonly Pick<PublishOperation, 'displayState'>[]): PublishingSummary {
  let published = 0
  let inProgress = 0
  let failed = 0
  let needsCheck = 0
  for (const item of items) {
    if (item.displayState === 'success') published += 1
    else if (item.displayState === 'pending' || item.displayState === 'publishing') inProgress += 1
    else if (item.displayState === 'failure') failed += 1
    else needsCheck += 1
  }
  const finished = published + failed
  return { total: items.length, published, inProgress, failed, needsCheck, successRate: finished > 0 ? published / finished : null }
}

export function formatSuccessRate(rate: number | null): string | null {
  return rate === null ? null : `${(rate * 100).toFixed(1)}%`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export type PublishingFilters = Readonly<{ status?: PublishStatusFilter; workspaceId?: string; cursor?: string }>

function first(value: unknown): string | undefined {
  const picked = Array.isArray(value) ? value[0] : value
  return typeof picked === 'string' && picked.trim() ? picked.trim() : undefined
}

/** URL 쿼리를 안전한 필터로 변환한다. 잘못된 값은 무시한다. */
export function parsePublishingSearchParams(params: unknown): PublishingFilters {
  const record = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
  const status = first(record.status)
  const workspaceId = first(record.workspaceId)
  const cursor = first(record.cursor)
  return {
    ...(status && (PUBLISH_STATUS_FILTERS as readonly string[]).includes(status) ? { status: status as PublishStatusFilter } : {}),
    ...(workspaceId && UUID.test(workspaceId) ? { workspaceId } : {}),
    ...(cursor && cursor.length <= 2048 ? { cursor } : {}),
  }
}

export function buildPublishingHref(filters: PublishingFilters): string {
  const query = new URLSearchParams()
  if (filters.status) query.set('status', filters.status)
  if (filters.workspaceId) query.set('workspaceId', filters.workspaceId)
  if (filters.cursor) query.set('cursor', filters.cursor)
  const text = query.toString()
  return text ? `/admin/publishing?${text}` : '/admin/publishing'
}
