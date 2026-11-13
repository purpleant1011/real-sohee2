'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookOpen, ChevronDown, ChevronLeft, Clock3, Ellipsis, MessagesSquare, Monitor, Plus } from 'lucide-react'
import { safeReturnPath } from '@/features/mobile-shell/back'

type Props = Readonly<{
  title: string
  unreadInboxCount: number
  canCreate: boolean
  directWorkHref: string
  historyTriggerRef?: React.Ref<HTMLButtonElement>
  onNew: () => void
  onOpenHistory: () => void
}>

const ITEM = 'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium active:bg-muted'

/** 모바일 대화 상단 한 줄 메뉴. 자주 쓰는 것(뒤로·과거·새 대화)만 두고 나머지는 더보기 안으로 접는다. */
export function ConversationMobileBar({ title, unreadInboxCount, canCreate, directWorkHref, historyTriggerRef, onNew, onOpenHistory }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleBack = () => {
    const from = searchParams?.get('from')
    const safeFrom = safeReturnPath(from)
    if (safeFrom) {
      router.push(safeFrom)
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push('/app')
    }
  }

  return (
    <div role="toolbar" aria-label="대화 메뉴" className="relative flex min-h-14 w-full min-w-0 max-w-full items-center gap-1 border-b border-border bg-background px-2">
      <button type="button" aria-label="뒤로" onClick={handleBack} className="m-press inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <p className="min-w-0 flex-1 truncate px-1 text-base font-semibold tracking-tight text-foreground">{title}</p>
      <div className="flex shrink-0 items-center gap-0.5">
        <button type="button" aria-label="과거 대화" onClick={onOpenHistory} ref={historyTriggerRef} className="m-press inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring">
          <Clock3 className="size-5" aria-hidden="true" />
        </button>
        {canCreate ? (
          <button type="button" aria-label="새 대화" onClick={onNew} className="m-press inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring">
            <Plus className="size-5" aria-hidden="true" />
          </button>
        ) : null}
        <details className="group relative shrink-0">
          <summary aria-label="더보기" className="m-press inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="sr-only">더보기</span>
            <Ellipsis className="size-5" aria-hidden="true" />
            {unreadInboxCount > 0 ? <span aria-label={`읽지 않은 문의 ${unreadInboxCount}건`} className="absolute right-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-background" /> : null}
            <ChevronDown className="hidden" aria-hidden="true" />
          </summary>
          <div className="absolute right-0 top-12 z-50 w-64 space-y-0.5 rounded-2xl border border-border bg-popover p-1.5 shadow-xl">
            <Link prefetch={false} href="/app/inbox" className={ITEM}>
              <MessagesSquare className="size-5 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 font-medium">소희 문의답변</span>
              {unreadInboxCount > 0 ? <b className="rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground">{Math.min(unreadInboxCount, 99)}</b> : null}
            </Link>
            <Link prefetch={false} href="/app/conversations/capabilities" className={ITEM}><BookOpen className="size-5 text-muted-foreground" aria-hidden="true" /><span className="font-medium">소희가 할 수 있는 일</span></Link>
            <Link prefetch={false} href={directWorkHref} className={ITEM}><Monitor className="size-5 text-muted-foreground" aria-hidden="true" /><span className="font-medium">화면에서 직접 하기</span></Link>
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">게시·발송은 검토 후 승인해요. 공개 게시와 비용이 드는 작업은 내용을 확인하고 승인해 주세요.</p>
          </div>
        </details>
      </div>
    </div>
  )
}
