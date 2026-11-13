'use client'

import Link from 'next/link'
import { Clock3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/mobile-ui'
import type { MobileActivity, Remote } from '@/features/mobile-decision/contracts'
import {
  formatActivityTitle,
  getActivityHref,
  resolveActivityStatusKind,
} from '@/features/mobile-today/today-activity-card'

export interface PcActivityListProps {
  activity: Remote<MobileActivity[]>
  onRefresh?: () => void
}

export function PcActivityList({ activity, onRefresh }: PcActivityListProps) {
  const items = (activity.data ?? []).slice(0, 5)

  return (
    <Card className="rounded-2xl border border-border/80 bg-card shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold text-foreground">
          소희가 한 일
        </CardTitle>
        <Link
          href="/app/content"
          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          기록 전체 보기
        </Link>
      </CardHeader>

      <CardContent className="space-y-2 pt-0">
        {activity.state === 'loading' && (
          <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 p-4 text-center">
            <p className="text-sm text-muted-foreground">업무 기록을 확인하고 있어요</p>
          </div>
        )}

        {activity.state === 'error' && (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 p-4 text-center">
            <p className="text-sm font-medium text-foreground">업무 기록을 불러오지 못했어요</p>
            <p className="text-xs text-muted-foreground">잠시 후 다시 확인해 주세요.</p>
            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh} className="mt-1">
                다시 확인하기
              </Button>
            )}
          </div>
        )}

        {activity.state === 'ready' && items.length === 0 && (
          <div className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 p-4 text-center">
            <Clock3 className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">아직 최근 작업 기록이 없어요</p>
            <p className="text-xs text-muted-foreground">첫 소식을 맡기면 여기에 기록돼요.</p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-border/50">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={getActivityHref(item)}
                  className="group flex items-center justify-between gap-3 py-2.5 px-2 rounded-lg transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Clock3 className="size-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                      {formatActivityTitle(item.title)}
                    </span>
                  </div>
                  <div className="shrink-0">
                    <StatusPill
                      kind={resolveActivityStatusKind(item.statusLabel)}
                      label={item.statusLabel}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
