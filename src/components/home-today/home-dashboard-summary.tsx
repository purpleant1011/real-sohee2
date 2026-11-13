'use client'

import React from 'react'
import Link from 'next/link'
import { Sparkles, CheckCircle2, Calendar, ArrowRight, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DashboardMetricsResult } from '@/features/home/home-dashboard-summary'
import { formatConversionText, formatRevenueText } from '@/features/home/home-dashboard-summary'

export function HomeDashboardMetricsCards({
  metrics,
  className,
}: {
  metrics: DashboardMetricsResult
  className?: string
}) {
  const cards = [
    {
      ...metrics.activeTasks,
      icon: Sparkles,
      iconClass: 'text-purple-600 dark:text-purple-400',
    },
    {
      ...metrics.published,
      icon: CheckCircle2,
      iconClass: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      ...metrics.confirmedBookings,
      icon: Calendar,
      iconClass: 'text-blue-600 dark:text-blue-400',
    },
  ]

  return (
    <div className={cn('grid grid-cols-3 gap-2 sm:gap-3', className)}>
      {cards.map((card, idx) => {
        const Icon = card.icon
        return (
          <Card
            key={idx}
            className="border-border/70 bg-card rounded-xl sm:rounded-2xl shadow-xs overflow-hidden transition-all duration-150 hover:border-primary/30"
          >
            <CardContent className="p-3 sm:p-4 flex flex-col justify-between h-full">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                <span className="truncate">{card.label}</span>
                <Icon className={cn('size-3.5 sm:size-4 shrink-0 ml-1', card.iconClass)} aria-hidden="true" />
              </div>

              <div className="my-2 sm:my-2.5">
                {card.hasError ? (
                  <span className="text-xs sm:text-sm text-destructive font-medium">확인 불가</span>
                ) : card.value !== null ? (
                  <div className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight text-foreground font-mono tabular-nums">
                    {card.value}
                    {card.unit && <span className="text-xs sm:text-sm font-normal text-muted-foreground ml-0.5">{card.unit}</span>}
                  </div>
                ) : (
                  <span className="text-xs sm:text-sm text-muted-foreground">아직 확인할 수 없어요</span>
                )}
              </div>

              <p className="text-[10px] sm:text-xs text-muted-foreground line-clamp-1">
                {card.subtext}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function HomeVerifiedResultsSection({
  inquiryCount,
  bookedCount,
  channelsConnected,
  hasPaymentConnected = false,
  verifiedRevenueKrw,
  className,
}: {
  inquiryCount: number | null
  bookedCount: number | null
  channelsConnected?: boolean | null
  hasPaymentConnected?: boolean
  verifiedRevenueKrw?: number | null
  className?: string
}) {
  const conversionText = formatConversionText(inquiryCount, bookedCount)
  const revenueText = formatRevenueText({ hasPaymentConnected, verifiedRevenueKrw })

  const isChannelOk = channelsConnected === true
  const channelStatusText = isChannelOk
    ? '인스타그램 · 스레드 정상 연동 상태'
    : channelsConnected === false
    ? 'SNS 채널 연결이 필요해요'
    : '채널 연동 상태 확인 중'

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4', className)}>
      {/* 1. 소희의 업무 노트 */}
      <Card className="border-border/70 bg-card rounded-xl sm:rounded-2xl shadow-xs p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="size-4 text-primary" aria-hidden="true" />
            소희의 업무 노트
          </h3>
          <Link
            href="/app/content"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            전체 보기
            <ExternalLink className="size-3" aria-hidden="true" />
          </Link>
        </div>

        <div className="space-y-3">
          <div className="flex items-start gap-2.5 text-xs">
            <span className="text-[11px] text-muted-foreground/80 font-mono mt-0.5 min-w-[36px]">최근</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">게시물 공개 상태 및 채널 연동 확인</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{channelStatusText}</p>
            </div>
            {isChannelOk ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 shrink-0">
                연결 정상
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 shrink-0">
                확인 필요
              </Badge>
            )}
          </div>

          <div className="flex items-start gap-2.5 text-xs pt-2 border-t border-border/40">
            <span className="text-[11px] text-muted-foreground/80 font-mono mt-0.5 min-w-[36px]">정기</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">매장 지식 기반 피드백 및 답변 준비</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">사장님의 승인 규칙 안에서 안전하게 대기 중</p>
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">대기 중</span>
          </div>
        </div>
      </Card>

      {/* 2. 확인된 결과 (근거 기반 실적) */}
      <Card className="border-border/70 bg-card rounded-xl sm:rounded-2xl shadow-xs p-4 sm:p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              확인된 성과 결과
            </h3>
            <Link
              href="/app/customers"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              성과 보기
              <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-muted-foreground">고객 문의 → 예약 확정</span>
              <strong className="font-semibold text-foreground font-mono tabular-nums">{conversionText}</strong>
            </div>

            <div className="flex items-center justify-between text-xs sm:text-sm pt-2 border-t border-border/40">
              <span className="text-muted-foreground">확인된 매출</span>
              {hasPaymentConnected && verifiedRevenueKrw ? (
                <strong className="font-semibold text-foreground font-mono tabular-nums">{revenueText}</strong>
              ) : (
                <span className="text-xs font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-md">
                  결제 내역 연결 필요
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground/80 mt-4 pt-2.5 border-t border-border/40">
          * 예상 효과는 실제 성과와 명확히 구분해서 보여드려요.
        </div>
      </Card>
    </div>
  )
}
