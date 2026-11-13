'use client'

import { CalendarDays, Inbox } from 'lucide-react'
import Link from 'next/link'
import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { authFailureStateKind, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { CanonicalCustomersSection, type CanonicalCustomersState } from './canonical-customers-section'
import { useCanonicalCustomers } from './use-canonical-customers'
import {
  contactCtas,
  displayName,
  listView,
  type ConsentStatus,
  type ContactChannel,
  type CustomerSegment,
  type MobileCustomerDto,
} from './customer-model'

/** 서버 DTO 를 그대로 받는 뷰 모델. 마스킹·연락 가능 판정은 전부 customer-model 이 담당한다. */
export interface CustomersViewSnapshot {
  loadState: LoadState
  customers: MobileCustomerDto[]
  workspaceId: string
  /** 서버가 목록 전체를 확인했는지. false 면 빈 목록을 '고객 없음'으로 단정하지 않는다. */
  complete: boolean
  checkedAt: string | null
  /**
   * 서버가 인증(401)·권한(403)을 거부한 경우(ANI-1714). '다시 확인'으로 풀리는 실패가 아니므로
   * 일반 조회 실패(error)와 구분해 보여준다. 401 이면 '로그인 만료', 403 이면 '권한 없음'이다.
   */
  authFailure?: AuthFailure
  /**
   * 브라우저가 연결 없음을 확인한 상태(ANI-1695). 조회 실패와 구분해 '네트워크에 연결할 수 없습니다'로
   * 보여준다. 서버가 응답한 401/403 은 연결이 살아 있다는 증거이므로 이 값보다 인증 거부를 먼저 쓴다.
   */
  offline?: boolean
}

/** 목록과 상세가 같은 문구를 쓰도록 한 곳에 둔다. 내부 코드명은 화면에 내보내지 않는다. */
export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  inquiring: '문의 중',
  upcoming: '예약 예정',
  visited: '방문 완료',
  revisit: '재방문',
}

export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  granted: '수신 동의 확인됨',
  withdrawn: '수신 동의 철회',
  unknown: '수신 동의 미확인',
}

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  phone: '전화',
  message: '문자',
}

const CTA_BASE = 'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium'

/** M17 고객. 화면은 라우터/데이터 조회를 모르고 DTO 만 받는다. */
export function MobileCustomersView({
  snapshot,
  readOnlyContacts = false,
  onRetry,
  canonicalState: externalCanonicalState,
}: Readonly<{
  snapshot: CustomersViewSnapshot
  readOnlyContacts?: boolean
  onRetry?: () => void
  canonicalState?: CanonicalCustomersState
}>) {
  // canonicalState 가 주어지면 중복 fetch 방지를 위해 workspaceId 를 빈 문자열로 넘긴다.
  const internalCanonical = useCanonicalCustomers({
    workspaceId: externalCanonicalState ? '' : snapshot.workspaceId,
  })
  const canonical = externalCanonicalState ?? internalCanonical

  const handleRetry = () => {
    canonical.refresh()
    onRetry?.()
  }

  const scoped = snapshot.customers.filter(c => c.workspaceId === snapshot.workspaceId)
  const view = listView(snapshot.loadState, scoped, snapshot.complete, snapshot.offline === true)
  // 인증·권한 거부는 '고객 없음'도 '일시적 조회 실패'도 아니다. 다시 확인해도 풀리지 않는다.
  // 서버 응답이 있었다는 뜻이므로 오프라인 표시보다 먼저 쓴다.
  const chatKind: StateKind = snapshot.authFailure ? authFailureStateKind(snapshot.authFailure) : view.kind

  // 대화 목록과 예약 고객 목록이 모두 확인되었고 둘 다 0건일 때만 '등록된 고객이 없어요'를 단정한다.
  const isBothEmpty = chatKind === 'confirmed_empty' && canonical.load === 'ready' && canonical.items.length === 0

  // 예약 고객이 아직 로딩 중이거나, 에러이거나, 1건 이상이면 '등록된 고객이 없어요'를 띄우지 않고 ready(빈 대화 목록)로 처리한다.
  let effectiveKind: StateKind = chatKind
  if (chatKind === 'confirmed_empty' && !isBothEmpty) {
    effectiveKind = 'ready'
  }

  // 전체 화면 차단 상태: 인증 거부, 오프라인, 대화 고객 조회 에러, 대화 고객 로딩 중
  const isBlockingState = snapshot.authFailure !== undefined || chatKind === 'error' || chatKind === 'offline' || chatKind === 'loading'

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">고객</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          우리 매장을 찾아온 단골과 예약 손님을 한곳에 모아드려요.
        </p>
      </header>

      <nav aria-label="고객 응대 바로가기" className="grid grid-cols-2 gap-2.5">
        <Link prefetch={false} href="/app/engagement" className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 text-[15px] font-semibold shadow-xs active:bg-muted">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Inbox className="size-5" aria-hidden="true" /></span>소통함
        </Link>
        <Link prefetch={false} href="/app/schedule" className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-border bg-card px-3.5 text-[15px] font-semibold shadow-xs active:bg-muted">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-5" aria-hidden="true" /></span>예약 일정
        </Link>
      </nav>

      {!isBlockingState ? (
        <CanonicalCustomersSection
          workspaceId={snapshot.workspaceId}
          canonicalState={canonical}
          hideWhenEmpty={isBothEmpty}
        />
      ) : null}

      <StateView
        kind={effectiveKind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={4}
        action={
          effectiveKind === 'confirmed_empty' ? (
            <div className="flex flex-col items-center gap-2 pt-1 text-center">
              <Link
                prefetch={false}
                href="/app/engagement"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-xs active:bg-primary/90"
              >
                소통함 열기
              </Link>
              <p className="text-xs leading-5 text-muted-foreground">
                예약이나 문의가 들어오면 자동으로 손님이 등록돼요.
              </p>
            </div>
          ) : onRetry && !snapshot.authFailure && (effectiveKind === 'error' || effectiveKind === 'offline') ? (
            <button type="button" onClick={handleRetry} className={`${CTA_BASE} bg-secondary text-secondary-foreground`}>다시 확인하기</button>
          ) : undefined
        }
        title={effectiveKind === 'confirmed_empty' ? '등록된 고객이 없어요' : undefined}
        description={effectiveKind === 'confirmed_empty' ? '문의 주신 손님은 소통함에서 볼 수 있어요' : undefined}
      >
        {scoped.length > 0 ? (
          <ul aria-label="고객 목록" className="space-y-3">
            {scoped.map(customer => (
              <CustomerCard key={customer.id} customer={customer} readOnlyContacts={readOnlyContacts} />
            ))}
          </ul>
        ) : null}
      </StateView>
    </div>
  )
}

export function customersScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '고객' }
}

/**
 * 연락 CTA. 목록과 상세가 같은 판정(contactCtas)을 쓰도록 한 곳에 둔다.
 *
 * 기본값은 origin/main 과 같은 렌더다 — 버튼 활성 여부는 서버 근거(동의·검증된 연락처)만 따르고,
 * 핸들러가 없다는 이유로 막거나 사유를 덧붙이지 않는다. 그래야 이 컴포넌트를 이미 쓰는 화면이
 * 이 변경으로 달라지지 않는다.
 *
 * readOnlyContacts 를 켠 화면(모바일 R2 셸)에서만 전송 경로가 없을 때 버튼을 막고 사유를 보여준다.
 */
export function CustomerContactCtas({
  customer,
  onContact,
  readOnlyContacts = false,
}: Readonly<{
  customer: MobileCustomerDto
  onContact?: (channel: ContactChannel) => void
  readOnlyContacts?: boolean
}>) {
  const ctas = contactCtas(customer)
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {ctas.map(cta => {
        // 조건을 만족해도 실제 전송 경로가 없으면 비활성이다 — 단, readOnlyContacts 를 켠 화면에서만.
        const interactive = cta.enabled && onContact !== undefined
        const disabled = readOnlyContacts ? !interactive : !cta.enabled
        const onClick = interactive ? () => onContact(cta.channel) : undefined
        const reason = cta.reason ?? (readOnlyContacts && !interactive ? '읽기 전용 화면이라 연락을 보낼 수 없어요' : null)
        return (
          <div key={cta.channel} className="flex flex-col gap-1">
            <button
              type="button"
              disabled={disabled}
              aria-disabled={disabled}
              onClick={onClick}
              className={
                disabled
                  ? `${CTA_BASE} bg-muted text-muted-foreground`
                  : `${CTA_BASE} bg-primary text-primary-foreground`
              }
            >
              {CHANNEL_LABEL[cta.channel]}로 연락
            </button>
            {reason ? (
              <span className="text-xs leading-4 text-muted-foreground">{reason}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function CustomerCard({
  customer,
  readOnlyContacts = false,
}: Readonly<{ customer: MobileCustomerDto; readOnlyContacts?: boolean }>) {
  const consent = customer.consent

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* 동의를 철회한 고객은 목록에서도 이름을 마스킹한다. */}
          <p className="truncate break-keep text-base font-semibold">{displayName(customer)}</p>
          <p className="text-sm leading-5 text-muted-foreground">
            {CONSENT_LABEL[consent.status]}
            {/* 날짜를 확인하지 못하면 그 부분만 생략한다. '· 확인' 같은 빈 표시를 남기지 않는다. */}
            {consent.checkedAt && dateOnly(consent.checkedAt)
              ? ` · ${dateOnly(consent.checkedAt)} 확인`
              : ''}
          </p>
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2.5 py-1 text-xs font-medium leading-none text-secondary-foreground">
          {SEGMENT_LABEL[customer.segment]}
        </span>
      </div>

      {customer.lastAction ? (
        <p className="break-keep text-sm leading-5 text-muted-foreground">
          {customer.lastAction.label}
          {dateOnly(customer.lastAction.at) ? ` · ${dateOnly(customer.lastAction.at)}` : ''}
        </p>
      ) : (
        <p className="break-keep text-sm leading-5 text-muted-foreground">최근 진행을 확인하지 못했어요</p>
      )}

      {customer.sourceLabel ? (
        <p className="text-xs leading-4 text-muted-foreground">기록 출처: {customer.sourceLabel}</p>
      ) : null}

      <CustomerContactCtas customer={customer} readOnlyContacts={readOnlyContacts} />

      {/* 상세는 읽기 전용 화면이다. 손가락으로 누를 수 있는 폭(44px)을 카드 전체에 준다. */}
      <Link
        prefetch={false}
        href={`/app/customers/${encodeURIComponent(customer.id)}`}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border px-3.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
      >
        자세히 보기
      </Link>
    </li>
  )
}

/**
 * 날짜만 보여준다. 값이 날짜가 아니면 null — 깨진 문자열을 화면에 그대로 내보내지 않는다.
 * `slice(0, 10)` 만 쓰면 'abc-def-ghi' 가 'abc-def-gh' 로 잘려 날짜처럼 보인다.
 */
export function dateOnly(iso: string): string | null {
  const at = Date.parse(iso)
  return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10)
}
