import Link from 'next/link'
import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorChannelConnections } from '../../../features/operator-channels/repository'
import {
  connectionDetailLabel, connectionsNeedingAction, summarizeChannelConnections,
} from '../../../features/operator-channels/channel-connection-summary'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import { channelLabel, formatKst } from '@/components/admin-ui/labels'
import { OrphanReconcilePanel } from '@/components/admin/orphan-reconcile-panel'
import { NaverConnectorHealthPanel } from '@/components/admin/naver-connector-health-panel'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ACTION = 'inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

export default async function OperatorChannelsPage() {
  await requireOperatorAnyScope('channel.read')
  const { data, error } = await listOperatorChannelConnections({ limit: 100 })
  const connections = data ?? null
  const rows = connections ? summarizeChannelConnections(connections) : []
  const attention = connections ? connectionsNeedingAction(connections) : []
  const naverConnectors = connections ? connections.filter((c) => c.channel === 'naver_blog') : []
  const totals = rows.reduce(
    (acc, r) => ({ connected: acc.connected + r.connected, reconnect: acc.reconnect + r.reconnect, released: acc.released + r.released }),
    { connected: 0, reconnect: 0, released: 0 },
  )
  const maybeTruncated = (connections?.length ?? 0) >= 100

  return (
    <div className="w-full space-y-7">
      <PageHeader
        title="채널 연결 현황"
        description="고객사가 연결한 채널의 상태를 확인해요."
        actions={<Link href="/admin/reconcile" className={ACTION}>외부 대사 열기</Link>}
      />

      {error ? <LoadErrorNotice what="채널 연결 현황" retryHref="/admin/channels" /> : null}

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <MetricTile label="연결됨" value={connections ? totals.connected : null} tone="good" hint="정상 연결된 채널 수" />
        <MetricTile label="재연결 필요" value={connections ? totals.reconnect : null} tone={totals.reconnect > 0 ? 'warn' : 'default'} hint="인증 만료·권한 부족·오류" />
        <MetricTile label="연결 해제됨" value={connections ? totals.released : null} hint="고객사가 해제한 연결" />
        <MetricTile label="연결 기록 합계" value={connections ? connections.length : null} hint={maybeTruncated ? '최대 100건까지만 표시돼요' : '고객사·채널 조합 기준'} />
      </div>

      <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
        <CardHeader className="border-b bg-muted/20 p-4">
          <CardTitle className="text-sm font-bold">채널별 연결 수</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? null : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>채널</TableHead>
                    <TableHead className="text-right">연결됨</TableHead>
                    <TableHead className="text-right">재연결 필요</TableHead>
                    <TableHead className="text-right">연결 해제됨</TableHead>
                    <TableHead className="text-right">연결 중</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.channel} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-semibold text-foreground">{channelLabel(r.channel)}</TableCell>
                      <TableCell className="text-right text-xs">{r.connected.toLocaleString('ko-KR')}</TableCell>
                      <TableCell className="text-right text-xs">{r.reconnect > 0 ? <Badge variant="warning" className="text-[11px]">{r.reconnect.toLocaleString('ko-KR')}</Badge> : '0'}</TableCell>
                      <TableCell className="text-right text-xs">{r.released.toLocaleString('ko-KR')}</TableCell>
                      <TableCell className="text-right text-xs">{r.connecting.toLocaleString('ko-KR')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <NaverConnectorHealthPanel connectors={naverConnectors} />

      {connections && attention.length > 0 ? (
        <Card className="overflow-hidden border border-state-warn/40 p-0 shadow-xs">
          <CardHeader className="border-b bg-state-warn/10 p-4">
            <CardTitle className="text-sm font-bold text-state-warn">재연결이 필요한 연결 ({attention.length.toLocaleString('ko-KR')}건)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>고객사</TableHead>
                    <TableHead>채널</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead className="text-right">마지막 갱신</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attention.map((c) => (
                    <TableRow key={`${c.workspaceId}-${c.channel}`}>
                      <TableCell className="text-xs font-semibold">{c.workspaceName}</TableCell>
                      <TableCell className="text-xs">{channelLabel(c.channel)}</TableCell>
                      <TableCell><Badge variant="warning" className="text-[11px]">{connectionDetailLabel(c.connectionStatus)}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatKst(c.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : connections && connections.length === 0 ? (
        <Card className="border border-border/80 shadow-xs"><EmptyNotice title="연결된 채널이 아직 없어요" description="고객사가 채널을 연결하면 여기에 표시돼요." /></Card>
      ) : null}

      <OrphanReconcilePanel />
    </div>
  )
}
