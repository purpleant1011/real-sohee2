import Link from 'next/link'
import { requireOperator } from '../../../features/operator-auth/require-operator'
import { formatBuildLabel, getBuildMeta } from '../../../features/admin/build-meta/build-meta'
import {
  getOperatorSystemObservations,
  getNaverPostQueueSummary,
  listNaverPostDlqItems,
} from '../../../features/operator-system/repository'
import { listOperatorIncidents } from '../../../features/operator-incidents/repository'
import {
  buildNaverQueueTiles,
  buildQueueTiles,
  deriveOverallHealth,
  freshnessLabel,
  incidentStatusLabel,
  severityLabel,
  systemSourceLabel,
  systemStateLabel,
  verificationLabel,
} from '../../../features/operator-system/system-summary'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { EmptyNotice, LoadErrorNotice, MfaRequiredNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { formatKst } from '@/components/admin-ui/labels'
import { NaverPostDlqTable } from '@/components/admin/naver-post-dlq-table'

export const dynamic = 'force-dynamic'

const ACTION = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export default async function OperatorSystemPage() {
  await requireOperator('system.read')
  const [observationsRes, incidentsRes, naverQueueRes, naverDlqRes] = await Promise.allSettled([
    getOperatorSystemObservations(),
    listOperatorIncidents(),
    getNaverPostQueueSummary(),
    listNaverPostDlqItems(),
  ])

  const observationData = observationsRes.status === 'fulfilled' ? observationsRes.value.data : null
  const incidentData = incidentsRes.status === 'fulfilled' ? incidentsRes.value.data : null
  const naverQueueData = naverQueueRes.status === 'fulfilled' ? naverQueueRes.value.data : null
  const naverDlqData = naverDlqRes.status === 'fulfilled' ? naverDlqRes.value.data : null
  const naverDlqItems = naverDlqData ?? []

  const observationsFailed = !observationData
  const incidentsFailed = !incidentData
  const observationsMfaRequired = observationsRes.status === 'fulfilled' && observationsRes.value.error === 'MFA_REQUIRED'
  const incidentsMfaRequired = incidentsRes.status === 'fulfilled' && incidentsRes.value.error === 'MFA_REQUIRED'

  const observations = observationData?.items ?? []
  const incidents = incidentData?.items ?? []
  const activeIncidents = incidents.filter((i) => i.status !== 'resolved')
  const queueTiles = buildQueueTiles(observationData?.queue ?? null)
  const naverQueueTiles = buildNaverQueueTiles(naverQueueData)
  const release = observationData?.release ?? null
  const health = deriveOverallHealth({
    observations: observationsFailed ? null : observations,
    activeIncidentCount: incidentsFailed ? null : activeIncidents.length,
    naverReconcileNeededCount: naverQueueData?.creditReconcileNeededCount ?? null,
  })
  const healthValue = health === 'healthy' ? '정상' : health === 'attention' ? '주의 필요' : null
  const build = formatBuildLabel(getBuildMeta())

  return (
    <div className="w-full space-y-7">
      <PageHeader
        title="시스템 상태"
        description="서비스 상태, 작업 큐, 배포 정보와 열려 있는 장애를 확인해요."
        actions={<Link href="/admin/interventions" className={ACTION}>긴급 개입 열기</Link>}
      />

      {observationsMfaRequired || incidentsMfaRequired ? <MfaRequiredNotice /> : null}
      {observationsFailed && !observationsMfaRequired ? <LoadErrorNotice what="시스템 상태" retryHref="/admin/system" /> : null}
      {incidentsFailed && !incidentsMfaRequired ? <LoadErrorNotice what="장애 목록" retryHref="/admin/system" /> : null}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        <MetricTile
          label="종합 상태"
          value={healthValue}
          tone={health === 'healthy' ? 'good' : health === 'attention' ? 'warn' : 'default'}
          hint={health === 'unknown' && !observationsFailed ? '아직 관측된 값이 없어요' : '최근 24시간 관측 기준'}
        />
        <MetricTile
          label="열려 있는 장애"
          value={incidentsFailed ? null : activeIncidents.length}
          tone={!incidentsFailed && activeIncidents.length > 0 ? 'bad' : 'default'}
          hint={incidentsFailed ? undefined : activeIncidents.length === 0 ? '해결되지 않은 장애가 없어요' : '조치가 필요해요'}
        />
        <MetricTile
          label="배포 정보"
          value={release?.versionCode ?? build}
          hint={release ? `검증: ${verificationLabel(release.verificationState)}` : '이 화면을 만든 빌드 기준'}
          footer={release?.commitShaPrefix ? <div className="text-[11px] text-muted-foreground">변경 번호 {release.commitShaPrefix}{release.deployedAt ? ` · 배포 ${formatKst(release.deployedAt)}` : ''}</div> : undefined}
        />
      </div>

      <section aria-labelledby="queue-heading" className="space-y-3">
        <h2 id="queue-heading" className="text-sm font-bold text-foreground">작업 큐</h2>
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {queueTiles.map((t) => (
            <MetricTile key={t.kind} label={t.label} value={t.value} tone={t.tone} hint={t.hint} />
          ))}
        </div>
      </section>

      <section aria-labelledby="naver-queue-heading" className="space-y-3">
        <h2 id="naver-queue-heading" className="text-sm font-bold text-foreground">네이버 블로그 발행 큐</h2>
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {naverQueueTiles.map((t) => (
            <MetricTile key={t.kind} label={t.label} value={t.value} tone={t.tone} hint={t.hint} />
          ))}
        </div>
      </section>

      <NaverPostDlqTable initialItems={naverDlqItems} />

      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <CardTitle className="text-sm font-bold">서비스별 관측 상태</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {observationsFailed ? null : observations.length === 0 ? (
            <EmptyNotice title="관측된 항목이 아직 없어요" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>항목</TableHead>
                    <TableHead>관측 시각</TableHead>
                    <TableHead>최신성</TableHead>
                    <TableHead className="text-right">상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {observations.map((o) => (
                    <TableRow key={o.source} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-semibold text-foreground">{systemSourceLabel(o.source)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatKst(o.observedAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{freshnessLabel(o.freshness)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={o.state === 'healthy' ? 'success' : o.state === 'degraded' ? 'warning' : o.state === 'error' ? 'destructive' : 'outline'} className="text-[11px] font-semibold">
                          {systemStateLabel(o.state)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <CardTitle className="text-sm font-bold">열려 있는 장애</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {incidentsFailed ? null : activeIncidents.length === 0 ? (
            <EmptyNotice title="열려 있는 장애가 없어요" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>심각도</TableHead>
                    <TableHead>처리 상태</TableHead>
                    <TableHead className="text-right">발생 시각</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeIncidents.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="text-xs font-semibold text-foreground">{i.title}</TableCell>
                      <TableCell><Badge variant={i.severity === 'critical' || i.severity === 'high' ? 'destructive' : 'warning'} className="text-[11px]">{severityLabel(i.severity)}</Badge></TableCell>
                      <TableCell className="text-xs">{incidentStatusLabel(i.status)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatKst(i.openedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
