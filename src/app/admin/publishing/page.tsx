import Link from 'next/link'
import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorPublishOperations } from '../../../features/operator-publishing/publish-read-repository'
import { listOperatorWorkspaces } from '../../../features/operator-workspaces/repository'
import {
  PUBLISH_STATUS_FILTERS, PUBLISH_STATUS_FILTER_LABELS, buildPublishingHref, formatSuccessRate,
  parsePublishingSearchParams, summarizePublishOperations,
} from '../../../features/operator-publishing/publishing-summary'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { EmptyNotice, LoadErrorNotice, MfaRequiredNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { channelLabel, formatKst, publishStateLabel } from '@/components/admin-ui/labels'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONTROL = 'min-h-11 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
const ACTION = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export default async function OperatorPublishingPage(props?: { searchParams?: Promise<Record<string, unknown>> }) {
  await requireOperatorAnyScope('publish.read')
  const filters = parsePublishingSearchParams(props?.searchParams ? await props.searchParams : {})
  const [{ data, error }, workspaceResult] = await Promise.all([
    listOperatorPublishOperations({ limit: 50, ...filters }),
    listOperatorWorkspaces({ cursor: null, query: null, status: null, limit: 100 }).catch(() => ({ data: null, error: 'WORKSPACE_READ_UNAVAILABLE' })),
  ])
  const operations = data?.items ?? []
  const summary = data ? summarizePublishOperations(operations) : null
  const rate = summary ? formatSuccessRate(summary.successRate) : null
  const workspaces = workspaceResult.data?.items ?? []
  const retryHref = buildPublishingHref(filters)
  const filtered = Boolean(filters.status || filters.workspaceId)

  return (
    <div className="w-full space-y-7">
      <PageHeader
        title="발행 현황"
        description="고객사 콘텐츠가 각 채널에 실제로 게시됐는지 확인해요."
        actions={<Link href="/admin/reconcile" className={ACTION}>외부 대사 열기</Link>}
      />

      {error === 'MFA_REQUIRED' ? <MfaRequiredNotice /> : error ? <LoadErrorNotice what="발행 내역" retryHref={retryHref} /> : null}
      {workspaceResult.error === 'MFA_REQUIRED' && error !== 'MFA_REQUIRED' ? <MfaRequiredNotice /> : null}

      <form method="get" action="/admin/publishing" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" aria-label="발행 내역 필터">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          상태
          <select name="status" defaultValue={filters.status ?? ''} className={CONTROL}>
            <option value="">전체</option>
            {PUBLISH_STATUS_FILTERS.map((s) => <option key={s} value={s}>{PUBLISH_STATUS_FILTER_LABELS[s]}</option>)}
          </select>
        </label>
        {workspaceResult.data ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            고객사
            <select name="workspaceId" defaultValue={filters.workspaceId ?? ''} className={`${CONTROL} sm:min-w-56`}>
              <option value="">전체</option>
              {workspaces.map((w) => <option key={w.workspaceId} value={w.workspaceId}>{w.workspaceName}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" className={`${ACTION} bg-primary text-white hover:bg-primary/90`}>조회</button>
        {filtered ? <Link href="/admin/publishing" className={ACTION}>필터 지우기</Link> : null}
      </form>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <MetricTile label="게시 완료" value={summary ? summary.published : null} tone="good" hint="표시된 목록 기준" />
        <MetricTile label="진행 중" value={summary ? summary.inProgress : null} hint="대기 중 + 게시 중" />
        <MetricTile label="실패" value={summary ? summary.failed : null} tone={summary && summary.failed > 0 ? 'bad' : 'default'} hint="재시도·복구 대상" />
        <MetricTile label="확인 필요" value={summary ? summary.needsCheck : null} tone={summary && summary.needsCheck > 0 ? 'warn' : 'default'} hint="결과를 확정하지 못한 건" />
        <MetricTile label="게시 성공률" value={rate} hint={summary && rate === null ? '끝난 건이 아직 없어요' : '완료 ÷ (완료 + 실패)'} />
      </div>

      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <CardTitle className="text-sm font-bold">게시 내역 {summary ? `(${summary.total.toLocaleString('ko-KR')}건 표시)` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? null : operations.length === 0 ? (
            <EmptyNotice
              title={filtered ? '조건에 맞는 게시 내역이 없어요' : '아직 게시 내역이 없어요'}
              description={filtered ? '필터를 바꾸거나 지워 보세요.' : '고객사의 콘텐츠가 게시되면 여기에 나타나요.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>채널</TableHead>
                    <TableHead>고객사</TableHead>
                    <TableHead>콘텐츠 제목</TableHead>
                    <TableHead>시각</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">외부 링크</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operations.map((p) => (
                    <TableRow key={`${p.contentId}-${p.channel}-${p.scheduleId ?? 'x'}`} className="transition-colors hover:bg-muted/30">
                      <TableCell><Badge variant="outline" className="text-[11px] font-semibold">{channelLabel(p.channel)}</Badge></TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">{p.workspaceName}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-foreground">{p.contentTitle}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatKst(p.publishedAt ?? p.publishAt)}</TableCell>
                      <TableCell>
                        <Badge variant={p.displayState === 'success' ? 'success' : p.displayState === 'failure' ? 'destructive' : p.displayState === 'unknown' ? 'warning' : 'secondary'} className="text-[11px] font-semibold">
                          {publishStateLabel(p.displayState, p.channel)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{p.destinationUrlPresent ? '게시 주소 있음' : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {data?.nextCursor ? (
        <div className="flex justify-center">
          <Link href={buildPublishingHref({ ...filters, cursor: data.nextCursor })} className={ACTION}>다음 페이지</Link>
        </div>
      ) : null}
    </div>
  )
}
