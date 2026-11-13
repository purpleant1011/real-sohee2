'use client'

import { useKakaoHistory } from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem, KakaoHistoryStatus } from '@/features/kakao/history/contract'
import { cn } from '@/lib/utils'

export interface KakaoHistorySectionProps {
  workspaceId: string
  customerId: string
}

/**
 * KST (UTC+9) 기준 'M월 D일 오전|오후 H:MM' 포맷터.
 * 순수 Date 연산으로 타임존 독립적(Fail-closed) 동작.
 */
export function formatKakaoHistoryTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ''

  // KST: UTC+9
  const kstMs = parsed + 9 * 60 * 60 * 1000
  const kst = new Date(kstMs)

  const month = kst.getUTCMonth() + 1
  const day = kst.getUTCDate()
  const hours24 = kst.getUTCHours()
  const minutes = String(kst.getUTCMinutes()).padStart(2, '0')

  const period = hours24 < 12 ? '오전' : '오후'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12

  return `${month}월 ${day}일 ${period} ${hours12}:${minutes}`
}

export const KAKAO_STATUS_STYLES: Record<KakaoHistoryStatus, string> = {
  DELIVERED: 'bg-state-ok-soft text-state-ok border-[var(--state-ok-line)]',
  SENT: 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]',
  SENDING: 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]',
  SCHEDULED: 'bg-state-wait-soft text-state-wait border-[var(--state-wait-line)]',
  NEEDS_CHECK: 'bg-state-warn-soft text-state-warn border-[var(--state-warn-line)]',
  FAILED: 'bg-state-danger-soft text-state-danger border-[var(--state-danger-line)]',
  HELD: 'bg-state-quiet-soft text-state-quiet border-[var(--state-quiet-line)]',
  CANCELLED: 'bg-state-quiet-soft text-state-quiet border-[var(--state-quiet-line)]',
}

/**
 * M17b 고객 상세용 '카카오 안내 발송내역' 섹션.
 *
 * [보안 및 규약]
 * - 크레딧·비용 숫자는 절대 표시하지 않는다.
 * - 조회 실패(error)를 '내역 없음'으로 오인하게 표시하지 않는다.
 * - 최소 44px 터치 타겟 준수(다시 시도 버튼).
 */
export function KakaoHistorySection({ workspaceId, customerId }: Readonly<KakaoHistorySectionProps>) {
  const isPreview = workspaceId.startsWith('preview-')
  const { items, load, refresh } = useKakaoHistory({
    workspaceId: isPreview ? '' : workspaceId,
    customerId,
  })

  return (
    <section aria-label="카카오 안내 발송내역" className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold">카카오 안내 발송내역</h2>

      {load === 'loading' ? (
        <p className="py-2 text-center text-sm text-muted-foreground" aria-busy="true">
          발송내역을 불러오는 중이에요...
        </p>
      ) : null}

      {load === 'error' ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm font-medium text-state-danger">발송내역을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {load === 'ready' && items.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted-foreground">아직 보낸 안내가 없어요</p>
      ) : null}

      {load === 'ready' && items.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <HistoryItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function HistoryItemRow({ item }: Readonly<{ item: KakaoHistoryItem }>) {
  const timeIso = item.status === 'SCHEDULED' ? item.dueAt : (item.updatedAt || item.dueAt)
  const formattedTime = formatKakaoHistoryTime(timeIso)
  const badgeStyle = KAKAO_STATUS_STYLES[item.status] ?? 'bg-secondary text-secondary-foreground border-transparent'

  return (
    <li className="space-y-1 py-3 first:pt-1 last:pb-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{item.eventLabel}</p>
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
            badgeStyle,
          )}
        >
          {item.statusLabel}
        </span>
      </div>
      {formattedTime ? <p className="text-xs text-muted-foreground">{formattedTime}</p> : null}
      {item.detailLabel ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{item.detailLabel}</p>
      ) : null}
    </li>
  )
}
