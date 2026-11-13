'use client'

import { ArrowRight, Sparkles } from 'lucide-react'

export interface DelegateBarProps {
  onDelegate: () => void
}

/**
 * 소희에게 일 맡기기 빠른 진입 바.
 * 입력창처럼 보이는 전체 폭 버튼으로 10초 내 핵심 작업으로 유도한다.
 */
export function DelegateBar({ onDelegate }: DelegateBarProps) {
  return (
    <button
      type="button"
      onClick={onDelegate}
      aria-label="소희에게 일 맡기기"
      className="m-press group flex min-h-14 w-full items-center gap-3.5 rounded-2xl border border-primary/25 bg-accent/40 px-4 py-3 text-left shadow-xs transition-colors hover:border-primary/50 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs transition-transform group-hover:scale-105 [&>svg]:size-5">
        <Sparkles aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-bold tracking-tight text-foreground">
          소희에게 일 맡기기
        </span>
        <span className="text-[13px] text-muted-foreground">
          무엇이든 말씀해 주세요
        </span>
      </span>
      <span className="shrink-0 text-primary transition-transform group-hover:translate-x-0.5 [&>svg]:size-5">
        <ArrowRight aria-hidden="true" />
      </span>
    </button>
  )
}
