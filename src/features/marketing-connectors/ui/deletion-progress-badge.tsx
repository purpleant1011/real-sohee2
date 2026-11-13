'use client'

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type DeletionStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface DeletionProgressBadgeProps {
  status: DeletionStatus
  requestedAt: string
  error?: string
  className?: string
}

interface StatusConfig {
  variant: 'warning' | 'info' | 'success' | 'destructive'
  label: string
  description?: string
}

const STATUS_CONFIG: Record<DeletionStatus, StatusConfig> = {
  pending: {
    variant: 'warning',
    label: '삭제 대기 중',
  },
  running: {
    variant: 'info',
    label: '데이터 파기 진행 중',
  },
  completed: {
    variant: 'success',
    label: '완전 삭제됨',
  },
  failed: {
    variant: 'destructive',
    label: '삭제 재시도 중',
  },
}

function formatRequestedDate(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    if (isNaN(d.getTime())) return isoDate
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
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

export function DeletionProgressBadge({
  status,
  requestedAt,
  error,
  className,
}: DeletionProgressBadgeProps): React.ReactElement {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const formattedDate = formatRequestedDate(requestedAt)

  return (
    <div
      className={cn(
        'w-full max-w-full rounded-lg border border-border/60 bg-muted/30 p-3 sm:p-4 text-xs space-y-2.5 transition-all',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={config.variant} className="font-medium text-xs px-2.5 py-0.5">
            {config.label}
          </Badge>
          <span className="text-muted-foreground text-[11px] sm:text-xs">
            요청 시각: {formattedDate}
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-destructive text-[11px] sm:text-xs leading-relaxed">
          {error}
        </div>
      )}

      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed break-keep">
        공급자 계정 자체는 삭제되지 않으며, 소희에 저장된 연동 토큰과 임시 근거 데이터만 안전하게 영구 파기됩니다.
      </p>
    </div>
  )
}
