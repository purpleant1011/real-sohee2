import 'server-only'

import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { NaverPostJobDlqItem, NaverPostQueueSummary } from './schemas'

export type { NaverPostJobDlqItem, NaverPostQueueSummary }

export interface NaverSystemRepositoryDependencies {
  adminClient?: any
}

export type NaverQueueSummaryResult = Readonly<{
  data: NaverPostQueueSummary | null
  error: string | null
}>

export type NaverDlqListResult = Readonly<{
  data: readonly NaverPostJobDlqItem[] | null
  error: string | null
}>

export async function getNaverPostQueueSummary(
  dependencies: NaverSystemRepositoryDependencies = {},
): Promise<NaverQueueSummaryResult> {
  try {
    const admin = dependencies.adminClient ?? createAdminSupabaseClient()

    const [pendingRes, runningRes, failedRes, reconcileRes] = await Promise.all([
      admin.from('naver_post_jobs').select('id', { count: 'exact' }).eq('status', 'pending'),
      admin.from('naver_post_jobs').select('id', { count: 'exact' }).eq('status', 'running'),
      admin.from('naver_post_jobs').select('id', { count: 'exact' }).eq('status', 'failed'),
      admin.from('naver_post_jobs').select('id', { count: 'exact' }).eq('credit_reconcile_needed', true),
    ])

    const extractCount = (res: any): number | null => {
      if (res?.error) {
        console.error('[operator-system] naver_post_jobs count error:', res.error)
        return null
      }
      if (typeof res?.count === 'number') return res.count
      if (Array.isArray(res?.data)) return res.data.length
      return 0
    }

    const pending = extractCount(pendingRes)
    const running = extractCount(runningRes)
    const failed = extractCount(failedRes)
    const creditReconcileNeededCount = extractCount(reconcileRes)

    if (pending === null && running === null && failed === null && creditReconcileNeededCount === null) {
      return { data: null, error: 'NAVER_QUEUE_READ_UNAVAILABLE' }
    }

    return {
      data: {
        pending: pending ?? 0,
        running: running ?? 0,
        failed: failed ?? 0,
        creditReconcileNeededCount: creditReconcileNeededCount ?? 0,
      },
      error: null,
    }
  } catch (error) {
    console.error('[operator-system] unexpected error querying naver post queue summary:', error)
    return { data: null, error: 'NAVER_QUEUE_READ_UNAVAILABLE' }
  }
}

export async function listNaverPostDlqItems(
  dependencies: NaverSystemRepositoryDependencies = {},
  options: { limit?: number } = {},
): Promise<NaverDlqListResult> {
  try {
    const admin = dependencies.adminClient ?? createAdminSupabaseClient()
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100))

    const { data, error } = await admin
      .from('naver_post_jobs')
      .select('id, workspace_id, request_key, user_id, status, content_id, version_id, credit_reconcile_needed, created_at, updated_at')
      .eq('credit_reconcile_needed', true)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error || !Array.isArray(data)) {
      console.error('[operator-system] listNaverPostDlqItems error:', error ?? 'non-array payload')
      return { data: null, error: 'NAVER_DLQ_READ_UNAVAILABLE' }
    }

    const items: NaverPostJobDlqItem[] = data.map((row: any) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      requestKey: row.request_key,
      userId: row.user_id,
      status: row.status,
      contentId: row.content_id ?? null,
      versionId: row.version_id ?? null,
      creditReconcileNeeded: Boolean(row.credit_reconcile_needed),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

    return { data: items, error: null }
  } catch (error) {
    console.error('[operator-system] unexpected error listing naver dlq items:', error)
    return { data: null, error: 'NAVER_DLQ_READ_UNAVAILABLE' }
  }
}

export { getOperatorSystemObservations } from './repository'
export type { SystemObservationError } from './repository'
