'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Calendar, Loader2, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ReservationActionKind =
  | 'notification_failed'
  | 'booking_pending'
  | 'slot_conflict'
  | 'none'

export interface ReservationAction {
  kind: ReservationActionKind
  title: string
  detail: string
  reservationId?: string
  ctaLabel: string
  ctaHref?: string
  onAction?: () => Promise<void> | void
}

export interface ReservationActionCardProps {
  action: ReservationAction
  isFocusMode?: boolean
  className?: string
}

/**
 * 소희 모바일 사장님 10초 조치 카드.
 * - 긴급 예약 충돌, 알림톡 실패, 예약 접수 대기 건을 원클릭으로 10초 안에 처리하도록 돕습니다.
 * - 시술집중 모드(isFocusMode) 활성화 시 경미한 일반 안내(booking_pending)는 숨기고
 *   실패 및 충돌 등 긴급 조치만 단일 카드로 노출합니다.
 * - 연타 방어: 비동기 처리 중 버튼 비활성화(isSubmitting) 및 중복 호출을 차단합니다.
 * - 320~430px 모바일 화면 폭을 완벽 지원하며, 크레딧/잔액 숫자는 일체 표시하지 않습니다.
 */
export function ReservationActionCard({
  action,
  isFocusMode = false,
  className,
}: ReservationActionCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  // 1. 할 일이 없거나 none인 경우 렌더링하지 않음
  if (action.kind === 'none') {
    return null
  }

  const isUrgent = action.kind === 'notification_failed' || action.kind === 'slot_conflict'

  // 2. 시술집중 모드에서는 경미한 안내(booking_pending) 숨김, 긴급 조치만 노출
  if (isFocusMode && !isUrgent) {
    return null
  }

  const handleActionClick = async () => {
    if (isSubmitting || !action.onAction) return
    setIsSubmitting(true)
    try {
      await action.onAction()
    } finally {
      setIsSubmitting(false)
    }
  }

  const badgeConfig = {
    notification_failed: {
      text: isFocusMode ? '시술 중 긴급 안내' : '알림톡 발송 실패',
      variant: 'destructive' as const,
      icon: AlertTriangle,
    },
    slot_conflict: {
      text: isFocusMode ? '시술 중 긴급 안내' : '예약 시간 충돌',
      variant: 'destructive' as const,
      icon: AlertTriangle,
    },
    booking_pending: {
      text: '예약 확인 대기',
      variant: 'default' as const,
      icon: Calendar,
    },
  }[action.kind]

  const BadgeIcon = badgeConfig.icon

  return (
    <section
      role="region"
      aria-label={isUrgent ? '예약 긴급 조치' : '예약 조치'}
      className={cn(
        'w-full max-w-full space-y-3.5 rounded-[20px] border p-4 shadow-xs transition-colors sm:p-5',
        isUrgent
          ? 'border-destructive/30 bg-destructive/[0.04]'
          : 'border-primary/20 bg-primary/[0.03]',
        className
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Badge variant={badgeConfig.variant} className="shrink-0 whitespace-nowrap gap-1 px-2 py-0.5 text-xs font-semibold">
            {isFocusMode ? <ShieldAlert className="size-3.5" aria-hidden="true" /> : <BadgeIcon className="size-3.5" aria-hidden="true" />}
            {badgeConfig.text}
          </Badge>
          {isUrgent && !isFocusMode && (
            <span className="shrink-0 whitespace-nowrap text-[12px] font-medium text-destructive">긴급 조치 필요</span>
          )}
        </div>

        <h2 className="break-words break-keep text-base font-bold leading-snug tracking-tight text-foreground sm:text-[18px]">
          {action.title}
        </h2>
        <p className="break-words break-keep text-xs leading-relaxed text-muted-foreground sm:text-sm">
          {action.detail}
        </p>
      </div>

      {action.ctaHref && !action.onAction ? (
        <Link
          prefetch={false}
          href={action.ctaHref}
          className={cn(
            'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:text-base',
            isUrgent
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          )}
        >
          {action.ctaLabel}
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      ) : (
        <Button
          type="button"
          onClick={handleActionClick}
          disabled={isSubmitting}
          aria-busy={isSubmitting}
          variant={isUrgent ? 'destructive' : 'default'}
          className="min-h-12 w-full gap-2 rounded-xl text-sm font-semibold transition-all sm:text-base"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              처리 중...
            </>
          ) : (
            <>
              {action.ctaLabel}
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </>
          )}
        </Button>
      )}
    </section>
  )
}
