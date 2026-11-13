'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { formatRelativeKst } from '@/components/admin-ui/labels'
import { Laptop, RefreshCw, CheckCircle2, AlertTriangle, WifiOff } from 'lucide-react'

export type NaverConnectorItem = Readonly<{
  id?: string
  workspaceId: string
  workspaceName: string
  channel: string
  accountLabel: string | null
  connectionStatus: string
  lastHeartbeatAt?: string | null
  extensionVersion?: string | null
  updatedAt: string
}>

export type LocalConnectorHealth = 'connected' | 'reauth_required' | 'offline'

export function getLocalConnectorHealth(
  conn: Pick<NaverConnectorItem, 'connectionStatus' | 'lastHeartbeatAt'>,
  nowMs: number = Date.now(),
): LocalConnectorHealth {
  if (conn.connectionStatus === 'reverify_required' || conn.connectionStatus === 'expired') {
    return 'reauth_required'
  }
  if (!conn.lastHeartbeatAt) {
    return 'offline'
  }
  const heartbeatTime = new Date(conn.lastHeartbeatAt).getTime()
  if (Number.isNaN(heartbeatTime) || nowMs - heartbeatTime > 10 * 60 * 1000) {
    return 'offline'
  }
  if (conn.connectionStatus === 'connected') {
    return 'connected'
  }
  return 'offline'
}

export type NaverConnectorHealthPanelProps = Readonly<{
  connectors: readonly NaverConnectorItem[]
}>

export function NaverConnectorHealthPanel({ connectors = [] }: NaverConnectorHealthPanelProps) {
  const [syncingKey, setSyncingKey] = useState<string | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [now] = useState(() => Date.now())

  const counts = connectors.reduce(
    (acc, conn) => {
      const health = getLocalConnectorHealth(conn, now)
      acc[health] += 1
      return acc
    },
    { connected: 0, reauth_required: 0, offline: 0 },
  )

  const handleSyncCategories = async (conn: NaverConnectorItem) => {
    const key = conn.id ?? conn.workspaceId
    setSyncingKey(key)
    try {
      const res = await fetch('/api/admin/channels/naver-categories/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: conn.workspaceId,
          connectionId: conn.id,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.message || '카테고리 동기화에 실패했어요.')
      }
      setSyncFeedback((prev) => ({
        ...prev,
        [key]: { ok: true, message: `동기화 완료 (${json.count}개)` },
      }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '카테고리 동기화에 실패했어요.'
      setSyncFeedback((prev) => ({
        ...prev,
        [key]: { ok: false, message },
      }))
    } finally {
      setSyncingKey(null)
    }
  }

  return (
    <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
      <CardHeader className="border-b bg-muted/20 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Laptop className="size-4 text-state-ok" />
              <span>로컬 커넥터 관제 (Chrome 확장 프로그램)</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              네이버 블로그 발행을 위한 확장 프로그램의 헬스체크 및 카테고리 동기화 상태를 확인해요.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {/* 헬스체크 요약 타일 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-state-ok/30 bg-state-ok-soft p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-state-ok">
              <CheckCircle2 className="size-3.5 text-state-ok" />
              <span>연결됨</span>
            </div>
            <div className="mt-1 font-mono text-xl font-extrabold text-state-ok">
              {counts.connected.toLocaleString('ko-KR')}건
            </div>
          </div>

          <div className="rounded-xl border border-state-warn/30 bg-state-warn-soft p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-state-warn">
              <AlertTriangle className="size-3.5 text-state-warn" />
              <span>재인증 필요</span>
            </div>
            <div className="mt-1 font-mono text-xl font-extrabold text-state-warn">
              {counts.reauth_required.toLocaleString('ko-KR')}건
            </div>
          </div>

          <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <WifiOff className="size-3.5 text-muted-foreground" />
              <span>확장 오프라인</span>
            </div>
            <div className="mt-1 font-mono text-xl font-extrabold text-foreground">
              {counts.offline.toLocaleString('ko-KR')}건
            </div>
          </div>
        </div>

        {/* 커넥터 목록 테이블 */}
        {connectors.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>고객사</TableHead>
                  <TableHead>블로그 계정</TableHead>
                  <TableHead>커넥터 상태</TableHead>
                  <TableHead>확장 버전</TableHead>
                  <TableHead>최근 하트비트</TableHead>
                  <TableHead className="text-right">카테고리 관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connectors.map((conn) => {
                  const key = conn.id ?? `${conn.workspaceId}-${conn.accountLabel}`
                  const health = getLocalConnectorHealth(conn, now)
                  const feedback = syncFeedback[key]
                  const isSyncing = syncingKey === key

                  return (
                    <TableRow key={key} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-semibold">{conn.workspaceName}</TableCell>
                      <TableCell className="text-xs">{conn.accountLabel || '-'}</TableCell>
                      <TableCell>
                        {health === 'connected' ? (
                          <Badge className="gap-1 border-state-ok/40 bg-state-ok-soft text-[10px] font-bold text-state-ok">
                            <CheckCircle2 className="size-3 text-state-ok" />
                            연결됨
                          </Badge>
                        ) : health === 'reauth_required' ? (
                          <Badge variant="warning" className="gap-1 text-[10px] font-bold">
                            <AlertTriangle className="size-3" />
                            재인증 필요
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                            <WifiOff className="size-3 text-muted-foreground" />
                            확장 오프라인
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {conn.extensionVersion ? `v${conn.extensionVersion}` : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {conn.lastHeartbeatAt ? formatRelativeKst(conn.lastHeartbeatAt) : '기록 없음'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {feedback ? (
                            <span
                              className={`text-[11px] font-semibold ${
                                feedback.ok
                                  ? 'text-state-ok'
                                  : 'text-destructive'
                              }`}
                            >
                              {feedback.message}
                            </span>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSyncing}
                            onClick={() => handleSyncCategories(conn)}
                            className="h-8 gap-1.5 text-xs cursor-pointer"
                          >
                            <RefreshCw className={`size-3 ${isSyncing ? 'animate-spin' : ''}`} />
                            <span>{isSyncing ? '동기화 중...' : '카테고리 동기화'}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/80 p-6 text-center">
            <p className="text-xs text-muted-foreground">
              연결된 네이버 블로그 확장 프로그램이 아직 없어요. 고객사가 확장 프로그램을 연동하면 여기에 표시돼요.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
