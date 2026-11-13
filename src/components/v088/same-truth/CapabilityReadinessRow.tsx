'use client'

import React from 'react'
import { CheckCircle2, Circle, AlertTriangle, XCircle, ShieldCheck } from 'lucide-react'

export interface CapabilityReadinessRowProps {
  name: string
  channel: string
  state: 'DISCONNECTED' | 'CONNECTED' | 'AUTHORIZED' | 'LISTENING' | 'EXECUTABLE' | 'PROVEN' | 'AUTONOMOUS' | string
  proofStatus: string
  failureCode?: string | null
}

const STEP_LABELS: Record<string, string> = {
  CONNECTED: '채널 연결',
  AUTHORIZED: '인증 완료',
  LISTENING: '반응 감지',
  EXECUTABLE: '실행 준비',
  PROVEN: '검증 완료',
  AUTONOMOUS: '자동 운영 중',
}

export function CapabilityReadinessRow({
  name,
  channel,
  state,
  proofStatus,
  failureCode,
}: CapabilityReadinessRowProps) {
  const steps = ['CONNECTED', 'AUTHORIZED', 'LISTENING', 'EXECUTABLE', 'PROVEN', 'AUTONOMOUS']
  const currentIndex = steps.indexOf(state)

  return (
    <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-mono px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-bold">
            {channel}
          </span>
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{name}</span>
        </div>
        {failureCode && (
          <div className="flex items-center gap-1.5 text-xs text-state-warn font-medium">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>차단 사유: {failureCode}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto py-1">
        {steps.map((step, idx) => {
          const isPast = idx < currentIndex
          const isCurrent = idx === currentIndex
          const isFuture = idx > currentIndex

          let badgeClass = 'bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800'
          if (isPast) {
            badgeClass = 'bg-state-ok-soft text-state-ok dark:bg-state-ok/40 dark:text-state-ok border-state-ok/40'
          } else if (isCurrent) {
            badgeClass = step === 'AUTONOMOUS'
              ? 'bg-primary/10 text-foreground dark:bg-primary dark:text-primary border-primary/50 font-black'
              : 'bg-state-wait-soft text-state-wait dark:bg-state-wait dark:text-state-wait border-state-wait/50 font-black'
          }

          return (
            <div
              key={step}
              className={`px-2.5 py-1 rounded-md text-[10px] border flex items-center gap-1 whitespace-nowrap transition-colors ${badgeClass}`}
            >
              {isPast && <CheckCircle2 className="w-3 h-3 text-state-ok" />}
              {isCurrent && (step === 'AUTONOMOUS' ? <ShieldCheck className="w-3 h-3 text-primary" /> : <Circle className="w-3 h-3 text-state-wait fill-current" />)}
              {isFuture && <Circle className="w-3 h-3 text-zinc-300 dark:text-zinc-700" />}
              <span>{STEP_LABELS[step] || step}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
