'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { TrendingUp, FileText, MessageSquare, CalendarCheck } from 'lucide-react'
import type { HomeMetricsData } from './types'

export interface HomeMetricsWidgetProps {
  metrics: HomeMetricsData
  className?: string
}

export function HomeMetricsWidget({ metrics, className }: HomeMetricsWidgetProps) {
  const items = [
    {
      ...metrics.posts,
      icon: FileText,
      iconBg: 'bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400',
    },
    {
      ...metrics.inquiries,
      icon: MessageSquare,
      iconBg: 'bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400',
    },
    {
      ...metrics.reservations,
      icon: CalendarCheck,
      iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    },
  ]

  return (
    <section
      role="region"
      aria-label="성과 요약"
      className={`space-y-3 ${className ?? ''}`}
    >
      <div className="flex items-center gap-2 px-1">
        <TrendingUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base sm:text-lg font-bold text-foreground">
          성과 요약
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((item) => {
          const Icon = item.icon
          const hasValue = item.value !== null

          return (
            <Card key={item.key} className="border-border bg-card p-4 sm:p-5 flex flex-col justify-between gap-3">
              <CardHeader className="p-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {item.label}
                  </span>
                  <span className={`p-1.5 rounded-lg ${item.iconBg}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                </div>
              </CardHeader>

              <CardContent className="p-0 space-y-3">
                {hasValue ? (
                  <div>
                    <span className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
                      {item.value}
                    </span>
                    <span className="text-sm font-medium text-muted-foreground ml-1">건</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-muted-foreground">
                      {item.emptyLabel}
                    </p>
                    <p className="text-xs text-muted-foreground/80">
                      소희와 함께 첫 걸음을 떼어보세요
                    </p>
                  </div>
                )}

                <div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="w-full text-xs font-medium min-h-[36px]"
                  >
                    <Link href={item.actionHref}>
                      {item.actionLabel}
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
