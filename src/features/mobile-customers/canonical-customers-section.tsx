'use client'

import Link from 'next/link'
import type { CanonicalCustomerItem } from '@/features/customers/canonical-contract'
import { useCanonicalCustomers, type CanonicalCustomersLoad } from './use-canonical-customers'

export interface CanonicalCustomersState {
  items: CanonicalCustomerItem[]
  load: CanonicalCustomersLoad
  refresh: () => void
}

export interface CanonicalCustomersSectionProps {
  workspaceId: string
  canonicalState?: CanonicalCustomersState
  hideWhenEmpty?: boolean
}

/**
 * KST (UTC+9) 기준 'YYYY년 M월 D일 H:MM' 포맷터.
 * 순수 Date 연산으로 타임존 독립적(Fail-closed) 동작.
 */
export function formatBookingTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return ''
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return ''

  // KST: UTC+9
  const kst = new Date(parsed + 9 * 60 * 60 * 1000)
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth() + 1
  const day = kst.getUTCDate()
  const hours = kst.getUTCHours()
  const minutes = String(kst.getUTCMinutes()).padStart(2, '0')

  return `${year}년 ${month}월 ${day}일 ${hours}:${minutes}`
}

/**
 * 번호 기준 정본 고객 '예약 고객' 목록 섹션.
 *
 * [모바일 R2 UI 규칙]
 * - 390px 반응형 및 최소 44px 터치 타겟 준수
 * - 조회 실패(error)를 빈 목록(0건)으로 치환 금지 (에러 + 다시 시도 버튼)
 * - 전화번호는 phoneMasked 만 노출 (원문 PII 노출 금지)
 */
export function CanonicalCustomersSection({
  workspaceId,
  canonicalState,
  hideWhenEmpty = false,
}: Readonly<CanonicalCustomersSectionProps>) {
  // canonicalState 가 전달되면 불필요한 fetch 를 막기 위해 workspaceId 를 빈 문자열로 넘겨 훅의 내부 fetch 를 bypass 한다.
  const internalState = useCanonicalCustomers({ workspaceId: canonicalState ? '' : workspaceId })
  const { items, load, refresh } = canonicalState ?? internalState

  if (hideWhenEmpty && load === 'ready' && items.length === 0) {
    return null
  }

  return (
    <section aria-label="예약 고객 목록" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">예약 고객</h2>
        {load === 'ready' && items.length > 0 ? (
          <span className="text-xs font-medium text-muted-foreground">{items.length}명</span>
        ) : null}
      </div>

      {load === 'loading' ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          예약 고객 목록을 불러오는 중이에요...
        </div>
      ) : null}

      {load === 'error' ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-medium text-destructive">예약 고객을 불러오지 못했어요</p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted active:bg-muted"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {load === 'ready' && items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          아직 등록된 예약 고객이 없어요
        </div>
      ) : null}

      {load === 'ready' && items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((customer) => (
            <CanonicalCustomerCard key={customer.id} customer={customer} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function CanonicalCustomerCard({ customer }: Readonly<{ customer: CanonicalCustomerItem }>) {
  const formattedBooking = formatBookingTime(customer.lastBookingStartsAt)

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate break-keep text-base font-semibold text-foreground">
            {customer.displayName || '이름 없음'}
          </p>
          <p className="text-sm font-mono text-muted-foreground">{customer.phoneMasked}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="whitespace-nowrap rounded-full bg-secondary px-2.5 py-1 text-xs font-medium leading-none text-secondary-foreground">
            예약 {customer.reservationCount}건
          </span>
          {typeof customer.conversationCount === 'number' && customer.conversationCount > 0 ? (
            <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
              대화 {customer.conversationCount}건
            </span>
          ) : null}
        </div>
      </div>

      {formattedBooking ? (
        <p className="text-xs text-muted-foreground">마지막 예약: {formattedBooking}</p>
      ) : (
        <p className="text-xs text-muted-foreground">마지막 예약 일시 없음</p>
      )}

      <Link
        prefetch={false}
        href={`/app/customers/person/${encodeURIComponent(customer.id)}`}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        자세히 보기
      </Link>
    </li>
  )
}
