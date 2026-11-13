import React from 'react'
import { 
  CircleDot, 
  Clock, 
  Play, 
  Sparkles, 
  AlertCircle, 
  Calendar, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  RotateCw, 
  XCircle, 
  PauseCircle, 
  MinusCircle, 
  ShieldAlert,
  Loader2
} from 'lucide-react'

export type AgentLifecycleState =
  | 'idle'
  | 'planning'
  | 'queued'
  | 'running'
  | 'streaming'
  | 'waiting_for_approval'
  | 'scheduled'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'partially_completed'
  | 'blocked'
  | 'retrying'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'stale'

interface AgentStateConfig {
  label: string
  icon: React.ComponentType<{ className?: string }>
  badgeClasses: string
  dotClass: string
  animate?: boolean
}

const STATE_CONFIGS: Record<AgentLifecycleState, AgentStateConfig> = {
  idle: {
    label: '대기 중',
    icon: CircleDot,
    badgeClasses: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700',
    dotClass: 'bg-neutral-400',
  },
  planning: {
    label: '계획 수립 중',
    icon: Sparkles,
    badgeClasses: 'bg-primary/10 text-foreground dark:bg-primary/50 dark:text-primary border-primary/30',
    dotClass: 'bg-primary',
    animate: true,
  },
  queued: {
    label: '대기열 등록',
    icon: Clock,
    badgeClasses: 'bg-state-wait-soft text-state-wait dark:bg-state-wait/50 dark:text-state-wait border-state-wait/30',
    dotClass: 'bg-state-wait/50',
  },
  running: {
    label: '진행 중',
    icon: Loader2,
    badgeClasses: 'bg-state-wait-soft text-state-wait dark:bg-state-wait/50 dark:text-state-wait border-state-wait/30',
    dotClass: 'bg-state-wait',
    animate: true,
  },
  streaming: {
    label: '생성 및 스트리밍',
    icon: Sparkles,
    badgeClasses: 'bg-primary/10 text-primary dark:bg-primary/50 dark:text-primary border-primary/30',
    dotClass: 'bg-primary',
    animate: true,
  },
  waiting_for_approval: {
    label: '승인 대기 중',
    icon: AlertCircle,
    badgeClasses: 'bg-state-warn-soft text-state-warn dark:bg-state-warn/50 dark:text-state-warn border-state-warn/40 font-semibold',
    dotClass: 'bg-state-warn',
    animate: true,
  },
  scheduled: {
    label: '예약됨',
    icon: Calendar,
    badgeClasses: 'bg-state-wait-soft text-state-wait dark:bg-state-wait/50 dark:text-state-wait border-state-wait/30',
    dotClass: 'bg-state-wait',
  },
  executing: {
    label: '실행 중',
    icon: Cpu,
    badgeClasses: 'bg-state-wait-soft text-state-wait dark:bg-state-wait/50 dark:text-state-wait border-state-wait/30',
    dotClass: 'bg-state-wait',
    animate: true,
  },
  verifying: {
    label: '결과 검증 중',
    icon: RotateCw,
    badgeClasses: 'bg-state-ok-soft text-state-ok dark:bg-state-ok/50 dark:text-state-ok border-state-ok/30',
    dotClass: 'bg-state-ok',
    animate: true,
  },
  completed: {
    label: '완료됨',
    icon: CheckCircle2,
    badgeClasses: 'bg-state-ok-soft text-state-ok dark:bg-state-ok/50 dark:text-state-ok border-state-ok/30',
    dotClass: 'bg-state-ok',
  },
  partially_completed: {
    label: '부분 완료',
    icon: CheckCircle2,
    badgeClasses: 'bg-state-ok/70 text-state-ok dark:bg-state-ok/40 dark:text-state-ok border-state-ok/30',
    dotClass: 'bg-state-ok/50',
  },
  blocked: {
    label: '차단됨 / 정책 위반',
    icon: ShieldAlert,
    badgeClasses: 'bg-state-danger-soft text-state-danger dark:bg-state-danger/50 dark:text-state-danger border-state-danger/30',
    dotClass: 'bg-state-danger',
  },
  retrying: {
    label: '재시도 중',
    icon: RotateCw,
    badgeClasses: 'bg-state-warn-soft text-state-warn dark:bg-state-warn/50 dark:text-state-warn border-state-warn/30',
    dotClass: 'bg-state-warn',
    animate: true,
  },
  failed: {
    label: '실패',
    icon: XCircle,
    badgeClasses: 'bg-state-danger-soft text-state-danger dark:bg-state-danger/50 dark:text-state-danger border-state-danger/30',
    dotClass: 'bg-state-danger',
  },
  paused: {
    label: '일시 정지',
    icon: PauseCircle,
    badgeClasses: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700',
    dotClass: 'bg-neutral-500',
  },
  cancelled: {
    label: '취소됨',
    icon: MinusCircle,
    badgeClasses: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700',
    dotClass: 'bg-neutral-400',
  },
  stale: {
    label: '만료됨',
    icon: AlertTriangle,
    badgeClasses: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700',
    dotClass: 'bg-zinc-400',
  },
}

export interface AgentStateBadgeProps {
  state: AgentLifecycleState
  size?: 'sm' | 'md' | 'lg'
  showIcon?: boolean
  customLabel?: string
  className?: string
}

export function AgentStateBadge({
  state,
  size = 'md',
  showIcon = true,
  customLabel,
  className = '',
}: AgentStateBadgeProps) {
  const config = STATE_CONFIGS[state] || STATE_CONFIGS.idle
  const Icon = config.icon

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2',
  }[size]

  return (
    <span
      className={`inline-flex items-center rounded-full border ${config.badgeClasses} ${sizeClasses} ${className}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${config.dotClass} ${
          config.animate ? 'animate-ping' : ''
        }`}
      />
      {showIcon && (
        <Icon
          className={`w-3.5 h-3.5 ${
            config.animate && Icon === Loader2 ? 'animate-spin' : ''
          }`}
        />
      )}
      <span>{customLabel || config.label}</span>
    </span>
  )
}
