'use client'

import { CreditCard, RefreshCw } from 'lucide-react'
import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import {
  chargeGuard,
  depositListItem,
  depositView,
  type DepositRecord,
  type DepositView,
  type ProviderAccepted,
  type ReadbackState,
  type TransportState,
} from './deposit-model'

/** 서버 DTO 를 그대로 받는 뷰 모델. 결제 판정(visible/confirmedPaid/tone)은 전부 deposit-model 이 담당한다. */
export interface DepositsViewSnapshot {
  loadState: LoadState
  deposits: readonly DepositRecord[]
  checkedAt: string | null
}

const TONE_CLASS: Record<DepositView['tone'], string> = {
  neutral: 'text-foreground',
  positive: 'text-state-ok',
  warning: 'text-state-warn',
  danger: 'text-state-danger',
}

/** 내부 상태 코드 대신 사장님이 읽는 문구만 준다. */
const TRANSPORT_LABEL: Record<TransportState, string> = {
  not_started: '아직 결제 화면을 열지 않았어요',
  redirected: '결제사 화면에서 진행 중이에요',
  returned_success: '결제 화면에서 돌아왔어요',
  returned_fail: '결제가 되지 않은 채 돌아왔어요',
  returned_cancel: '결제를 취소하고 돌아왔어요',
}

const PROVIDER_LABEL: Record<ProviderAccepted, string> = {
  accepted: '결제사 승인 응답을 받았어요',
  rejected: '결제사가 승인하지 않았어요',
  unknown: '결제사 응답을 확인하지 못했어요',
}

const READBACK_LABEL: Record<ReadbackState, string> = {
  pending: '서버 확인 전',
  verified: '서버에서 확인 완료',
  not_verified: '서버에서 확인하지 못함',
  unavailable: '서버 확인 불가',
}

const CTA_BASE = 'inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium'

/** M16 예약금. 화면은 결제를 실행하지 않고, 라우터가 넘긴 콜백만 부른다. */
export function MobileDepositsView({
  snapshot,
  onCharge,
}: {
  snapshot: DepositsViewSnapshot
  onCharge: (record: DepositRecord) => void
}) {
  const rows = snapshot.deposits
    .map(record => ({ record, view: depositView(record) }))
    .filter(row => row.view.visible)
  const kind = stateKind(snapshot, rows.length)

  // 예약금을 쓰지 않는 매장은 화면 자체를 숨긴다. 설정을 확인하지 못한 경우(unknown)는 숨기지 않는다.
  const allUnsupported =
    snapshot.loadState === 'ready' &&
    snapshot.deposits.length > 0 &&
    snapshot.deposits.every(record => record.availability === 'not_supported')
  if (allUnsupported) return null

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">예약금</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          서버 영수증까지 확인된 건만 결제된 것으로 표시해요. 결제사 화면에서 돌아온 것만으로는 완료로 보지 않아요.
        </p>
      </header>

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={3}
        title={kind === 'confirmed_empty' ? '예약금 내역이 없어요' : undefined}
        description={kind === 'confirmed_empty' ? '확인해 보니 이 가게의 예약금 내역이 없습니다.' : undefined}
      >
        <ul aria-label="예약금 내역" className="space-y-3">
          {rows.map(row => (
            <DepositCard key={`${row.record.workspaceId}:${row.record.bookingId}`} record={row.record} view={row.view} onCharge={onCharge} />
          ))}
        </ul>
        <p className="pt-2 text-xs leading-relaxed text-muted-foreground">
          결제 확인과 환불 확인은 결제사가 아니라 서버 영수증으로 판단해요.
        </p>
      </StateView>
    </div>
  )
}

function DepositCard({
  record,
  view,
  onCharge,
}: {
  record: DepositRecord
  view: DepositView
  onCharge: (record: DepositRecord) => void
}) {
  const guard = chargeGuard(record)
  const amountLabel = depositListItem(record)?.amountLabel ?? null
  const showStages =
    record.transport !== 'not_started' ||
    record.providerAccepted !== null ||
    record.readback !== 'pending'
  const reasonId = `deposit-reason-${record.workspaceId}-${record.bookingId}`
  // 이미 확인된 건과 미지원 매장은 다시 결제 버튼을 보여주지 않는다.
  const showButton = guard.allowed === false && guard.reason !== 'already_paid' && guard.reason !== 'unsupported'
  // 카드 본문에 이미 같은 문구가 있으면 사유 줄에서 한 번 더 반복하지 않는다.
  const reasonParts =
    guard.allowed === false
      ? [
          guard.message !== view.label && guard.message !== view.detail ? guard.message : null,
          guard.next && guard.next !== view.next ? guard.next : null,
        ].filter((part): part is string => part !== null)
      : []

  return (
    <li className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div className="space-y-0.5">
        <p className={`text-base font-semibold ${TONE_CLASS[view.tone]}`}>{view.label}</p>
        {view.detail ? <p className="text-sm leading-5 text-muted-foreground">{view.detail}</p> : null}
        {/* 확인 전 금액은 매출이 아니라 결제 예정 금액이다. */}
        {amountLabel && !view.confirmedPaid ? (
          <p className="text-sm leading-5 text-muted-foreground">결제 예정 금액 {amountLabel}</p>
        ) : null}
        {view.next ? <p className="text-sm leading-5 text-muted-foreground">{view.next}</p> : null}
      </div>

      {showStages ? (
        <dl className="space-y-1 rounded-xl bg-muted/40 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-foreground">결제 화면</dt>
            <dd className="min-w-0">{TRANSPORT_LABEL[record.transport]}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-foreground">결제사 응답</dt>
            <dd className="min-w-0">{record.providerAccepted ? PROVIDER_LABEL[record.providerAccepted] : '아직 받지 않았어요'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-medium text-foreground">서버 확인</dt>
            <dd className="min-w-0">{READBACK_LABEL[record.readback]}</dd>
          </div>
        </dl>
      ) : null}

      {guard.allowed ? (
        <button
          type="button"
          onClick={() => onCharge(record)}
          className={`${CTA_BASE} bg-primary text-primary-foreground`}
        >
          <CreditCard aria-hidden className="size-4" />
          예약금 결제하기
        </button>
      ) : showButton ? (
        <div className="space-y-1">
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-describedby={reasonParts.length > 0 ? reasonId : undefined}
            className={`${CTA_BASE} bg-muted text-muted-foreground`}
          >
            <CreditCard aria-hidden className="size-4" />
            예약금 결제하기
          </button>
          {reasonParts.length > 0 ? (
            <p id={reasonId} className="text-sm leading-5 text-muted-foreground">
              {reasonParts.join(' · ')}
            </p>
          ) : null}
        </div>
      ) : guard.allowed === false && guard.reason === 'already_paid' ? (
        <p className="inline-flex items-center gap-1.5 text-sm text-state-ok">
          <RefreshCw aria-hidden className="size-4" />
          {guard.message}
        </p>
      ) : null}
    </li>
  )
}

function stateKind(snapshot: DepositsViewSnapshot, visibleCount: number): StateKind {
  if (snapshot.loadState === 'loading') return 'loading'
  if (snapshot.loadState === 'stale') return 'stale'
  if (snapshot.loadState === 'error' || snapshot.loadState === 'unknown') return 'error'
  if (visibleCount === 0) return 'confirmed_empty'
  return 'ready'
}

export function depositsScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '예약금' }
}
