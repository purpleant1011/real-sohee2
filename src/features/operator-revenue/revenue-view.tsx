'use client'

import { creditActionLabel } from '@/components/admin-ui/labels'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { CreditCard, ExternalLink, Filter } from 'lucide-react'
import { EmptyNotice, LoadErrorNotice, MetricTile, PageHeader } from '@/components/admin-ui/data-state'
import type { RevenueResult } from './revenue-repository'

export type RevenueViewProps = Readonly<{
  data: RevenueResult | null
  error?: string | null
}>

export function RevenueView({ data, error }: RevenueViewProps) {
  const stats = data?.stats ?? null
  const ledger = useMemo(() => data?.ledger ?? [], [data?.ledger])

  const [selectedWorkspace, setSelectedWorkspace] = useState<string>('all')
  const [selectedKind, setSelectedKind] = useState<string>('all')

  const workspaces = useMemo(() => {
    const map = new Map<string, string>()
    if (data?.workspaces) {
      for (const ws of data.workspaces) {
        if (ws.name) map.set(ws.id, ws.name)
      }
    }
    for (const item of ledger) {
      if (!map.has(item.workspaceId)) {
        map.set(item.workspaceId, item.workspace)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [data, ledger])

  const filteredLedger = useMemo(() => {
    return ledger.filter((entry) => {
      if (selectedWorkspace !== 'all' && entry.workspaceId !== selectedWorkspace) {
        return false
      }
      if (selectedKind === 'consume' && entry.type !== 'consume') {
        return false
      }
      if (selectedKind === 'grant' && entry.type !== 'grant' && entry.type !== 'weekly_grant' && entry.type !== 'signup_bonus') {
        return false
      }
      if (selectedKind === 'other' && (entry.type === 'consume' || entry.type === 'grant' || entry.type === 'weekly_grant' || entry.type === 'signup_bonus')) {
        return false
      }
      return true
    })
  }, [ledger, selectedWorkspace, selectedKind])

  return (
    <div className="w-full space-y-7 transition-all">
      <PageHeader
        title="크레딧 원장"
        description="고객사별 크레딧 할당, 사용, 만료 내역을 최근 30일 기준으로 확인합니다. 정기 결제 및 구독 관리는 결제·구독 화면을 이용해 주세요."
        actions={
          <Link
            href="/admin/billing"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground shadow-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
          >
            <CreditCard className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>결제·구독 관리 바로가기</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        }
      />

      {error ? (
        <LoadErrorNotice what="크레딧 원장" retryHref="/admin/revenue" />
      ) : null}

      {/* 4대 주요 지표 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <MetricTile
          label="최근 30일 지급 크레딧"
          value={stats ? stats.totalScDistributed : null}
          hint="최근 30일간 고객사에 지급된 크레딧 합계"
          tone="good"
        />

        <MetricTile
          label="최근 30일 소모 크레딧"
          value={stats ? stats.totalScSettled : null}
          hint="최근 30일간 실제 서비스에 소모된 크레딧 합계"
          tone="default"
        />

        <MetricTile
          label="최근 30일 소모율"
          value={stats?.burnRatePercent !== null && stats?.burnRatePercent !== undefined ? `${stats.burnRatePercent.toFixed(1)}%` : null}
          hint={stats?.burnRatePercent !== null && stats?.burnRatePercent !== undefined
            ? `활성 고객사 ${stats.activeWorkspacesCount}개사 기준`
            : '지급 크레딧이 없어 소모율을 산출할 수 없어요'}
          tone="default"
        />

        <MetricTile
          label="정기 결제·구독 매출"
          value={null}
          hint="정기 결제 내역은 결제·구독 화면에서 확인하세요"
          href="/admin/billing"
        />
      </div>

      {/* 원장 거래 내역 테이블 */}
      <Card className="overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-bold text-foreground">
                크레딧 거래 원장 (최근 30일)
              </CardTitle>
              <CardDescription className="text-xs">
                고객사의 크레딧 충전, 지급, 기능 사용 차감 및 수기 조정 기록
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        {/* 필터 바 */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b bg-muted/10">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Filter className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="font-medium">필터:</span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="workspace-filter" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                고객사
              </label>
              <select
                id="workspace-filter"
                aria-label="고객사 필터"
                value={selectedWorkspace}
                onChange={(e) => setSelectedWorkspace(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs focus-visible:outline-2 focus-visible:outline-purple-600"
              >
                <option value="all">전체 고객사 ({workspaces.length}개사)</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="kind-filter" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                작업 유형
              </label>
              <select
                id="kind-filter"
                aria-label="작업 유형 필터"
                value={selectedKind}
                onChange={(e) => setSelectedKind(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-xs focus-visible:outline-2 focus-visible:outline-purple-600"
              >
                <option value="all">전체 보기</option>
                <option value="consume">차감만 보기 (에이전트 사용)</option>
                <option value="grant">지급·충전만 보기</option>
                <option value="other">조정 및 환불</option>
              </select>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            표시 내역 <span className="font-semibold text-foreground">{filteredLedger.length}</span>건
            {ledger.length !== filteredLedger.length && ` (전체 ${ledger.length}건)`}
          </div>
        </div>

        <CardContent className="p-0">
          {filteredLedger.length === 0 ? (
            <EmptyNotice
              title="조건에 맞는 크레딧 거래가 없어요"
              description={ledger.length === 0 ? "최근 30일 동안 발생한 크레딧 거래 내역이 없습니다." : "선택한 필터 조건에 해당하는 거래 내역이 없습니다."}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[100px]">참조번호</TableHead>
                    <TableHead>일시</TableHead>
                    <TableHead>고객사</TableHead>
                    <TableHead>구분</TableHead>
                    <TableHead>변동 크레딧</TableHead>
                    <TableHead>변동 사유</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLedger.map((t) => {
                    const isDeduction = !t.isPositive && (t.type === 'consume' || t.amount < 0)
                    const displayAmount = isDeduction
                      ? `-${Math.abs(t.amount).toLocaleString('ko-KR')} 크레딧`
                      : t.isPositive
                        ? `+${Math.abs(t.amount).toLocaleString('ko-KR')} 크레딧`
                        : `${t.amount.toLocaleString('ko-KR')} 크레딧`

                    return (
                      <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono text-xs font-semibold text-foreground">
                          {t.referenceId}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {t.timestamp}
                        </TableCell>
                        <TableCell className="text-xs font-medium text-foreground">
                          {t.workspace}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              t.isPositive
                                ? 'purple'
                                : isDeduction
                                  ? 'outline'
                                  : 'outline'
                            }
                            className={`text-[10px] font-semibold ${
                              isDeduction
                                ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                                : ''
                            }`}
                          >
                            {t.typeLabel}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={`font-mono text-xs font-bold ${
                            t.isPositive
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : isDeduction
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-foreground'
                          }`}
                        >
                          {displayAmount}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                          {creditActionLabel(t.action)}
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
    </div>
  )
}
