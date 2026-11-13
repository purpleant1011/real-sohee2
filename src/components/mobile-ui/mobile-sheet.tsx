'use client'

import { useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { TOUCH_TARGET_CLASS } from './a11y-contract'

export type MobileSheetProps = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 필수: 스크린리더가 읽는 대화상자 이름. 빈 제목은 허용하지 않는다. */
  title: string
  description?: string
  children?: ReactNode
  className?: string
}>

/** 하단 시트 계약: 포커스 트랩·Esc 닫기·트리거로 포커스 복귀(Radix Dialog), 44px 닫기 버튼, 안전영역 하단 여백. */
export function MobileSheet({ open, onOpenChange, title, description, children, className }: MobileSheetProps) {
  // 트리거가 Sheet 밖(상태 제어)이어도 열기 직전 포커스 위치로 되돌린다.
  const openerRef = useRef<HTMLElement | null>(null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onOpenAutoFocus={() => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }}
        onCloseAutoFocus={(event) => { if (openerRef.current?.isConnected) { event.preventDefault(); openerRef.current.focus() } }}
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn('max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]', className)}
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {children}
        <SheetClose
          aria-label="닫기"
          className={cn('absolute right-3 top-3 grid place-items-center rounded-full text-muted-foreground', TOUCH_TARGET_CLASS)}
        >
          <X aria-hidden className="size-5" />
        </SheetClose>
      </SheetContent>
    </Sheet>
  )
}
