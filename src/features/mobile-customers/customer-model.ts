import type { LoadState } from '@/features/mobile-decision/contracts'

export type ConsentStatus = 'granted' | 'withdrawn' | 'unknown'
export type ContactChannel = 'phone' | 'message'
export type CustomerSegment = 'inquiring' | 'upcoming' | 'visited' | 'revisit'

export interface MobileCustomerDto {
  id: string
  workspaceId: string
  displayName: string
  segment: CustomerSegment
  consent: { status: ConsentStatus; checkedAt: string | null; source: string | null }
  verifiedContacts: ContactChannel[]
  lastAction: { label: string; at: string } | null
  sourceLabel: string | null
  customerUuid?: string | null
}

export interface ContactCta {
  channel: ContactChannel
  enabled: boolean
  reason: string | null
}

/** 동의가 확인(granted)되고 검증된 연락처가 있을 때만 활성. 모호하면 비활성(fail-closed). */
export function contactCtas(c: MobileCustomerDto): ContactCta[] {
  const channels: ContactChannel[] = ['phone', 'message']
  return channels.map(channel => {
    if (c.consent.status === 'withdrawn') return { channel, enabled: false, reason: '수신 동의가 철회됐어요' }
    if (c.consent.status !== 'granted') return { channel, enabled: false, reason: '수신 동의를 확인하지 못했어요' }
    if (!c.verifiedContacts.includes(channel)) return { channel, enabled: false, reason: '확인된 연락처가 없어요' }
    return { channel, enabled: true, reason: null }
  })
}

/** 철회·미확인 고객은 캠페인/알림 대상에서 제외. 다른 워크스페이스 고객은 절대 포함하지 않는다. */
export function campaignAudience(customers: MobileCustomerDto[], workspaceId: string): MobileCustomerDto[] {
  return customers.filter(c => c.workspaceId === workspaceId && c.consent.status === 'granted')
}

/**
 * 이름 비교·자르기의 기준 표기. iOS/macOS 한글 입력은 자모가 분리된 NFD 로 들어올 수 있어
 * '김민지'가 8개 코드포인트가 된다. 정규화하지 않으면 마스킹이 자모 단위로 쪼개지고
 * 검색이 같은 이름을 못 찾는다.
 */
function normalizeName(value: string): string {
  return value.normalize('NFC')
}

/** 마스킹: 김민지 → 김○지, 두 글자 → 김○ */
export function maskName(name: string): string {
  // 정규화한 뒤 글자 단위로 센다. 자모를 하나의 글자로 묶어야 '김○지'가 나온다.
  const chars = [...normalizeName(name.trim())]
  if (chars.length <= 1) return chars.join('')
  if (chars.length === 2) return `${chars[0]}○`
  return `${chars[0]}${'○'.repeat(chars.length - 2)}${chars[chars.length - 1]}`
}

/** 이름이 비어 있을 때 화면에 남기는 문구. 빈 제목은 '누구인지 모른다'를 감춘다. */
export const UNKNOWN_NAME_LABEL = '이름 미확인'

export function displayName(c: MobileCustomerDto): string {
  // 철회 고객은 마스킹한 이름을, 나머지는 완성형(NFC) 이름을 쓴다.
  const shown = c.consent.status === 'withdrawn' ? maskName(c.displayName) : normalizeName(c.displayName).trim()
  return shown.trim() ? shown : UNKNOWN_NAME_LABEL
}

/**
 * 검색은 현재 워크스페이스 고객만 대상으로 한다.
 * 이름은 양쪽을 같은 표기(NFC)로 맞춰 비교한다 — 저장된 이름과 입력한 검색어의 표기가
 * 달라도 같은 글자면 찾아야 한다.
 */
export function searchCustomers(customers: MobileCustomerDto[], workspaceId: string, query: string): MobileCustomerDto[] {
  const q = normalizeName(query.trim()).toLowerCase()
  const scoped = customers.filter(c => c.workspaceId === workspaceId)
  return q ? scoped.filter(c => normalizeName(c.displayName).toLowerCase().includes(q)) : scoped
}

export type ListView =
  | { kind: 'loading' } | { kind: 'error' } | { kind: 'stale' } | { kind: 'offline' }
  | { kind: 'confirmed_empty' } | { kind: 'partial' } | { kind: 'ready' }

/**
 * 조회 실패/불완전을 빈 목록으로 보이지 않게 한다.
 *
 * offline 은 브라우저가 '연결 없음'을 확인해 준 경우다. 원인을 아는 실패(error)와 원인을 모르는 실패를
 * 같은 문구로 뭉개지 않는다. 이미 서버에서 확인한 내용(ready)과 확인 중(loading)은 덮지 않는다 —
 * 연결이 끊긴 사실이 앞서 확인된 값을 지울 이유는 아니다.
 */
export function listView(state: LoadState, items: unknown[] | null, complete: boolean, offline = false): ListView {
  if (state === 'loading') return { kind: 'loading' }
  if (offline && (state === 'error' || state === 'unknown')) return { kind: 'offline' }
  if (state === 'error' || state === 'unknown') return { kind: 'error' }
  if (state === 'stale') return { kind: 'stale' }
  if (!items || items.length === 0) return complete ? { kind: 'confirmed_empty' } : { kind: 'partial' }
  return complete ? { kind: 'ready' } : { kind: 'partial' }
}
