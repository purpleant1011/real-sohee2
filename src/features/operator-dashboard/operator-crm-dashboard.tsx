'use client'

import React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import { TruthBadge } from '@/components/common/truth-envelope'

export interface OperatorCrmDashboardProps {
  overview?: any
  items?: Array<{
    id: string
    workspaceName: string
    channel: string
    status: string
    lastActivity: string
  }>
  error?: string | null
}

export function OperatorCrmDashboard({ overview, items = [], error = null }: OperatorCrmDashboardProps) {
  const displayItems = overview?.items || items
  const summary = overview?.summary
  const urgentCount = summary?.critical ?? displayItems.filter((i: any) => i.severity === 'critical').length

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">운영 현황</h1>
          <p className="text-xs text-muted-foreground mt-1">자료 상태 및 고객사 운영 현황을 점검합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">자료 상태</Badge>
          <Badge variant="secondary" className="text-xs">실운영 정합</Badge>
        </div>
      </header>

      {/* 긴급 알림 배너 (실제 이슈가 있을 때만 노출) */}
      {urgentCount > 0 ? (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-800 dark:text-amber-300">
          즉시 확인이 필요한 운영 이슈가 {urgentCount}건 있습니다.
        </div>
      ) : null}

      {/* 핵심 지표 & 즉시 확인 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs font-semibold text-muted-foreground">핵심 지표</span>
          <div className="text-2xl font-bold mt-1">1</div>
          <span className="text-[11px] text-muted-foreground">즉시 확인 대상 (운영 위험)</span>
        </Card>
        <Card className="p-4">
          <span className="text-xs font-semibold text-muted-foreground">활성 고객사</span>
          <div className="text-2xl font-bold mt-1">{summary?.activeCount !== undefined ? summary.activeCount : 0}</div>
        </Card>
        <Card className="p-4">
          <span className="text-xs font-semibold text-muted-foreground">승인 대기</span>
          <div className="text-2xl font-bold mt-1">{summary?.pendingApprovalCount !== undefined ? summary.pendingApprovalCount : 0}</div>
        </Card>
        <Card className="p-4">
          <span className="text-xs font-semibold text-muted-foreground">크레딧 위험</span>
          <div className="text-2xl font-bold mt-1">{summary?.creditRiskCount !== undefined ? summary.creditRiskCount : 0}</div>
        </Card>
      </div>

      {/* 4대 운영 진단 섹션 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">게시 성공률과 API 비용</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">이번 달 전체 게시 성공률</span>
              <span className="font-mono text-emerald-600 font-bold">정상</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">AI 인퍼런스 총 지출</span>
              <span className="font-mono text-foreground">집계 중</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">우선 처리 업무</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b">
              <span>계약 검토 대기</span>
              <span className="text-amber-600 font-medium">검토 대기</span>
            </div>
            <div className="flex justify-between py-1">
              <span>동의서 갱신 요청</span>
              <span className="text-muted-foreground">확인 전</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">가입 진행 현황</h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b">
              <span>온보딩 진행 중</span>
              <span className="font-mono text-purple-600 font-bold">진행 중</span>
            </div>
            <div className="flex justify-between py-1">
              <span>채널 연동 대기</span>
              <span className="font-mono text-foreground">확인 전</span>
            </div>
          </div>
        </Card>

        <Card className="p-5 space-y-3 border-border/80 shadow-xs">
          <h2 className="text-sm font-bold text-foreground">최근 운영 이벤트</h2>
          <div className="space-y-2 text-xs">
            {displayItems.length === 0 ? (
              <span className="text-muted-foreground">최근 이벤트 없음</span>
            ) : (
              displayItems.slice(0, 3).map((item: any) => (
                <div key={item.id} className="flex justify-between py-1 border-b">
                  <span className="font-medium">{item.workspace_name || item.workspaceName}</span>
                  <span className="text-muted-foreground">{item.title}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Main CRM Items Table */}
      <Card className="p-0 overflow-hidden shadow-xs border border-border/80">
        <CardHeader className="p-4 bg-muted/20 border-b">
          <CardTitle className="text-sm font-bold">에이전트 CRM 및 대화형 상담 현황</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>고객사명</TableHead>
                <TableHead>상담 / 위험 상태</TableHead>
                <TableHead>세부 내용</TableHead>
                <TableHead className="text-right">데이터 진실</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-xs">
                    표시할 CRM 상담 자료가 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                displayItems.map((item: any) => (
                  <TableRow key={item.id} className="hover:bg-muted/30">
                    <TableCell className="font-semibold text-xs">{item.workspace_name || item.workspaceName}</TableCell>
                    <TableCell>
                      <Badge variant={item.severity === 'critical' || item.severity === 'high' ? 'destructive' : 'outline'} className="text-[10px]">
                        {item.title || item.status || item.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {item.detail || '-'}
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
    </div>
  )
}

export default OperatorCrmDashboard
