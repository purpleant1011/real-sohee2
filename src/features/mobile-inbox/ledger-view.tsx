'use client'

import { useEffect, useMemo, useState } from 'react'
import { StateView } from '@/components/mobile-ui'
import type { ShellScreenConfig } from '@/features/mobile-shell'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { listView } from '@/features/mobile-customers/customer-model'
import { useKakaoHistory } from '@/features/kakao/history/use-kakao-history'
import type { KakaoHistoryItem } from '@/features/kakao/history/contract'
import { KAKAO_STATUS_STYLES } from '@/features/mobile-customers/kakao-history-section'
import { cn } from '@/lib/utils'
import {
  DISPLAY_LABEL, SOURCE_LABEL, dayKey, entryDisplay, findConflicts, groupByDay, isMismatch, isStale,
  type LedgerEntryDto,
} from './ledger-model'
import { MobileReservationSheet } from './reservation-sheet'
import { MobileReservationManageSheet, type ManageReservationTarget } from './reservation-manage-sheet'
import { CopyBookingRequestLinkButton } from '@/features/booking-request/copy-booking-request-link'

export interface LedgerViewSnapshot {
  loadState: LoadState
  entries: LedgerEntryDto[]
  workspaceId: string
  timeZone: string
  /** 화면 기준 '지금'. 서버 시각을 받아 쓴다(테스트·프리뷰 고정용). */
  now: string
  complete: boolean
  checkedAt: string | null
}

export interface LedgerViewProps {
  snapshot: LedgerViewSnapshot
  onRefresh?: () => void
}

export function ledgerScreenConfig(): ShellScreenConfig {
  return { mode: 'BROWSE', title: '예약표' }
}

type Range = 'today' | 'week'
const BTN = 'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium'

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** M15 예약 장부. 사장님이 직접 예약을 등록할 수 있으며, 확정된 예약 목록을 확인한다. */
export function MobileLedgerView({ snapshot, onRefresh }: LedgerViewProps) {
  const [range, setRange] = useState<Range>('today')
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [manageTarget, setManageTarget] = useState<ManageReservationTarget | null>(null)
  const [isManageSheetOpen, setIsManageSheetOpen] = useState(false)

  // 취소된 예약은 화면 목록에서 숨긴다.
  const activeEntries = useMemo(
    () => snapshot.entries.filter(e => e.status !== 'cancelled'),
    [snapshot.entries]
  )

  // 서버 시각(snapshot.now)이 기준이고, 화면을 연 뒤 흐른 시간을 클라이언트에서 더한다.
  // 다시 조회하지 않아도 확인 시각이 오래되면 stale 이 드러나게 하기 위해서다.
  // 서버 시각 문자열이 깨졌으면 지금 시각을 지어내지 않고(렌더는 순수해야 한다) 모르는 채로 둔다.
  const baseMs = Date.parse(snapshot.now)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 60_000)
    return () => clearInterval(timer)
  }, [])
  const nowMs = baseMs + elapsed
  const now = new Date(nowMs)
  const today = dayKey(snapshot.now, snapshot.timeZone) ?? ''
  const to = range === 'today' ? today : addDays(today, 6)
  const { days, unreadable } = groupByDay(activeEntries, snapshot.workspaceId, snapshot.timeZone, today, to)
  const shown = days.flatMap(d => d.entries)
  // 지금 보이는 기간의 예약끼리만 충돌을 판정한다(안 보이는 예약 때문에 경고가 뜨지 않게).
  const conflicts = findConflicts(shown, snapshot.workspaceId)

  // 로드는 ready 인데 확인 시각이 오래됐으면 stale 로 본다. 지금 시각을 못 믿으면
  // '최신'이라고 말하지 않고 stale 로 내린다(fail-closed).
  const state: LoadState = snapshot.loadState === 'ready' && (Number.isNaN(nowMs) || isStale(snapshot.checkedAt, now))
    ? 'stale'
    : snapshot.loadState
  const view = listView(state, shown.length + unreadable.length ? [1] : [], snapshot.complete)

  // 사장님용 알림톡 발송내역: 워크스페이스 단위 1회 호출 후 reservationId별 최신 매핑
  // 예시 화면(preview-*)에서는 불필요한 fetch를 보내지 않는다(fail-closed / 프로토타입 격리).
  const isPreview = snapshot.workspaceId.startsWith('preview-')
  const { items: kakaoItems } = useKakaoHistory({
    workspaceId: isPreview ? '' : snapshot.workspaceId,
  })
  const latestKakaoMap = useMemo(() => {
    const map = new Map<string, KakaoHistoryItem>()
    for (const item of kakaoItems) {
      if (!item.reservationId) continue
      const prev = map.get(item.reservationId)
      if (!prev) {
        map.set(item.reservationId, item)
        continue
      }
      const prevTime = Date.parse(prev.updatedAt || prev.dueAt) || 0
      const currTime = Date.parse(item.updatedAt || item.dueAt) || 0
      if (currTime >= prevTime) {
        map.set(item.reservationId, item)
      }
    }
    return map
  }, [kakaoItems])

  const handleOpenManage = (e: LedgerEntryDto) => {
    setManageTarget({
      id: e.id,
      customerName: e.customerName,
      serviceLabel: e.serviceLabel,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      status: e.status,
    })
    setIsManageSheetOpen(true)
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-6 text-foreground">
      <header className="space-y-2 pt-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">예약표</h1>
          <div className="flex items-center gap-2">
            <CopyBookingRequestLinkButton
              workspaceId={snapshot.workspaceId}
              label="신청 링크 복사"
            />
            <button
              type="button"
              onClick={() => setIsSheetOpen(true)}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              예약 등록
            </button>
          </div>
        </div>
        <p className="text-base leading-relaxed text-muted-foreground">
          예약표에서 다시 읽어 확인된 예약만 &lsquo;확정&rsquo;으로 보여드려요.
        </p>
      </header>

      <div role="group" aria-label="기간 고르기" className="flex gap-2">
        {(['today', 'week'] as const).map(r => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`${BTN} ${range === r ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
          >
            {r === 'today' ? '오늘' : '이번 주'}
          </button>
        ))}
        <button type="button" className={`${BTN} ml-auto bg-muted text-foreground`} onClick={() => onRefresh?.()}>
          새로 확인
        </button>
      </div>

      {/* destructive 10% 틴트는 --muted 바탕 위에서 4.4:1 로 미달(W9 axe). R2 상태 토큰은
          불투명 바탕이라 상위 표면과 무관하게 7.1:1(라이트)·8.4:1(다크)을 유지한다. */}
      {conflicts.size > 0 ? (
        <p role="alert" className="rounded-xl bg-state-danger-soft px-3 py-2 text-sm leading-5 text-state-danger">
          같은 시간에 겹친 예약이 있어요. 한 시간에는 하나만 확정할 수 있어서 직접 확인이 필요해요.
        </p>
      ) : null}

      <StateView
        kind={view.kind}
        checkedAt={snapshot.checkedAt}
        skeleton="list"
        skeletonRows={4}
        title={view.kind === 'confirmed_empty' ? (range === 'today' ? '오늘 예약이 없어요' : '이번 주 예약이 없어요') : undefined}
        description={view.kind === 'confirmed_empty' ? '예약표를 확인해 보니 이 기간에 잡힌 예약이 없습니다.' : undefined}
      >
        <div className="space-y-5">
          {days.map(d => (
            <section key={d.date} aria-label={`${d.date} 예약`} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{formatDay(d.date)}</h2>
              <ul className="space-y-2">
                {d.entries.map(e => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    timeZone={snapshot.timeZone}
                    conflict={conflicts.has(e.id)}
                    kakaoItem={latestKakaoMap.get(e.id)}
                    onManage={handleOpenManage}
                    isPreview={isPreview}
                  />
                ))}
              </ul>
            </section>
          ))}
          {unreadable.length > 0 ? (
            <section aria-label="시각 확인 못한 예약" className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">시각을 확인하지 못했어요</h2>
              <ul className="space-y-2">
                {unreadable.map(e => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    timeZone={snapshot.timeZone}
                    conflict={false}
                    kakaoItem={latestKakaoMap.get(e.id)}
                    onManage={handleOpenManage}
                    isPreview={isPreview}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </StateView>

      <MobileReservationSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        workspaceId={snapshot.workspaceId}
        onSuccess={onRefresh}
      />

      <MobileReservationManageSheet
        open={isManageSheetOpen}
        onOpenChange={setIsManageSheetOpen}
        workspaceId={snapshot.workspaceId}
        reservation={manageTarget}
        onDone={onRefresh}
      />
    </div>
  )
}

function EntryRow({
  entry,
  timeZone,
  conflict,
  kakaoItem,
  onManage,
  isPreview,
}: {
  entry: LedgerEntryDto
  timeZone: string
  conflict: boolean
  kakaoItem?: KakaoHistoryItem
  onManage?: (entry: LedgerEntryDto) => void
  isPreview?: boolean
}) {
  const display = entryDisplay(entry)
  const mismatch = isMismatch(entry)
  return (
    <li className="space-y-1 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold">{formatTimeRange(entry, timeZone)}</p>
        <div className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {DISPLAY_LABEL[display]}
          </span>
          {entry.status === 'confirmed' || entry.status === 'pending_confirmation' ? (
            <button
              type="button"
              disabled={isPreview}
              onClick={() => onManage?.(entry)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-input bg-background px-3 text-xs font-semibold text-foreground shadow-2xs transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              관리
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-base leading-6">{entry.customerName} · {entry.serviceLabel}</p>
      <p className="text-xs leading-4 text-muted-foreground">기록 출처: {SOURCE_LABEL[entry.source]}</p>
      {kakaoItem ? (
        <div className="pt-0.5">
          <span
            className={cn(
              'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
              KAKAO_STATUS_STYLES[kakaoItem.status] ?? 'bg-secondary text-secondary-foreground border-transparent',
            )}
          >
            알림톡 {kakaoItem.statusLabel}
          </span>
        </div>
      ) : null}
      {conflict ? <p className="text-xs leading-4 text-destructive">같은 시간에 다른 예약과 겹쳐요</p> : null}
      {mismatch ? <p className="text-xs leading-4 text-destructive">다른 화면과 상태가 달라요. 새로 확인해 주세요</p> : null}
    </li>
  )
}

function formatDay(key: string): string {
  const d = new Date(`${key}T00:00:00Z`)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(d)
}

function hhmm(iso: string, timeZone: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('ko-KR', { timeZone, hour: 'numeric', minute: '2-digit', hour12: false }).format(d)
}

function formatTimeRange(e: LedgerEntryDto, timeZone: string): string {
  const s = hhmm(e.startsAt, timeZone)
  const t = hhmm(e.endsAt, timeZone)
  return s && t ? `${s} – ${t}` : '시각 확인 못함'
}
