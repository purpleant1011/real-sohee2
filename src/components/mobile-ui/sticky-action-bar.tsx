import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** DETAIL/REVIEW/EDIT/CHAT 모드의 단일 고정 CTA 영역. 하단 5탭과 함께 쓰지 않는다(셸이 모드로 탭을 숨긴다).
 *  safe-area 하단 여백 포함. 키보드가 올라오면 셸의 visualViewport 처리(W1)를 따른다. */
export function StickyActionBar({ children, hint, className }: Readonly<{ children: ReactNode; hint?: ReactNode; className?: string }>) {
  return (
    <div className={cn('m-sticky-bar z-20', className)}>
      {hint ? <p className="mb-2 text-center text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
      <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-2 [&_button]:min-h-[var(--m-cta-h)]">{children}</div>
    </div>
  )
}
