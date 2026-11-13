'use client'

import Link from 'next/link'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import {
  formatKakaoHistoryTime,
  KAKAO_STATUS_STYLES,
} from './kakao-history-section'
import { useCanonicalCustomers } from './use-canonical-customers'
import { useCanonicalCustomerHistory } from './use-canonical-customer-history'
import { formatBookingTime } from './canonical-customers-section'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'
import { cn } from '@/lib/utils'

export interface CanonicalCustomerDetailViewProps {
  workspaceId: string
  customerUuid: string
}

export function canonicalCustomerDetailScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '고객 상세', backHref: '/app/customers' }
}

/**
 * M17 번호 기준 정본 고객 상세 화면.
 *
 * [모바일 R2 UI 규칙]
 * - 390px 반응형 및 최소 44px 터치 타겟 준수
 * - 전화번호는 phoneMasked 만 노출 (원문 번호 PII 노출 금지)
 * - 발송내역 조회 실패 시 "발송내역을 불러오지 못했어요" + 다시 시도
 * - 발송내역 0건일 때 "아직 보낸 안내가 없어요"
 */
export function CanonicalCustomerDetailView({
  workspaceId,
  customerUuid,
}: Readonly<CanonicalCustomerDetailViewProps>) {
  const {
    items: customers,
    load: customersLoad,
    refresh: refreshCustomers,
  } = useCanonicalCustomers({ workspaceId })

  const customer = customers.find((c) => c.id === customerUuid)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 pt-1 text-foreground">
      {/* 헤더 & 뒤로가기 */}
      <div className="flex items-center justify-between">
        <Link
          href="/app/customers"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          목록으로
        </Link>
      </div>

      {/* 고객 기본 정보 */}
      {customersLoad === 'loading' ? (
        <section className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          고객 정보를 불러오는 중이에요...
        </section>
      ) : customersLoad === 'error' ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-medium text-destructive">고객 정보를 불러오지 못했어요</p>
          <button
            type="button"
            onClick={refreshCustomers}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            다시 시도
          </button>
        </section>
      ) : customer ? (
        <section aria-label="고객 기본 정보" className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <header className="space-y-1">
            <span className="inline-block rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
              예약 고객
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{customer.displayName || '이름 없음'}</h1>
          </header>

          <div className="space-y-1.5 border-t border-border/60 pt-3 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">전화번호</span>
              <span className="font-mono font-medium text-foreground">{customer.phoneMasked}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">예약 이력</span>
              <span className="font-medium text-foreground">예약 {customer.reservationCount}건</span>
            </div>
            {typeof customer.conversationCount === 'number' && customer.conversationCount > 0 ? (
              <div className="flex justify-between py-1">
                <span className="text-muted-foreground">연결 대화</span>
                <span className="font-medium text-foreground">대화 {customer.conversationCount}건</span>
              </div>
            ) : null}
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">마지막 예약</span>
              <span className="font-medium text-foreground">
                {formatBookingTime(customer.lastBookingStartsAt) || '없음'}
              </span>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          고객을 찾지 못했어요
        </section>
      )}

      {/* 카카오 알림톡 발송내역 섹션 */}
      <CanonicalCustomerKakaoHistory
        workspaceId={workspaceId}
        customerUuid={customerUuid}
      />

      <p className="px-1 text-xs leading-4 text-muted-foreground">
        이 화면은 읽기 전용이에요. 고객 정보를 바꾸거나 연락을 보내지 않아요.
      </p>
    </div>
  )
}

function CanonicalCustomerKakaoHistory({
  workspaceId,
  customerUuid,
}: Readonly<{ workspaceId: string; customerUuid: string }>) {
  const { items, load, refresh } = useCanonicalCustomerHistory({
    workspaceId,
    customerUuid,
  })

  return (
    <section
      aria-label="카카오 안내 발송내역"
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <h2 className="text-base font-semibold">카카오 안내 발송내역</h2>

      {load === 'loading' ? (
        <p className="py-2 text-center text-sm text-muted-foreground" aria-busy="true">
          발송내역을 불러오는 중이에요...
        </p>
      ) : null}

      {load === 'error' ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm font-medium text-destructive">발송내역을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
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
            <CanonicalHistoryItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function CanonicalHistoryItemRow({ item }: Readonly<{ item: KakaoHistoryItem }>) {
  const timeIso = item.status === 'SCHEDULED' ? item.dueAt : item.updatedAt || item.dueAt
  const formattedTime = formatKakaoHistoryTime(timeIso)
  const badgeStyle =
    KAKAO_STATUS_STYLES[item.status] ?? 'bg-secondary text-secondary-foreground border-transparent'

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
