export type LedgerStatus = 'confirmed' | 'pending_confirmation' | 'completed' | 'cancelled'
export type LedgerSource = 'owner_confirmed' | 'customer_accepted' | 'ledger_event' | 'unverified'

export interface LedgerEntryDto {
  id: string
  workspaceId: string
  customerName: string
  serviceLabel: string
  startsAt: string
  endsAt: string
  status: LedgerStatus
  /** 이 예약을 만든 근거. 'unverified' 는 근거를 확인하지 못한 것. */
  source: LedgerSource
  /** 예약표(원장)에서 마지막으로 다시 읽어 확인한 시각. 없으면 확인 전. */
  ledgerVerifiedAt: string | null
  /** 다른 화면(PC)이 읽은 상태. 값이 다르면 불일치로 보여 준다. null 이면 비교 대상 없음. */
  otherSurfaceStatus: LedgerStatus | null
}

export type EntryDisplay = 'confirmed' | 'unverified' | 'pending' | 'completed' | 'cancelled'

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  owner_confirmed: '사장님이 확정',
  customer_accepted: '고객이 수락',
  ledger_event: '예약표 기록',
  unverified: '근거를 확인하지 못함',
}

export const DISPLAY_LABEL: Record<EntryDisplay, string> = {
  confirmed: '확정',
  unverified: '예약표 확인 전',
  pending: '확정 대기',
  completed: '시술 끝',
  cancelled: '취소',
}

/** '확정' 은 예약표 readback 시각과 근거가 있을 때만. 둘 중 하나라도 없으면 확정으로 그리지 않는다. */
export function entryDisplay(e: LedgerEntryDto): EntryDisplay {
  if (e.status === 'cancelled') return 'cancelled'
  if (e.status === 'completed') return 'completed'
  if (e.status === 'pending_confirmation') return 'pending'
  if (e.ledgerVerifiedAt && e.source !== 'unverified') return 'confirmed'
  return 'unverified'
}

const ACTIVE: LedgerStatus[] = ['confirmed', 'pending_confirmation']

/** 같은 가게에서 시간이 겹치는 유효 예약 쌍의 id. 하나만 확정될 수 있으므로 둘 다 표시한다. */
export function findConflicts(entries: LedgerEntryDto[], workspaceId: string): Set<string> {
  const active = entries
    .filter(e => e.workspaceId === workspaceId && ACTIVE.includes(e.status))
    .map(e => ({ id: e.id, s: Date.parse(e.startsAt), e: Date.parse(e.endsAt) }))
    .filter(x => !Number.isNaN(x.s) && !Number.isNaN(x.e))
    .sort((a, b) => a.s - b.s)
  const out = new Set<string>()
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length && active[j].s < active[i].e; j++) {
      out.add(active[i].id)
      out.add(active[j].id)
    }
  }
  return out
}

export function isMismatch(e: LedgerEntryDto): boolean {
  return e.otherSurfaceStatus !== null && e.otherSurfaceStatus !== e.status
}

export function dayKey(iso: string, timeZone: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export interface LedgerDay { date: string; entries: LedgerEntryDto[] }

/** 현재 가게 예약만, 날짜별·시작시각순. 시각을 읽을 수 없는 항목은 숨기지 않고 '시각 확인 못함' 묶음으로 보낸다. */
export function groupByDay(entries: LedgerEntryDto[], workspaceId: string, timeZone: string, from: string, to: string): { days: LedgerDay[]; unreadable: LedgerEntryDto[] } {
  const map = new Map<string, LedgerEntryDto[]>()
  const unreadable: LedgerEntryDto[] = []
  for (const e of entries) {
    if (e.workspaceId !== workspaceId) continue
    const k = dayKey(e.startsAt, timeZone)
    if (!k) { unreadable.push(e); continue }
    if (k < from || k > to) continue
    map.set(k, [...(map.get(k) ?? []), e])
  }
  const days = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, entries: list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) }))
  return { days, unreadable }
}

/** 마지막 확인이 오래되면 stale. 기준(분)을 넘기면 새로 확인을 요구한다. */
export function isStale(checkedAt: string | null, now: Date, maxMinutes = 10): boolean {
  if (!checkedAt) return true
  const t = Date.parse(checkedAt)
  return Number.isNaN(t) || now.getTime() - t > maxMinutes * 60_000
}
