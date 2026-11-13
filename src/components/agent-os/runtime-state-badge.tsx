import React from 'react'
import type { WorkboardRuntimeState, DataFreshness } from '@/features/agent-os/workboard-types'
import { cn } from '@/lib/utils'

interface RuntimeStateBadgeProps {
  state: WorkboardRuntimeState
  freshness?: DataFreshness
  showFreshnessTag?: boolean
  className?: string
}

export function RuntimeStateBadge({
  state,
  freshness = 'FRESH',
  showFreshnessTag = false,
  className,
}: RuntimeStateBadgeProps) {
  const getBadgeConfig = () => {
    switch (state) {
      case 'RUNNING':
        return {
          label: '자율근무 중',
          dotColor: 'bg-state-ok animate-pulse',
          bg: 'bg-state-ok-soft text-state-ok border-state-ok/30',
        }
      case 'LEARNING':
        return {
          label: '성과 학습 중',
          dotColor: 'bg-primary animate-pulse',
          bg: 'bg-primary/10 text-primary border-primary/30',
        }
      case 'OWNER_ACTION_REQUIRED':
        return {
          label: '사장님 확인 필요',
          dotColor: 'bg-state-warn animate-pulse',
          bg: 'bg-state-warn-soft text-state-warn border-state-warn/40',
        }
      case 'PAUSED':
        return {
          label: '일시 정지',
          dotColor: 'bg-zinc-400',
          bg: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700',
        }
      case 'BLOCKED':
        return {
          label: '안전 차단',
          dotColor: 'bg-state-danger',
          bg: 'bg-state-danger-soft text-state-danger border-state-danger/30',
        }
      case 'DEGRADED':
        return {
          label: '연결 지연',
          dotColor: 'bg-state-warn',
          bg: 'bg-state-warn-soft text-state-warn border-state-warn/30',
        }
      case 'IDLE':
      default:
        return {
          label: '업무 대기',
          dotColor: 'bg-zinc-400',
          bg: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700',
        }
    }
  }

  const config = getBadgeConfig()

  return (
    <div className={cn('inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border shadow-xs select-none', config.bg, className)}>
      <span className={cn('w-2 h-2 rounded-full shrink-0', config.dotColor)} />
      <span>{config.label}</span>
      {showFreshnessTag && freshness === 'STALE' && (
        <span className="text-[10px] font-medium text-state-warn">
          (지연됨)
        </span>
      )}
    </div>
  )
}
