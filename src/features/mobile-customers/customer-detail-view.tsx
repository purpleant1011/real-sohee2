'use client'

import Link from 'next/link'
import { StateView } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { contactCtas, displayName, listView, type MobileCustomerDto } from './customer-model'
import {
  CHANNEL_LABEL,
  CONSENT_LABEL,
  CustomerContactCtas,
  SEGMENT_LABEL,
  dateOnly,
  type CustomersViewSnapshot,
} from './customers-view'

/**
 * M17b 고객 상세(ANI-1664). 목록과 같은 스냅샷을 받아 한 사람만 그린다.
 *
 * 읽기 전용이다: 고객 정보를 바꾸는 버튼도, 연락을 실제로 보내는 경로도 없다.
 * 조회 실패를 '없는 고객'으로 바꾸지 않는다 — 목록을 끝까지 확인했을 때만 없다고 말한다.
 */
export function MobileCustomerDetailView({
  snapshot,
  customerId,
  readOnlyContacts = false,
}: Readonly<{ snapshot: CustomersViewSnapshot; customerId: string; readOnlyContacts?: boolean }>) {
  // 다른 가게 고객은 id 가 같아도 그리지 않는다(테넌트 격리).
  const scoped = snapshot.customers.filter(c => c.workspaceId === snapshot.workspaceId)
  const customer = scoped.find(c => c.id === customerId)
  const view = listView(snapshot.loadState, scoped, snapshot.complete, snapshot.offline === true)

  const backAction = (
    <Link
      href="/app/customers"
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors"
    >
      목록으로 돌아가기
    </Link>
  )

  if (!customer) {
    // 조회 중·실패·연결 끊김은 '없음'이 아니다. 상세 대신 목록 상태를 그대로 보여준다.
    if (view.kind === 'loading') {
      return <StateView kind="loading" checkedAt={snapshot.checkedAt} skeleton="detail" skeletonRows={3} />
    }
    if (view.kind === 'error' || view.kind === 'offline') {
      return <StateView kind={view.kind} checkedAt={snapshot.checkedAt} action={backAction} skeleton="detail" skeletonRows={3} />
    }
    // 목록을 끝까지 확인한 경우에만 없다고 단정한다. 일부만 확인했으면 '모른다'로 남긴다.
    const confirmed = view.kind === 'confirmed_empty' || view.kind === 'ready'
    return (
      <StateView
        kind={confirmed ? 'confirmed_empty' : 'partial'}
        checkedAt={snapshot.checkedAt}
        // '찾지 못했어요'는 끝까지 확인한 경우에만 쓴다. 일부만 본 상태에서 부재를 단정하지 않는다.
        title={confirmed ? '고객을 찾지 못했어요' : undefined}
        description={confirmed
          ? '이미 정리됐거나 지금은 볼 수 없는 고객이에요.'
          : '고객 정보를 모두 확인하지 못했어요. 잠시 뒤 다시 확인해 주세요.'}
        action={backAction}
      />
    )
  }

  return (
    <StateView kind={view.kind} checkedAt={snapshot.checkedAt}>
      <CustomerDetail customer={customer} readOnlyContacts={readOnlyContacts} />
    </StateView>
  )
}

export function customerDetailScreenConfig(): ShellScreenConfig {
  return { mode: 'DETAIL', title: '고객 상세', backHref: '/app/customers' }
}

function CustomerDetail({
  customer,
  readOnlyContacts,
}: Readonly<{ customer: MobileCustomerDto; readOnlyContacts: boolean }>) {
  const consent = customer.consent
  const contacts = contactCtas(customer)
  const enabled = contacts.filter(cta => cta.enabled)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 pt-1 text-foreground">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">{SEGMENT_LABEL[customer.segment]}</p>
        {/* 동의를 철회한 고객은 상세에서도 이름을 마스킹한다. */}
        <h1 className="break-words break-keep text-2xl font-semibold tracking-tight">{displayName(customer)}</h1>
      </header>

      <section aria-label="수신 동의" className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">수신 동의</h2>
        <p className="text-sm leading-5">{CONSENT_LABEL[consent.status]}</p>
        <p className="text-sm leading-5 text-muted-foreground">
          {consent.checkedAt && dateOnly(consent.checkedAt)
            ? `${dateOnly(consent.checkedAt)} 확인`
            : '확인한 날짜를 알 수 없어요'}
        </p>
      </section>

      <section aria-label="최근 진행" className="space-y-1.5 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">최근 진행</h2>
        {customer.lastAction ? (
          <>
            <p className="text-sm leading-5">{customer.lastAction.label}</p>
            <p className="text-sm leading-5 text-muted-foreground">
              {dateOnly(customer.lastAction.at) ?? '날짜를 확인하지 못했어요'}
            </p>
          </>
        ) : (
          <p className="text-sm leading-5 text-muted-foreground">최근 진행을 확인하지 못했어요</p>
        )}
        {customer.sourceLabel ? (
          <p className="text-xs leading-4 text-muted-foreground">기록 출처: {customer.sourceLabel}</p>
        ) : null}
      </section>

      <section aria-label="연락" className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">연락</h2>
          <p className="text-sm leading-5 text-muted-foreground">
            {customer.verifiedContacts.length > 0
              ? `확인된 연락처: ${customer.verifiedContacts.map(channel => CHANNEL_LABEL[channel]).join(', ')}`
              : '확인된 연락처가 없어요'}
          </p>
          <p className="text-sm leading-5 text-muted-foreground">
            {enabled.length > 0
              ? '수신 동의가 확인된 채널이에요.'
              : '수신 동의와 확인된 연락처가 모두 있어야 연락할 수 있어요.'}
          </p>
        </div>
        <CustomerContactCtas customer={customer} readOnlyContacts={readOnlyContacts} />
      </section>

      <p className="px-1 text-xs leading-4 text-muted-foreground">
        이 화면은 읽기 전용이에요. 고객 정보를 바꾸거나 연락을 보내지 않아요.
      </p>
    </div>
  )
}
