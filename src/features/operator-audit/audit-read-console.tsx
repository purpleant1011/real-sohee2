'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { TruthBadge } from '@/components/common/truth-envelope'
import { LoadErrorNotice } from '@/components/admin-ui/data-state'
import { factKindLabel, auditResultLabel, auditActionLabel, formatKst, referenceCode } from '@/components/admin-ui/labels'

export interface AuditReadConsoleProps {
  items?: readonly any[]
  events?: readonly any[]
  filters?: {
    from?: string
    to?: string
    workspaceId?: string
    actorId?: string
    action?: string
    targetType?: string
    result?: 'succeeded' | 'failed' | 'denied'
    factKind?: 'observed' | 'user_claim' | 'inference' | 'unknown'
    cursor?: string
    limit?: number
  }
  detail?: any
  detailError?: string | null
  exportStatus?: any
  exportJob?: any
  error?: string | null
}

const FACT_KINDS: Array<{ key: 'observed' | 'user_claim' | 'inference' | 'unknown'; label: string }> = [
  { key: 'observed', label: '실제 관측' },
  { key: 'user_claim', label: '고객 진술' },
  { key: 'inference', label: '추론' },
  { key: 'unknown', label: '미확인' },
]

export function AuditReadConsole({
  items,
  events,
  filters,
  detail,
  detailError = null,
  exportStatus,
  exportJob,
  error = null,
}: AuditReadConsoleProps) {
  const displayItems = events || items || []

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">감사 기록</h1>
          <p className="text-xs text-muted-foreground mt-1">
            누가, 언제, 무엇을, 왜 변경하거나 실행했는지 추적합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-xs">내보내기 상태</Badge>
          <Badge variant="secondary" className="text-xs">감사 이벤트 수집 전</Badge>
          <Badge variant="outline" className="text-xs">변경 불가 기록</Badge>
        </div>
      </header>

      {/* List Load Error */}
      {error && (
        <LoadErrorNotice what="감사 기록" retryHref="/admin/audit" />
      )}

      {/* Detail Load Error */}
      {detailError && (
        <LoadErrorNotice what="선택한 감사 상세 내역" />
      )}

      {/* Filter Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="workspace-filter" className="text-xs font-semibold">고객사</label>
          <Input
            id="workspace-filter"
            aria-label="고객사"
            placeholder="고객사 검색..."
            defaultValue={filters?.workspaceId || ''}
            className="h-8 max-w-xs text-base md:text-xs"
          />
          <span className="text-xs text-muted-foreground">자료 없음</span>
        </div>
        <Button disabled variant="outline" size="sm" className="h-8 text-xs min-h-8">
          감사 보고서 만들기
        </Button>
      </div>

      {/* Fact Kind Filter Badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground font-medium">사실 유형 필터:</span>
        <Button
          variant={!filters?.factKind ? 'default' : 'outline'}
          size="sm"
          asChild
          className="h-7 text-xs px-2.5 min-h-7"
        >
          <Link href="/admin/audit">전체</Link>
        </Button>
        {FACT_KINDS.map((f) => {
          const isActive = filters?.factKind === f.key
          return (
            <Button
              key={f.key}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              asChild
              className="h-7 text-xs px-2.5 min-h-7"
            >
              <Link href={`/admin/audit?fact=${f.key}`}>
                {f.label}
              </Link>
            </Button>
          )
        })}
        {filters?.factKind && (
          <Badge variant="secondary" className="text-[11px] ml-2">
            선택된 필터: {factKindLabel(filters.factKind)}
          </Badge>
        )}
        {filters?.result && (
          <Badge variant="secondary" className="text-[11px]">
            결과 필터: {auditResultLabel(filters.result)}
          </Badge>
        )}
      </div>

      {/* Selected Event Detail Panel */}
      {detail && (
        <Card className="p-4 space-y-3 border-purple-500/30 bg-purple-50/20 dark:bg-purple-950/10">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">선택한 감사 이벤트 상세</h3>
            <Badge variant="outline" className="text-[10px]">
              참조번호: {referenceCode(detail.id)}
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">행위자: </span>
              <span className="font-semibold">{detail.actorUserId || detail.actorId || '시스템'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">작업: </span>
              <span className="font-semibold">{auditActionLabel(detail.action)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">결과: </span>
              <Badge variant={detail.result === 'succeeded' ? 'default' : 'destructive'} className="text-[10px]">
                {auditResultLabel(detail.result)}
              </Badge>
            </div>
            <div>
              <span className="text-muted-foreground">사실 유형: </span>
              <span className="font-semibold">{factKindLabel(detail.factKind)}</span>
            </div>
          </div>
          {detail.reason && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">사유: </span>
              {detail.reason}
            </p>
          )}
        </Card>
      )}

      {/* Audit Log Table */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold">운영 감사 로그</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>일시</TableHead>
                <TableHead>행위자</TableHead>
                <TableHead>액션</TableHead>
                <TableHead>고객사</TableHead>
                <TableHead>결과</TableHead>
                <TableHead className="text-right">사실 유형</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 감사 기록이 없습니다. 자료 없음
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item: any) => (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatKst(item.createdAt)}
                    </TableCell>
                    <TableCell className="font-semibold text-xs">{item.actorId || '시스템'}</TableCell>
                    <TableCell className="font-mono text-xs">{auditActionLabel(item.action)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.workspaceName || (item.workspaceId ? referenceCode(item.workspaceId) : '전역 운영')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.result === 'success' || item.result === 'succeeded' ? 'default' : 'destructive'}
                        className="text-[10px]"
                      >
                        {auditResultLabel(item.result)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <TruthBadge factKind="OBSERVED" status="LIVE" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Export Job Metadata */}
      {exportJob && (
        <Card className="p-4 space-y-1.5 text-xs border border-border/80">
          <h3 className="font-bold text-sm">내보내기 작업 메타데이터</h3>
          <div>고객사: {exportJob.workspaceName}</div>
          <div>행수: {exportJob.rowCount}</div>
          <div>필터 지문: {exportJob.fingerprintState}</div>
          <div>이벤트 체인: {exportJob.eventChainState}</div>
        </Card>
      )}
    </div>
  )
}

export default AuditReadConsole
