'use client'

import React from 'react'
import { Activity, CheckCircle2, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react'

export interface WebhookHealthBadgeProps {
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'PENDING'
  lastReceivedAt?: string | null
  failureRate?: number
  onRecheck?: () => void
}

export function WebhookHealthBadge({
  status,
  lastReceivedAt,
  failureRate = 0,
  onRecheck,
}: WebhookHealthBadgeProps) {
  const isHealthy = status === 'HEALTHY'
  const isDegraded = status === 'DEGRADED'
  const isFailed = status === 'FAILED'
  const isPending = status === 'PENDING'

  let badgeColor = 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
  let icon = <Clock className="w-3 h-3" />
  let label = '웹훅 대기 중'

  if (isHealthy) {
    badgeColor = 'bg-state-ok-soft text-state-ok dark:bg-state-ok/80 dark:text-state-ok border-state-ok/40'
    icon = <CheckCircle2 className="w-3 h-3 text-state-ok" />
    label = '웹훅 정상 수신'
  } else if (isDegraded) {
    badgeColor = 'bg-state-warn-soft text-state-warn dark:bg-state-warn/80 dark:text-state-warn border-state-warn/40'
    icon = <AlertTriangle className="w-3 h-3 text-state-warn" />
    label = '웹훅 수신 지연'
  } else if (isFailed) {
    badgeColor = 'bg-state-danger-soft text-state-danger dark:bg-state-danger/80 dark:text-state-danger border-state-danger/40'
    icon = <XCircle className="w-3 h-3 text-state-danger" />
    label = '웹훅 수신 장애'
  } else if (isPending) {
    badgeColor = 'bg-state-wait-soft text-state-wait dark:bg-state-wait/80 dark:text-state-wait border-state-wait/40'
    icon = <Clock className="w-3 h-3 text-state-wait" />
    label = '구독 검증 대기'
  }

  return (
    <div className="inline-flex items-center gap-2">
      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shadow-2xs ${badgeColor}`}>
        {icon}
        <span>{label}</span>
      </span>

      {lastReceivedAt && (
        <span className="text-[11px] text-zinc-400 font-mono">
          마지막 수신: {lastReceivedAt}
        </span>
      )}

      {onRecheck && (
        <button
          onClick={onRecheck}
          className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
          title="웹훅 상태 재확인"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}
