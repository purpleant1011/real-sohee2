'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Trash2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ConnectorSourceItem {
  id: string
  name: string
  lastSyncAt?: string
  evidenceCount?: number
}

export interface ConnectorSourceListProps {
  connectorId: string
  sources: ConnectorSourceItem[]
  onRefresh?: (sourceId: string) => void
  onRemove?: (sourceId: string) => void
  className?: string
}

function formatSyncDate(isoDate?: string): string {
  if (!isoDate) return '동기화 기록 없음'
  try {
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate
    return d.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    return isoDate
  }
}

export function ConnectorSourceList({
  connectorId,
  sources,
  onRefresh,
  onRemove,
  className,
}: ConnectorSourceListProps): React.ReactElement {
  if (!sources || sources.length === 0) {
    return (
      <div
        data-connector-id={connectorId}
        className={cn(
          'flex flex-col items-center justify-center p-6 sm:p-8 rounded-lg border border-dashed border-border/70 bg-muted/20 text-center space-y-2',
          className
        )}
      >
        <Layers className="size-8 text-muted-foreground/50 stroke-1" />
        <p className="text-xs sm:text-sm font-medium text-muted-foreground">
          연결된 소스가 없습니다.
        </p>
        <p className="text-[11px] sm:text-xs text-muted-foreground/70">
          동기화할 세부 항목(캘린더, 스프레드시트 범위 등)을 설정해주세요.
        </p>
      </div>
    )
  }

  return (
    <div data-connector-id={connectorId} className={cn('space-y-2.5 w-full', className)}>
      <ul className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card overflow-hidden">
        {sources.map((source) => {
          const evidenceCount = source.evidenceCount ?? 0
          return (
            <li
              key={source.id}
              className="p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-xs sm:text-sm text-foreground truncate max-w-[240px] sm:max-w-[320px]">
                    {source.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] sm:text-xs px-2 py-0">
                    근거 {evidenceCount}건
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>마지막 동기화: {formatSyncDate(source.lastSyncAt)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                {onRefresh && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs gap-1.5"
                    onClick={() => onRefresh(source.id)}
                    aria-label={`${source.name} 새로고침`}
                  >
                    <RefreshCw className="size-3.5" />
                    <span>새로고침</span>
                  </Button>
                )}
                {onRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    onClick={() => onRemove(source.id)}
                    aria-label={`${source.name} 해제`}
                  >
                    <Trash2 className="size-3.5" />
                    <span>해제</span>
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
