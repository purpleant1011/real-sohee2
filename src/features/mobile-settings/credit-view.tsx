'use client'

import { StateView, type StateKind } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import { authFailureStateKind, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { canSpend, LEDGER_LABEL, type CreditLedger } from './credit-model'

/**
 * M16 이용 현황. 잔액/수치를 직접 노출하지 않고 이용 가능 상태만 안내한다.
 * 소희 이용 요금과 고객 예약금은 별도 원장이며 어떤 경우에도 합산하지 않는다.
 */
export interface CreditViewSnapshot {
  loadState: LoadState
  /** 실행 가능 판정의 근거가 되는 소희 이용 크레딧 원장. */
  credit: CreditLedger
  /** 고객 예약금 원장. 확인하지 못했으면 null. */
  customerDeposit: CreditLedger | null
  /** 이번 실행의 예상 비용. 미확인이면 null 이고 실행을 막는다. */
  estimate: number | null
  checkedAt: string | null
  /**
   * 서버가 인증(401)·권한(403)을 거부해 원장을 읽지 못한 경우(ANI-1714).
   * '잔액 0'도 '일시적 조회 실패'도 아니므로 따로 알린다.
   */
  authFailure?: AuthFailure
}

const LIMIT_REACHED_MESSAGE =
  '이용 한도에 도달했어요 — 이번 주기의 이용 한도를 모두 사용했어요. 다음 갱신 주기에 다시 이용할 수 있어요. 더 많은 작업이 필요하면 플랜 변경을 문의해 주세요.'

export function MobileCreditView({ snapshot }: { snapshot: CreditViewSnapshot }) {
  const kind: StateKind = snapshot.authFailure
    ? authFailureStateKind(snapshot.authFailure)
    : viewKind(snapshot.loadState)
  const decision = canSpend(snapshot.credit, snapshot.estimate)
  const isLimitReached = !decision.allowed && decision.reason === 'insufficient'
  const isUnknown = snapshot.credit.available === null

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-1 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">이용 현황</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          현재 서비스 이용 및 작업 실행 상태를 확인해요.
        </p>
      </header>

      <StateView
        kind={kind}
        checkedAt={snapshot.checkedAt}
        skeleton="detail"
        title={kind === 'error' ? '이용 상태를 확인하지 못했어요' : undefined}
        description={kind === 'error' ? '잔액이 없는 것이 아니라, 확인에 실패한 상태예요. 다시 확인해 주세요.' : undefined}
      >
        <section aria-labelledby="credit-balance" className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 id="credit-balance" className="text-base font-semibold">
            {LEDGER_LABEL.subscription}
          </h2>
          {isUnknown ? (
            <p className="text-sm leading-5 text-muted-foreground">이용 상태를 확인하지 못했어요</p>
          ) : isLimitReached ? (
            <p className="text-sm leading-5 text-destructive font-medium">{LIMIT_REACHED_MESSAGE}</p>
          ) : (
            <p className="text-sm leading-5 text-foreground font-medium">정상 이용 중</p>
          )}
        </section>

        <section aria-labelledby="credit-decision" className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <h2 id="credit-decision" className="text-base font-semibold">
            지금 실행할 수 있을까요?
          </h2>
          {decision.allowed ? (
            <p className="text-sm font-medium leading-5">지금 실행할 수 있어요</p>
          ) : isLimitReached ? (
            <div className="space-y-1">
              <p className="text-sm font-medium leading-5">{LIMIT_REACHED_MESSAGE}</p>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-sm font-medium leading-5">{decision.message}</p>
              <p className="text-sm leading-5 text-muted-foreground">{decision.next}</p>
            </div>
          )}
        </section>

        <section aria-labelledby="credit-deposit" className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 id="credit-deposit" className="text-base font-semibold">
            {LEDGER_LABEL.customer_deposit}
          </h2>
          {snapshot.customerDeposit === null ? (
            <p className="text-sm leading-5 text-muted-foreground">예약금 현황을 확인하지 못했어요</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm leading-5">
                <LedgerRow label="받은 예약금" value={snapshot.customerDeposit.available} unit="원" />
                <LedgerRow label="환불 완료" value={snapshot.customerDeposit.refunded} unit="원" />
              </dl>
              <p className="text-xs leading-4 text-muted-foreground">
                고객 예약금은 소희 이용 크레딧과 따로 관리돼요.
              </p>
            </>
          )}
        </section>
      </StateView>
    </div>
  )
}

export function creditScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '이용 현황' }
}

function viewKind(state: LoadState): 'loading' | 'ready' | 'error' | 'stale' {
  if (state === 'loading') return 'loading'
  if (state === 'error' || state === 'unknown') return 'error'
  if (state === 'stale') return 'stale'
  return 'ready'
}

function formatAmount(value: number, unit: '원'): string {
  return `${value.toLocaleString('ko-KR')}${unit}`
}

function LedgerRow({ label, value, unit }: { label: string; value: number | null; unit: '원' }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value === null ? '확인하지 못했어요' : formatAmount(value, unit)}</dd>
    </div>
  )
}
