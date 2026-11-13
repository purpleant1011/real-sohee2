'use client'

import React from 'react'
import { useKakaoHistory } from './use-kakao-history'
import { KakaoStatusBadge } from './history-badge'
import { cn } from '@/lib/utils'

export interface KakaoHistoryListProps {
  workspaceId: string
  reservationId?: string
  customerId?: string
  limit?: number
  className?: string
}

/**
 * ISO 일시 문자열을 한국어 KST 'M월 D일 오전|오후 H:MM' 포맷으로 변환합니다.
 */
export function formatKstHistoryTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso

  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const month = kst.getUTCMonth() + 1
  const day = kst.getUTCDate()
  const hours24 = kst.getUTCHours()
  const minutes = String(kst.getUTCMinutes()).padStart(2, '0')

  const period = hours24 < 12 ? '오전' : '오후'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12

  return `${month}월 ${day}일 ${period} ${hours12}:${minutes}`
}

/**
 * 사장님용 알림톡 발송내역 목록 컴포넌트.
 *
 * - 로딩: 스켈레톤 UI
 * - 오류: "발송내역을 불러오지 못했어요" + 다시 시도 버튼 (오류를 '내역 없음'으로 오도하지 않음)
 * - 빈 상태: "아직 보낸 안내가 없어요"
 * - 목록: eventLabel, KakaoStatusBadge, KST 시각, detailLabel(보조문구)
 * - 크레딧·비용·잔액 등 과금 숫자는 일체 표시하지 않습니다.
 */
export function KakaoHistoryList({
  workspaceId,
  reservationId,
  customerId,
  limit,
  className,
}: KakaoHistoryListProps) {
  const { items, load, refresh } = useKakaoHistory({
    workspaceId,
    reservationId,
    customerId,
    limit,
  })

  if (load === 'loading') {
    return (
      <div
        role="status"
        aria-label="발송내역을 불러오는 중입니다"
        className={cn('space-y-2.5', className)}
      >
        <div className="p-3 rounded-xl border border-border bg-card space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-28 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded-full" />
          </div>
          <div className="h-3 w-36 bg-muted/70 rounded" />
        </div>
        <div className="p-3 rounded-xl border border-border bg-card space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded-full" />
          </div>
          <div className="h-3 w-40 bg-muted/70 rounded" />
        </div>
        <span className="sr-only">발송내역을 불러오는 중입니다</span>
      </div>
    )
  }

  if (load === 'error') {
    return (
      <div
        role="alert"
        className={cn(
          'p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-center space-y-2.5',
          className,
        )}
      >
        <p className="text-xs font-semibold text-destructive">
          발송내역을 불러오지 못했어요
        </p>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
        >
          다시 시도
        </button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'p-6 text-center text-xs text-muted-foreground border border-dashed border-border rounded-xl bg-card/50',
          className,
        )}
      >
        아직 보낸 안내가 없어요
      </div>
    )
  }

  return (
    <ul className={cn('divide-y divide-border/60 rounded-xl border border-border bg-card', className)}>
      {items.map((item) => {
        const timeText = formatKstHistoryTime(item.updatedAt || item.dueAt)
        return (
          <li key={item.id} className="p-3 space-y-1">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="font-semibold text-xs text-foreground truncate">
                {item.eventLabel}
              </span>
              <KakaoStatusBadge item={item} />
            </div>

            {timeText && (
              <div className="text-[11px] text-muted-foreground font-mono">
                {timeText}
              </div>
            )}

            {item.detailLabel && (
              <p className="text-[11px] text-muted-foreground leading-relaxed pt-0.5">
                {item.detailLabel}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
