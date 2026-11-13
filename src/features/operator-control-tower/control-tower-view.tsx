import Link from 'next/link'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatRelativeKst } from '@/components/admin-ui/labels'
import type { OperatorHome } from './operator-home'

const SEVERITY_DOT: Record<string, string> = {
  publish_failed: 'bg-red-600', channel_problem: 'bg-amber-600', low_credit: 'bg-amber-600',
  system_warning: 'bg-red-600', onboarding_stuck: 'bg-slate-500',
}
const RESULT_LABEL: Record<string, string> = { failed: '실패', denied: '거부됨' }
const MAX_RISK_ROWS = 10

export function ControlTowerView({ home, now }: { home: OperatorHome; now: Date }) {
  const shownRisks = home.risks.slice(0, MAX_RISK_ROWS)
  const hiddenRisks = home.risks.length - shownRisks.length

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <PageHeader title="운영 현황" description="고객사, 게시, 채널, 크레딧의 지금 상태를 한눈에 확인하세요." />

      {home.failedSources.length > 0 ? (
        <LoadErrorNotice what={home.failedSources.join('·')} retryHref="/admin" />
      ) : null}

      <section aria-labelledby="key-numbers" className="space-y-3">
        <h2 id="key-numbers" className="text-sm font-bold text-foreground">핵심 숫자</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {home.tiles.map((tile) => (
            <MetricTile key={tile.key} label={tile.label} value={tile.value} hint={tile.hint} tone={tile.tone} href={tile.href} />
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="needs-attention" className="space-y-3">
          <h2 id="needs-attention" className="text-sm font-bold text-foreground">지금 확인이 필요한 일</h2>
          <Card className="overflow-hidden p-0">
            {home.riskStatus === 'items' ? (
              <ul className="divide-y">
                {shownRisks.map((risk) => (
                  <li key={risk.id}>
                    <Link href={risk.href} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-purple-600">
                      <span className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT[risk.kind] ?? 'bg-slate-500'}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{risk.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{risk.detail}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
                {hiddenRisks > 0 ? <li className="px-4 py-3 text-xs text-muted-foreground">그 밖에 {hiddenRisks}건이 더 있어요.</li> : null}
                {home.failedSources.length > 0 ? (
                  <li className="px-4 py-3 text-xs text-amber-800 dark:text-amber-300">{home.failedSources.join('·')}은(는) 확인하지 못해 이 목록에 빠져 있을 수 있어요.</li>
                ) : null}
              </ul>
            ) : home.riskStatus === 'unconfirmed' ? (
              <EmptyNotice title="지금은 확인할 수 없어요" description={`${home.failedSources.join('·')}을(를) 불러오지 못해 문제가 없는지 판단할 수 없어요.`} />
            ) : (
              <EmptyNotice title="지금 확인이 필요한 일이 없어요" />
            )}
          </Card>
        </section>

        <div className="space-y-6">
          <section aria-labelledby="emergency" className="space-y-3">
            <h2 id="emergency" className="text-sm font-bold text-foreground">긴급 조치</h2>
            <Card className="space-y-3 p-4">
              <p className="text-xs text-muted-foreground">예상치 못한 문제로 게시나 작업을 멈춰야 할 때는 긴급 개입 화면에서 영향 범위를 확인하고 사유를 남긴 뒤 실행해요.</p>
              <Link href="/admin/interventions" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-red-700/40 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 dark:bg-red-950/30 dark:text-red-300">
                <ShieldAlert className="size-4" aria-hidden />
                긴급 개입 열기
              </Link>
            </Card>
          </section>

          <section aria-labelledby="recent-activity" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="recent-activity" className="text-sm font-bold text-foreground">최근 활동</h2>
              <Link href="/admin/audit" className="inline-flex min-h-11 items-center text-xs font-semibold text-purple-700 hover:underline">감사 로그 보기</Link>
            </div>
            <Card className="overflow-hidden p-0">
              {home.recent === null ? (
                <div className="p-4 text-sm text-muted-foreground">최근 활동을 불러오지 못했어요.</div>
              ) : home.recent.length === 0 ? (
                <EmptyNotice title="아직 기록된 활동이 없어요" />
              ) : (
                <ul className="divide-y">
                  {home.recent.map((event) => (
                    <li key={event.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {event.text}
                          {RESULT_LABEL[event.result] ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">{RESULT_LABEL[event.result]}</span> : null}
                        </p>
                        {event.workspaceName ? <p className="truncate text-xs text-muted-foreground">{event.workspaceName}</p> : null}
                      </div>
                      <time dateTime={event.createdAt} className="shrink-0 text-xs text-muted-foreground">{formatRelativeKst(event.createdAt, now)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}
