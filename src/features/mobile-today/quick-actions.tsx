import Link from 'next/link'
import { Archive, CalendarDays, CheckCheck, Inbox, type LucideIcon } from 'lucide-react'

interface QuickActionItem {
  label: string
  href: string
  Icon: LucideIcon
  colorClass: string
}

const QUICK_ACTIONS: readonly QuickActionItem[] = [
  { label: '소통함', href: '/app/engagement', Icon: Inbox, colorClass: 'bg-state-ok-soft text-state-ok' },
  { label: '승인 대기', href: '/app/approvals', Icon: CheckCheck, colorClass: 'bg-state-warn-soft text-state-warn' },
  { label: '예약 일정', href: '/app/schedule', Icon: CalendarDays, colorClass: 'bg-state-wait-soft text-state-wait' },
  { label: '보관함', href: '/app/vault', Icon: Archive, colorClass: 'bg-primary/10 text-primary' },
]

/** 오늘 화면에서 자주 쓰는 핵심 기능을 엄지 한 번으로 여는 4칸 한 줄 바로가기 */
export function QuickActions() {
  return (
    <nav aria-label="바로가기" className="flex flex-col gap-2.5">
      <div className="px-1">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground">바로가기</h2>
      </div>

      <ul className="grid grid-cols-4 gap-2">
        {QUICK_ACTIONS.map(({ label, href, Icon, colorClass }) => (
          <li key={href}>
            <Link
              prefetch={false}
              href={href}
              className="m-press group flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border/70 bg-card p-2 text-center shadow-2xs transition-colors hover:border-primary/40 hover:bg-muted/40 active:bg-muted/70 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${colorClass} transition-transform group-hover:scale-105 [&_svg]:size-4`}>
                <Icon aria-hidden="true" />
              </span>
              <span className="w-full max-w-full truncate text-xs font-semibold text-foreground group-hover:text-primary">
                {label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
