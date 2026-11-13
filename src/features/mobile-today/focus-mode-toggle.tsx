'use client'

import { BellOff, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface FocusModeToggleProps {
  isFocusMode: boolean
  onToggle: (nextState: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * 시술집중 모드 토글 컴포넌트.
 * 시술 중 사장님이 집중할 수 있도록 일반 예약 안내를 숨기고
 * 긴급한 예약 충돌 및 알림톡 발송 실패만 필터링하여 노출합니다.
 * 터치 타깃 44px 이상 및 aria-pressed 접근성을 보장합니다.
 */
export function FocusModeToggle({
  isFocusMode,
  onToggle,
  disabled = false,
  className,
}: FocusModeToggleProps) {
  return (
    <button
      type="button"
      role="button"
      aria-pressed={isFocusMode}
      disabled={disabled}
      onClick={() => onToggle(!isFocusMode)}
      className={cn(
        'group flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-left transition-all',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isFocusMode
          ? 'border-primary/40 bg-primary/10 text-primary shadow-xs'
          : 'border-border/80 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
            isFocusMode
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground group-hover:text-foreground'
          )}
          aria-hidden="true"
        >
          {isFocusMode ? <BellOff className="size-4" /> : <Sparkles className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-xs font-semibold leading-snug sm:text-sm">
            {isFocusMode
              ? '시술 집중 모드 켜짐 (긴급한 예약·알림 실패만 안내해요)'
              : '시술 집중 모드 꺼짐'}
          </p>
        </div>
      </div>

      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
          isFocusMode ? 'bg-primary' : 'bg-input'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block size-5 transform rounded-full bg-background shadow-lg ring-0 transition duration-200 ease-in-out',
            isFocusMode ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </span>
    </button>
  )
}
