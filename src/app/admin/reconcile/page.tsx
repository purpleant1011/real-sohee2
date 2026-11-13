import { requireOperator } from '@/features/operator-auth/require-operator'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { SupabaseReconcileStore } from '@/features/admin/reconcile/repository'
import { loadReconcileQueue, readableScopes } from '@/features/admin/reconcile/service'
import { ReconcileQueue } from '@/features/admin/reconcile/queue'

export const dynamic = 'force-dynamic'

export default async function ReconcilePage() {
  const operator = await requireOperator('publish.read')
  let queue: Awaited<ReturnType<typeof loadReconcileQueue>> | null = null
  try {
    queue = await loadReconcileQueue({ scopes: readableScopes(operator) }, new SupabaseReconcileStore())
  } catch {
    /* Failure is displayed explicitly, never interpreted as an empty queue. */
  }

  if (queue === null) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <PageHeader
          title="외부 대사"
          description="외부 채널의 실제 게시 결과와 내부 기록을 대조하여 독립 확인과 증거 검토를 진행하세요."
        />
        <LoadErrorNotice what="외부 대사 대기열" retryHref="/admin/reconcile" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <PageHeader
        title="외부 대사"
        description="제공자 접수만으로 게시 성공을 확정하지 않습니다. 외부 재게시 대신 독립 확인과 증거 검토를 진행하세요."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="확인 완료 게시"
          value={`${queue.verifiedCount}건`}
          hint="독립 조회 증거로 확인된 게시"
        />
        <MetricTile
          label="확인 대기"
          value={`${queue.items.length}건`}
          tone={queue.items.length > 0 ? 'warn' : 'default'}
          hint="운영자 증거 검토 대기"
        />
        <MetricTile
          label="대사 정책"
          value="임의 재게시 차단"
          hint="증거 확정 전 중복 발행 방지"
        />
      </div>

      <ReconcileQueue items={queue.items} />
    </main>
  )
}
