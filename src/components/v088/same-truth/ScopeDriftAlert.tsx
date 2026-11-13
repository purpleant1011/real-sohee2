'use client'

import React from 'react'
import { AlertTriangle, KeyRound, ArrowRight, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

export interface ScopeDriftAlertProps {
  channel: 'threads' | 'instagram'
  requiredScopes: string[]
  grantedScopes: string[]
  missingScopes: string[]
  reconnectHref?: string
}

export function ScopeDriftAlert({
  channel,
  requiredScopes,
  grantedScopes,
  missingScopes,
  reconnectHref,
}: ScopeDriftAlertProps) {
  if (!missingScopes || missingScopes.length === 0) {
    return null
  }

  const channelName = channel === 'threads' ? '스레드 (Threads)' : '인스타그램 (Instagram)'
  const defaultHref = reconnectHref || `/api/channels/oauth/${channel}/authorize`

  return (
    <div className="p-4.5 rounded-2xl border border-state-warn/40 bg-state-warn/80 text-state-warn shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-state-warn/80 text-state-warn flex items-center justify-center shrink-0 mt-0.5">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-black tracking-tight">
                {channelName} 권한 범위 불일치 감지
              </h4>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-state-warn/20 text-state-warn">
                누락 {missingScopes.length}개
              </span>
            </div>
            <p className="text-[11px] opacity-80 leading-relaxed font-medium mt-0.5">
              소희 사원이 외부 이벤트를 정상 청취·답변하려면 아래 누락된 권한(Scope) 승인이 필수적입니다.
            </p>
          </div>
        </div>

        <Link
          href={defaultHref}
          className="px-4 py-2 rounded-xl bg-state-warn hover:bg-state-warn/90 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all shrink-0 cursor-pointer"
        >
          <span>권한 재인증 (1-Click)</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="p-3 rounded-xl bg-white/70 dark:bg-black/30 border border-state-warn/30 text-xs space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold text-state-warn">누락된 필수 스코프:</span>
          {missingScopes.map((scope) => (
            <span
              key={scope}
              className="px-2 py-0.5 rounded font-mono text-[11px] bg-state-danger-soft text-state-danger font-bold"
            >
              {scope}
            </span>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          현재 부여된 스코프: {grantedScopes.join(', ') || '없음'}
        </div>
      </div>
    </div>
  )
}
