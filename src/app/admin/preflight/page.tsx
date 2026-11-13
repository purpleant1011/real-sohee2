import { requireOperator } from '@/features/operator-auth/require-operator'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { referenceCode } from '@/components/admin-ui/labels'
import { createPreflightQueueGateway } from '@/features/admin/preflight-queue/repository'
import { PreflightActionForm } from '@/features/admin/preflight-queue/action-form'
import { currentSessionHealth } from '@/features/admin/preflight-queue/session-health'
import { loadPreflightQueue, type QueueEntry } from '@/features/admin/preflight-queue/service'
import { REASON_GROUP_IDS, REASON_GROUP_LABEL } from '@/features/admin/preflight-queue/reason-groups'

export const dynamic = 'force-dynamic'

function ActionForms({ entry }: { entry: QueueEntry }) {
  return <PreflightActionForm workspaceId={entry.workspaceId} vaultItemId={entry.vaultItemId} noteId={`note-${entry.runId}`} />
}

export default async function AdminPreflightPage() {
  await requireOperator('publish.read')
  const result = await loadPreflightQueue(createPreflightQueueGateway())
  const sessions = currentSessionHealth()

  if (result.status === 'error') {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <PageHeader
          title="발행 전 점검"
          description="발행 전에 막힌 항목을 사유별로 확인하고 조치 기록을 남기세요."
        />
        <LoadErrorNotice what="재검사 실패 큐" retryHref="/admin/preflight" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <PageHeader
        title="발행 전 점검"
        description="발행 전에 막힌 항목을 사유별로 확인하고 조치 기록을 남기세요. 운영자 조치는 감사 기록만 남기며 사용자의 승인 상태는 바뀌지 않습니다."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="재검사 실패 건수"
          value={`${result.total}건`}
          tone={result.total > 0 ? 'warn' : 'default'}
          hint={`최근 ${result.windowDays}일 기준`}
        />
        <MetricTile
          label="실패 사유 분류"
          value={`${result.groups.length}개 유형`}
          hint="사유 그룹별 분류"
        />
        <MetricTile
          label="브라우저 세션"
          value={`${sessions.filter(s => s.state === 'HEALTHY').length}개 정상`}
          hint={`총 ${sessions.length}개 채널 연동`}
        />
      </div>

      <section aria-labelledby="session-heading" className="space-y-3">
        <h2 id="session-heading" className="text-base font-semibold">브라우저 세션 상태</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <li key={s.channel} className="flex items-center justify-between rounded-lg border bg-card p-3 shadow-xs">
              <span className="text-sm font-medium">{s.channelLabel}</span>
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                s.state === 'HEALTHY'
                  ? 'bg-state-ok/10 text-state-ok'
                  : 'bg-state-warn/10 text-state-warn'
              }`}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="queue-heading" className="space-y-4">
        <h2 id="queue-heading" className="text-base font-semibold">사유별 실패 큐 ({result.total}건)</h2>
        {result.groups.length === 0 ? (
          <EmptyNotice
            title={`최근 ${result.windowDays}일 동안 재검사에 실패한 콘텐츠가 없어요`}
            description="모든 발행 준비 콘텐츠가 검사를 통과했거나 아직 대기 중입니다."
          />
        ) : (
          result.groups.map((group) => (
            <Card key={group.group} className="border shadow-xs">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="font-semibold text-sm">{group.label}</h3>
                  <span className="inline-flex items-center rounded-md bg-state-warn/10 px-2 py-0.5 text-xs font-semibold text-state-warn">
                    {group.count}건
                  </span>
                </div>
                <ul className="space-y-4 pt-1">
                  {group.entries.map((entry) => (
                    <li key={entry.runId} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          사업장 참조번호 {referenceCode(entry.workspaceId)}
                        </span>
                        <span>·</span>
                        <span>보관 항목 {referenceCode(entry.vaultItemId)}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {entry.reasons.map((r) => r.message).join(' / ')}
                      </p>
                      {entry.handling ? (
                        <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                          이전 처리 기록: <span className="font-medium text-foreground">{entry.handling}</span>
                          {entry.note ? ` · ${entry.note}` : ''}
                        </p>
                      ) : null}
                      <ActionForms entry={entry} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="trend-heading" className="space-y-3">
        <h2 id="trend-heading" className="text-base font-semibold">최근 {result.windowDays}일 사유별 발생 추이</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr className="text-xs font-semibold text-muted-foreground">
                <th scope="col" className="p-3 text-left">날짜</th>
                {REASON_GROUP_IDS.map((id) => (
                  <th key={id} scope="col" className="p-3 text-center">{REASON_GROUP_LABEL[id]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.trend.map((day) => (
                <tr key={day.date} className="hover:bg-muted/30">
                  <th scope="row" className="p-3 text-left font-normal text-muted-foreground">{day.date}</th>
                  {REASON_GROUP_IDS.map((id) => (
                    <td key={id} className="p-3 text-center font-medium">
                      {day.counts[id] > 0 ? (
                        <span className="font-semibold text-state-warn">{day.counts[id]}</span>
                      ) : (
                        <span className="text-muted-foreground/60">0</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
