import Link from 'next/link'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst } from '@/components/admin-ui/labels'
import { loadCohort } from '@/features/admin/cohort/repository'
import {
  buildQueue, computeFunnel, summarizeDropoff, REASON_LABEL, STAGE_LABEL,
  type QueueReason, type SourceStatus,
} from '@/features/admin/cohort/funnel'
import { COHORT_CONFIG } from '@/features/admin/cohort/config'

export const dynamic = 'force-dynamic'

const SOURCE_NOTE: Record<SourceStatus, string> = { OK: '확인됨', ERROR: '읽지 못했어요', NOT_CONNECTED: '연결 전' }

function elapsedText(hours: number | null) {
  if (hours === null) return '확인 전'
  return hours >= 24 ? `${Math.floor(hours / 24)}일 ${hours % 24}시간` : `${hours}시간`
}

export default async function AdminCohortPage() {
  await requireOperator('workspace.read')
  const observedAt = new Date()
  const load = await loadCohort()

  if (load.status === 'ERROR') {
    return (
      <main className="p-6 space-y-6">
        <PageHeader
          title="코호트"
          description="가입 시기별 고객사의 정착·이탈 흐름을 확인하고, 머물러 있는 고객사를 조치하세요."
        />
        <LoadErrorNotice what="코호트 데이터" retryHref="/admin/cohort" />
      </main>
    )
  }

  const funnels = load.inputs.map((i) => computeFunnel(i, observedAt))
  const queue = buildQueue(load.inputs, funnels)
  const dropoff = summarizeDropoff(funnels)
  const totalText = load.totalConfirmed ? `${load.inputs.length}곳` : '확인 전'

  return (
    <main className="p-6 space-y-6">
      <PageHeader
        title="코호트"
        description="가입 시기별 고객사의 정착·이탈 흐름을 확인하고, 머물러 있는 고객사를 조치하세요."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="실운영 사업장"
          value={load.totalConfirmed ? `${load.inputs.length}곳` : null}
          hint={load.unclassified > 0 ? `분류 미확정 ${load.unclassified}곳 제외` : '분류 확정 완료'}
        />
        <MetricTile
          label="집중 케어 필요"
          value={queue.complete ? `${queue.items.length}곳` : null}
          tone={queue.items.length > 0 ? 'warn' : 'default'}
          hint={`${COHORT_CONFIG.STALL_HOURS}시간 이상 정체된 고객사`}
        />
        <MetricTile
          label="조회 기준 시각"
          value={formatKst(observedAt)}
          hint={load.totalConfirmed ? '데이터 최신' : '일부 확인 전'}
        />
      </div>

      {load.unclassified > 0 && (
        <div className="rounded-lg border border-state-warn/30 bg-state-warn/5 px-4 py-2.5 text-xs text-state-warn" role="status">
          분류가 비어 있는 사업장이 {load.unclassified}곳 있어 전체 숫자를 확정하지 않았어요.
        </div>
      )}

      <section aria-labelledby="queue-h" className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="queue-h" className="text-base font-semibold">오늘 챙겨야 할 고객사 ({COHORT_CONFIG.STALL_HOURS}시간 이상 같은 단계)</h2>
          <ul className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {(Object.keys(queue.sources) as QueueReason[]).map((k) => (
              <li key={k}>{REASON_LABEL[k]}: <span className="font-medium text-foreground">{SOURCE_NOTE[queue.sources[k]]}</span></li>
            ))}
          </ul>
        </div>
        {queue.items.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {queue.items.map((item) => (
              <Card key={item.workspaceId}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/admin/workspaces/${item.workspaceId}`}
                      className="font-semibold text-foreground hover:underline dark:text-primary"
                    >
                      {item.name}
                    </Link>
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {item.reasons.map((r) => (
                      <li key={r} className="flex items-center gap-1.5">
                        <span className="inline-block size-1.5 rounded-full bg-state-warn" />
                        <span>{REASON_LABEL[r]}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyNotice
            title={queue.complete ? '지금 챙길 고객사가 없어요' : '일부 자료를 확인하지 못했어요'}
            description={queue.complete ? '모든 고객사가 원활하게 다음 단계로 진행 중입니다.' : '일부 자료를 읽지 못해 비어 있는지 확인할 수 없어요.'}
          />
        )}
      </section>

      <section aria-labelledby="ws-h" className="space-y-3">
        <h2 id="ws-h" className="text-base font-semibold">사업장별 현재 단계</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left text-xs font-semibold text-muted-foreground">
                <th className="p-3">사업장</th>
                <th className="p-3">막힌 단계</th>
                <th className="p-3">머문 시간</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {funnels.map((f) => (
                <tr key={f.workspaceId} className="hover:bg-muted/30">
                  <td className="p-3">
                    <Link href={`/admin/workspaces/${f.workspaceId}`} className="font-medium text-foreground hover:underline dark:text-primary">
                      {f.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    {f.status === 'COMPLETED' ? (
                      <span className="inline-flex items-center rounded-md bg-state-ok/10 px-2 py-0.5 text-xs font-medium text-state-ok">
                        모두 도달
                      </span>
                    ) : f.blockedStage ? (
                      <span className="inline-flex items-center rounded-md bg-state-warn/10 px-2 py-0.5 text-xs font-medium text-state-warn">
                        {STAGE_LABEL[f.blockedStage]}
                      </span>
                    ) : (
                      '확인 전'
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">{f.status === 'BLOCKED' ? elapsedText(f.elapsedHours) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="drop-h" className="space-y-3">
        <h2 id="drop-h" className="text-base font-semibold">단계별 이탈 요약</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-left text-xs font-semibold text-muted-foreground">
                <th className="p-3">단계</th>
                <th className="p-3">도달</th>
                <th className="p-3">여기서 멈춤</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dropoff.map((row) => (
                <tr key={row.stage} className="hover:bg-muted/30">
                  <td className="p-3 font-medium">{row.label}</td>
                  <td className="p-3 text-muted-foreground">{row.reached !== undefined ? `${row.reached}곳` : '확인 전'}</td>
                  <td className="p-3 text-muted-foreground">{row.blockedHere !== undefined ? `${row.blockedHere}곳` : '확인 전'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
