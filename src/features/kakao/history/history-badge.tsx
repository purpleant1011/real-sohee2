import React from 'react'
import type { KakaoHistoryItem, KakaoHistoryStatus } from './contract'
import { cn } from '@/lib/utils'

export interface KakaoStatusBadgeProps {
  item: Pick<KakaoHistoryItem, 'status' | 'statusLabel'>
  className?: string
  'aria-label'?: string
}

function getStatusColorClasses(status: KakaoHistoryStatus): string {
  switch (status) {
    case 'DELIVERED':
      return 'bg-state-ok-soft text-state-ok border-state-ok/30'
    case 'FAILED':
      return 'bg-destructive/10 text-destructive border-destructive/20'
    case 'NEEDS_CHECK':
    case 'HELD':
      return 'bg-state-warn-soft text-state-warn border-state-warn/30'
    case 'CANCELLED':
      return 'bg-muted text-muted-foreground border-border'
    case 'SCHEDULED':
    case 'SENDING':
    case 'SENT':
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700'
  }
}

/**
 * 알림톡 발송 상태 배지.
 *
 * - 색만으로 상태를 구분하지 않고 statusLabel 텍스트를 반드시 포함합니다.
 * - 스크린리더 접근성을 위해 aria-label을 제공합니다.
 */
export function KakaoStatusBadge({
  item,
  className,
  'aria-label': ariaLabel,
}: KakaoStatusBadgeProps) {
  const colorClasses = getStatusColorClasses(item.status)
  const label = ariaLabel ?? `알림톡 ${item.statusLabel}`

  return (
    <span
      data-slot="kakao-status-badge"
      data-status={item.status}
      aria-label={label}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap',
        colorClasses,
        className,
      )}
    >
      {item.statusLabel}
    </span>
  )
}
