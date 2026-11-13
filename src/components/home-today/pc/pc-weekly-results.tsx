'use client'

import Link from 'next/link'
import { ArrowUpRight, BarChart3, CalendarCheck, FileCheck, DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MobileMetric, Remote } from '@/features/mobile-decision/contracts'

export interface PcWeeklyResultsProps {
  results: Remote<MobileMetric[]>
  onRefresh?: () => void
}

export function PcWeeklyResults({ results }: PcWeeklyResultsProps) {
  const metricList = Array.isArray(results.data) ? results.data : []

  const published = metricList.find((m) => m.id === 'published')
  const bookings = metricList.find((m) => m.id === 'bookings')
  const revenue = metricList.find((m) => m.id === 'revenue')

  const items = [
    {
      id: 'published',
      label: '게시 확인',
      metric: published,
      icon: FileCheck,
      tint: 'bg-primary/10 text-primary',
      formatValue: (val: number) => `${val.toLocaleString()}건`,
    },
    {
      id: 'bookings',
      label: '예약 확정',
      metric: bookings,
      icon: CalendarCheck,
      tint: 'bg-state-wait-soft text-state-wait',
      formatValue: (val: number) => `${val.toLocaleString()}건`,
    },
    {
      id: 'revenue',
      label: '확인된 매출',
      metric: revenue,
      icon: DollarSign,
      tint: 'bg-state-ok-soft text-state-ok',
      formatValue: (val: number) => `${val.toLocaleString()}원`,
    },
  ]

  return (
    <Card className="rounded-2xl border border-border/80 bg-card shadow-xs flex flex-col justify-between min-h-[440px]">
      <div>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            <CardTitle className="text-base font-semibold text-foreground">
              이번 주 성과
            </CardTitle>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            실시간 집계
          </span>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {items.map(({ id, label, metric, icon: Icon, tint, formatValue }) => {
            const hasConfirmedValue =
              results.state === 'ready' &&
              metric &&
              metric.datasetMode === 'ACTUAL' &&
              typeof metric.value === 'number' &&
              !Number.isNaN(metric.value)

            return (
              <div
                key={id}
                className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-4 transition-all hover:bg-muted/40 hover:border-border"
              >
                <div className="flex items-center gap-3.5">
                  <div className={`flex size-10 items-center justify-center rounded-xl shrink-0 ${tint}`}>
                    <Icon className="size-5" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {label}
                    </p>
                    <p className={`mt-0.5 tracking-tight ${hasConfirmedValue ? 'text-xl font-bold text-foreground' : 'text-xs text-muted-foreground'}`}>
                      {hasConfirmedValue
                        ? formatValue(metric.value!)
                        : '아직 확인되지 않았어요'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </CardContent>
      </div>

      <div className="border-t border-border/50 px-6 py-3.5 bg-muted/10 rounded-b-2xl">
        <Link
          href="/app/results"
          className="flex items-center justify-between text-xs font-semibold text-primary hover:text-primary/80 transition-colors group"
        >
          <span>성과 보고서 자세히 보기</span>
          <ArrowUpRight className="size-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </Link>
      </div>
    </Card>
  )
}
