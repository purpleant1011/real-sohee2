'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { channelLabel, referenceCode } from '@/components/admin-ui/labels'
import { RefreshCw, ShieldAlert, CheckCircle2, AlertTriangle, Play, Database } from 'lucide-react'

interface ReconcileResultItem {
  verificationRunId: string
  workspaceId: string
  channel: string
  actionRequestId: string | null
  disposition: 'RECONCILED' | 'DATA_INTEGRITY_ERROR'
  reason: string
}

interface ReconcileSummary {
  totalOrphansFound: number
  reconciledCount: number
  integrityIncidentCount: number
  items: ReconcileResultItem[]
}

export function OrphanReconcilePanel() {
  const [isRunning, setIsRunning] = useState(false)
  const [lastReport, setLastReport] = useState<ReconcileSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleRunReconcile = async () => {
    setIsRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/channels/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || '보정 작업 중 오류가 발생했습니다.')
      }
      setLastReport(json.report)
    } catch (err: any) {
      setError(err?.message || '알 수 없는 오류가 발생했습니다.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Card className="p-0 overflow-hidden shadow-xs border border-primary/80 bg-card">
      <CardHeader className="p-4 bg-primary/10 border-b border-primary/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-primary">
            <Database className="size-4 text-primary" />
            <span>고아 검증 보정 엔진</span>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            과거 검증 내역 중 발행 요청 기록과 매핑되지 않은 고아 항목을 읽기 전용 대사(GET 전용)로 무결성 보정합니다.
          </p>
        </div>

        <Button
          onClick={handleRunReconcile}
          disabled={isRunning}
          className="min-h-11 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
          size="sm"
        >
          {isRunning ? (
            <>
              <RefreshCw className="size-3.5 animate-spin" />
              <span>무결성 보정 실행 중...</span>
            </>
          ) : (
            <>
              <Play className="size-3.5 fill-current" />
              <span>고아 검증 보정 실행</span>
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {lastReport ? (
          <div className="space-y-4 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-muted/40 border border-border/80">
                <div className="text-[11px] font-bold text-muted-foreground">탐지된 고아 레코드</div>
                <div className="text-xl font-extrabold font-mono text-foreground mt-0.5">
                  {lastReport.totalOrphansFound}건
                </div>
              </div>
              <div className="p-3 rounded-xl bg-state-ok-soft border border-state-ok/30">
                <div className="text-[11px] font-bold text-state-ok">보정 완료</div>
                <div className="text-xl font-extrabold font-mono text-state-ok mt-0.5">
                  {lastReport.reconciledCount}건
                </div>
              </div>
              <div className="p-3 rounded-xl bg-state-warn-soft border border-state-warn/30">
                <div className="text-[11px] font-bold text-state-warn">무결성 이상</div>
                <div className="text-xl font-extrabold font-mono text-state-warn mt-0.5">
                  {lastReport.integrityIncidentCount}건
                </div>
              </div>
            </div>

            {lastReport.items.length > 0 ? (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="text-xs font-bold">검증 참조번호</TableHead>
                      <TableHead className="text-xs font-bold">채널</TableHead>
                      <TableHead className="text-xs font-bold">처리 결과</TableHead>
                      <TableHead className="text-xs font-bold">보정 내역 / 사유</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lastReport.items.map((item) => (
                      <TableRow key={item.verificationRunId} className="text-xs">
                        <TableCell className="font-mono text-[11px]">
                          {referenceCode(item.verificationRunId)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {channelLabel(item.channel)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.disposition === 'RECONCILED' ? (
                            <Badge className="bg-state-ok-soft text-state-ok border-state-ok/40 text-[10px] gap-1 font-bold">
                              <CheckCircle2 className="size-3" />
                              보정 완료
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px] gap-1 font-bold">
                              <AlertTriangle className="size-3" />
                              무결성 이상
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{item.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-muted/20 text-center text-xs text-muted-foreground">
                발견된 고아 검증 레코드가 없습니다. 모든 검증 내역이 발행 기록과 일치합니다.
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 rounded-xl border border-dashed border-border/80 text-center space-y-2">
            <ShieldAlert className="size-6 text-muted-foreground mx-auto" />
            <p className="text-xs font-medium text-muted-foreground">
              상단의 <strong>[고아 검증 보정 실행]</strong> 버튼을 누르면 채널 공식 API 조회를 통해 불일치 데이터를 즉시 스캔 및 보정합니다.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
