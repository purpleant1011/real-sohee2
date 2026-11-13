import type { MouseEvent } from 'react'
import Link from 'next/link'
import { Calendar, ChevronRight, Lightbulb, MessageCircle, MessageSquare, MessageSquareQuote, Sparkles, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** 사장님이 지금 확인해야 할 일 1건. 읽기 전용 상세로만 이동하며, 여기서 바로 실행/발송하지 않는다. */
export type DecisionCardProps = Readonly<{
  /** 복귀 시 포커스를 되돌릴 앵커 id */
  id?: string
  href: string
  /** 분류 배지 문구(메시지/댓글/콘텐츠 등 사용자 어휘) */
  kindLabel: string
  /** 대상 한 줄(고객·채널 등) */
  targetLabel: string
  title: string
  actionLabel?: string
  icon?: LucideIcon
  /** 클릭 가로채기(뒤로가기 위치 기억 등). 이동 자체는 href 가 담당한다. */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void
  className?: string
}>

function resolveKindStyle(kindLabel: string, explicitIcon?: LucideIcon): { Icon: LucideIcon; iconClass: string; badgeVariant?: 'default' | 'secondary' | 'outline' } {
  if (explicitIcon) {
    return { Icon: explicitIcon, iconClass: 'bg-primary/10 text-primary' }
  }

  const normalized = kindLabel.trim()
  if (normalized.includes('콘텐츠') || normalized.includes('게시')) {
    return { Icon: Sparkles, iconClass: 'bg-primary/10 text-primary' }
  }
  if (normalized.includes('메시지') || normalized.includes('문의')) {
    return { Icon: MessageCircle, iconClass: 'bg-state-ok-soft text-state-ok' }
  }
  if (normalized.includes('댓글')) {
    return { Icon: MessageSquareQuote, iconClass: 'bg-accent text-primary' }
  }
  if (normalized.includes('제안')) {
    return { Icon: Lightbulb, iconClass: 'bg-state-warn-soft text-state-warn' }
  }
  if (normalized.includes('예약') || normalized.includes('일정')) {
    return { Icon: Calendar, iconClass: 'bg-state-wait-soft text-state-wait' }
  }

  return { Icon: MessageSquare, iconClass: 'bg-muted text-foreground' }
}

export function DecisionCard({ id, href, kindLabel, targetLabel, title, actionLabel = '검토하기', icon, onNavigate, className }: DecisionCardProps) {
  const { Icon, iconClass } = resolveKindStyle(kindLabel, icon)

  return (
    <Link
      prefetch={false}
      id={id}
      href={href}
      onClick={onNavigate}
      className={cn(
        'm-press group flex min-h-28 items-center gap-3.5 rounded-2xl border border-border/80 bg-card p-4 shadow-xs transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-ring',
        className,
      )}
    >
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105', iconClass)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 space-y-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="px-2 py-0.5 text-xs font-semibold">
            {kindLabel}
          </Badge>
          <span className="break-words text-[13px] text-muted-foreground">{targetLabel}</span>
        </span>
        <span className="block break-words text-[16px] font-semibold leading-snug tracking-tight text-foreground group-hover:text-primary">
          {title}
        </span>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary">
          {actionLabel}
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  )
}
