'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'
import {
  ShieldCheck,
  TrendingUp,
  CalendarCheck,
  Bot,
  Layers,
  ArrowRight,
  Sparkles,
  DollarSign,
  FileCheck,
  ExternalLink,
} from 'lucide-react'
import type { Customer360Profile } from '@/features/admin/customer-360-canonical-service'

interface CanonicalCustomer360SummaryCardProps {
  profile: Customer360Profile
}

export function CanonicalCustomer360SummaryCard({ profile }: CanonicalCustomer360SummaryCardProps) {
  const { identity, metrics, recentMissions } = profile
  const isProduction = identity.isProduction

  return (
    <Card className="p-6 bg-card/90 border-border/80 shadow-md space-y-6">
      {/* 1. Authoritative Tenant Identity Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-extrabold tracking-tight text-foreground">
              {identity.displayName}
            </h2>
            <Badge
              variant={isProduction ? 'default' : 'outline'}
              className={
                isProduction
                  ? 'bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs px-2.5 py-0.5'
                  : 'text-state-warn border-state-warn/40 text-xs font-mono'
              }
            >
              {identity.badgeLabel}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              ({identity.workspaceId})
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            대표 계정: <span className="font-mono text-foreground">{identity.ownerEmail}</span> · 상태: <span className="text-state-ok font-bold">{identity.status}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {recentMissions.length > 0 && (
            <Button size="sm" variant="outline" asChild className="h-8 text-xs font-semibold gap-1">
              <Link href={`/admin/missions/${recentMissions[0].id}`}>
                <Sparkles className="size-3.5 text-primary" />
                최신 미션 트레이스 보기
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* 2. 6대 Commercial Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <DollarSign className="size-3.5 text-state-ok" /> 검증 매출
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.totalVerifiedRevenueKrw.toLocaleString()}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">원</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CalendarCheck className="size-3.5 text-primary" /> 확정 예약
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.reservationsCount}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">건</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Bot className="size-3.5 text-state-wait" /> 총 미션
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.missionsCount}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">개</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Layers className="size-3.5 text-state-wait" /> 생성 콘텐츠
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.contentsCount}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">건</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <FileCheck className="size-3.5 text-state-warn" /> 정밀 승인
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.approvalsCount}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">건</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-muted/30 border border-border/60 space-y-1">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <TrendingUp className="size-3.5 text-state-danger" /> 발행 영수증
          </span>
          <div className="text-lg font-bold font-mono text-foreground">
            {metrics.publishReceiptsCount}
            <span className="text-xs font-normal text-muted-foreground ml-0.5">건</span>
          </div>
        </div>
      </div>

      {/* 3. 최근 마케팅 미션 및 트레이스 직결 링크 */}
      {recentMissions.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Bot className="size-3.5 text-primary" /> 이 고객사의 마케팅 미션 및 트레이스 목록
            </h3>
            <span className="text-[11px] text-muted-foreground">
              최근 {recentMissions.length}개 미션 표시 중
            </span>
          </div>

          <div className="border rounded-2xl overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-[110px]">미션 ID</TableHead>
                  <TableHead>마케팅 목표</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">트레이스 탐색</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMissions.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {m.id}
                    </TableCell>
                    <TableCell className="text-xs font-medium max-w-sm truncate">
                      {m.goal}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {m.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" asChild className="h-7 text-xs font-semibold gap-1 text-primary hover:text-foreground">
                        <Link href={`/admin/missions/${m.id}`}>
                          Trace 타임라인 <ArrowRight className="size-3" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Card>
  )
}
