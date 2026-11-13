import type { ComponentType, ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export type MenuIcon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

/**
 * 모바일 메뉴 타일. 오늘·더보기가 같은 시각 언어(아이콘 칩 + 제목 + 한 줄 설명)를 쓰도록 하는 공용 조각.
 * 기능·권한은 그대로이고 표현만 정돈한다. 배지(숫자)는 확인된 값일 때만 넘긴다.
 */
export function MenuTile({ href, label, description, Icon, badge, tone = 'default', prefetch = false }: {
  href: string
  label: string
  description?: string
  Icon: MenuIcon
  badge?: ReactNode
  tone?: 'default' | 'accent'
  prefetch?: boolean
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className="group relative flex h-full min-h-[104px] flex-col justify-between gap-3 rounded-[20px] border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(20,16,40,0.04)] transition-[transform,background-color,box-shadow] duration-150 active:scale-[0.98] active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <span className="flex items-start justify-between">
        <span className={`flex size-10 items-center justify-center rounded-2xl ${tone === 'accent' ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {badge ? <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-primary-foreground">{badge}</span> : null}
      </span>
      <span className="block space-y-0.5">
        <span className="block text-[15px] font-semibold leading-tight tracking-tight text-foreground">{label}</span>
        {description ? <span className="block text-[13px] leading-snug text-muted-foreground">{description}</span> : null}
      </span>
    </Link>
  )
}

/** 제목 + 2열 타일 묶음. 제목은 작은 보조 라벨로 눌러 두어 타일이 주인공이 되게 한다. */
export function MenuSection({ title, children, ariaLabel }: { title?: string; children: ReactNode; ariaLabel?: string }) {
  return (
    <section aria-label={ariaLabel ?? title} className="space-y-2.5">
      {title ? <h2 className="px-1 text-[13px] font-semibold tracking-wide text-muted-foreground">{title}</h2> : null}
      <ul className="grid grid-cols-2 gap-3">{children}</ul>
    </section>
  )
}

/** 한 줄 목록 행(설정류). 오른쪽 상태 문구와 화살표를 가진다. */
export function MenuRow({ href, label, summary, status, Icon }: { href?: string; label: string; summary?: string | null; status?: ReactNode; Icon?: MenuIcon }) {
  const body = (
    <>
      {Icon ? <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-[18px]" aria-hidden="true" /></span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-tight">{label}</span>
        {summary ? <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{summary}</span> : null}
      </span>
      {status ? <span className="shrink-0 text-[13px] text-muted-foreground">{status}</span> : null}
      {href ? <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" /> : null}
    </>
  )
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left'
  return href ? <Link href={href} prefetch={false} className={`${cls} active:bg-muted/60`}>{body}</Link> : <div className={cls}>{body}</div>
}
