'use client'

import React from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight, BellRing, CheckCircle2 } from 'lucide-react'
import type { LivingGreetingResult } from '@/features/agent-dock/living-greeting'

export interface AgentLivingGreetingProps {
  greeting: LivingGreetingResult
}

export function AgentLivingGreeting({
  greeting,
}: Readonly<AgentLivingGreetingProps>) {
  const isUrgent = greeting.badgeVariant === 'urgent'
  const isSuccess = greeting.badgeVariant === 'success'

  return (
    <div
      aria-label="소희의 상황 인지 브리핑 인사"
      className="rounded-2xl border border-purple-200/90 dark:border-purple-800/60 bg-gradient-to-br from-purple-50/70 via-card to-pink-50/40 dark:from-purple-950/30 dark:via-zinc-900 dark:to-pink-950/20 p-3.5 sm:p-4 text-xs leading-relaxed space-y-2.5 shadow-2xs"
    >
      {/* 뱃지 및 상태 헤더 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 font-extrabold text-[11px]">
          <Sparkles aria-hidden="true" className="size-3.5" />
          <span>소희의 실시간 매장 보고</span>
        </div>

        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 ${
            isUrgent
              ? 'bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-200 animate-pulse'
              : isSuccess
              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
              : 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
          }`}
        >
          {isUrgent ? (
            <BellRing aria-hidden="true" className="size-2.5" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="size-2.5" />
          )}
          <span>{greeting.badgeText}</span>
        </span>
      </div>

      {/* 인사말 본문 */}
      <p className="text-foreground/90 whitespace-pre-wrap font-medium">
        {greeting.greetingText}
      </p>

      {/* 퀵 액션 링크 버튼 */}
      {greeting.quickAction ? (
        <div className="pt-1">
          <Link
            href={greeting.quickAction.href}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-purple-600 hover:bg-purple-700 text-white transition-all shadow-2xs cursor-pointer group"
          >
            <span>{greeting.quickAction.label}</span>
            <ArrowRight
              aria-hidden="true"
              className="size-3 transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      ) : null}
    </div>
  )
}
