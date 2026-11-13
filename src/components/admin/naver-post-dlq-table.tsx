'use client'

import { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { EmptyNotice } from '@/components/admin-ui/data-state'
import { formatKst, referenceCode } from '@/components/admin-ui/labels'
import type { NaverPostJobDlqItem } from '@/features/operator-system/schemas'
import { RefreshCw, RotateCcw } from 'lucide-react'

interface NaverPostDlqTableProps {
  initialItems: readonly NaverPostJobDlqItem[]
}

export function NaverPostDlqTable({ initialItems }: NaverPostDlqTableProps) {
  const [items, setItems] = useState<readonly NaverPostJobDlqItem[]>(initialItems)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [isGlobalRunning, setIsGlobalRunning] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleRefund = async (jobId: string) => {
    setProcessingId(jobId)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/system/naver-jobs/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || '환불 대사 처리에 실패했습니다.')
      }

      setItems((prev) => prev.filter((item) => item.id !== jobId))
      setMessage({ type: 'success', text: '크레딧 환불 대사가 완료되었습니다.' })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setMessage({ type: 'error', text: errMsg })
    } finally {
      setProcessingId(null)
    }
  }

  const handleGlobalSweep = async () => {
    setIsGlobalRunning(true)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/system/naver-jobs/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error || '일괄 대사 처리에 실패했습니다.')
      }

      const released = json.summary?.released ?? 0
      setMessage({
        type: 'success',
        text: `전체 대사 처리가 완료되었습니다. (환불 처리: ${released}건)`,
      })
      setItems([])
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setMessage({ type: 'error', text: errMsg })
    } finally {
      setIsGlobalRunning(false)
    }
  }

  const renderStatus = (status: string) => {
    if (status === 'failed') {
      return <Badge variant="destructive" className="text-[11px] font-semibold">발행 실패</Badge>
    }
    if (status === 'running') {
      return <Badge variant="warning" className="text-[11px] font-semibold">진행 중</Badge>
    }
    return <Badge variant="outline" className="text-[11px] font-semibold">대기</Badge>
  }

  return (
    <Card className="overflow-hidden border border-border/80 p-0 shadow-xs">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b bg-muted/20 p-4">
        <div>
          <CardTitle className="text-sm font-bold text-foreground">
            크레딧 환불 대기열 (DLQ)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            발행 실패 또는 지연 후 크레딧 반환 대사가 대기 중인 네이버 작업 목록이에요.
          </p>
        </div>

        {items.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleGlobalSweep}
            disabled={isGlobalRunning || processingId !== null}
            className="text-xs gap-1.5 shrink-0"
          >
            {isGlobalRunning ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <RotateCcw className="size-3.5" />
            )}
            <span>전체 환불 대사 실행</span>
          </Button>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {message && (
          <div
            className={`p-3 text-xs font-medium border-b ${
              message.type === 'success'
                ? 'bg-state-ok-soft text-state-ok border-state-ok/30'
                : 'bg-state-danger-soft text-state-danger border-state-danger/30'
            }`}
          >
            {message.text}
          </div>
        )}

        {items.length === 0 ? (
          <EmptyNotice
            title="크레딧 환불 대기 중인 작업이 없어요"
            description="모든 네이버 포스트 실패 건의 크레딧이 정상 반환되었거나 대사 완료된 상태입니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>작업 참조번호</TableHead>
                  <TableHead>사업장</TableHead>
                  <TableHead>요청 참조번호</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>최근 시각</TableHead>
                  <TableHead className="text-right">수동 조치</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const isProcessing = processingId === item.id
                  return (
                    <TableRow key={item.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold text-foreground">
                        {referenceCode(item.id)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {referenceCode(item.workspaceId)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {referenceCode(item.requestKey)}
                      </TableCell>
                      <TableCell>{renderStatus(item.status)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatKst(item.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={isProcessing || isGlobalRunning}
                          onClick={() => handleRefund(item.id)}
                          className="h-8 text-xs font-semibold px-2.5"
                        >
                          {isProcessing ? (
                            <>
                              <RefreshCw className="size-3 animate-spin mr-1" />
                              <span>환불 처리 중</span>
                            </>
                          ) : (
                            <span>수동 환불</span>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
