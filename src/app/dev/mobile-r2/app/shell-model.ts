import type { TabId } from '@/features/mobile-shell'

/** 셸이 그리는 화면 1개. 하위 화면은 `탭/화면` 형태의 id 를 쓴다. */
export interface AppScreen {
  id: string
  tab: TabId
  title: string
}

/**
 * 화면 → 탭 소속표. 탭의 정본은 `SHELL_TABS`(5탭 고정)이고, 이 표는
 * "이 화면이 어느 탭 안에 있는가"만 정한다. 탭 루트 화면의 id 는 탭 id 와 같다.
 */
export const APP_SCREENS: readonly AppScreen[] = [
  { id: 'today', tab: 'today', title: '오늘' },
  { id: 'work', tab: 'work', title: '작업' },
  { id: 'work/list', tab: 'work', title: '작업 목록' },
  { id: 'work/notifications', tab: 'work', title: '알림함' },
  { id: 'work/campaigns', tab: 'work', title: '캠페인 제안' },
  { id: 'customers', tab: 'customers', title: '고객' },
  { id: 'customers/list', tab: 'customers', title: '고객 목록' },
  { id: 'customers/detail', tab: 'customers', title: '고객 상세' },
  { id: 'customers/inbox', tab: 'customers', title: '소통함' },
  { id: 'customers/ledger', tab: 'customers', title: '예약표' },
  { id: 'results', tab: 'results', title: '성과' },
  { id: 'more', tab: 'more', title: '더보기' },
  { id: 'more/channels', tab: 'more', title: '채널' },
  { id: 'more/credit', tab: 'more', title: '크레딧' },
  { id: 'more/memory', tab: 'more', title: '가게 기억' },
  { id: 'more/settings', tab: 'more', title: '설정' },
]

export function screenFor(id: string): AppScreen | null {
  return APP_SCREENS.find(screen => screen.id === id) ?? null
}

export function tabForScreen(id: string): TabId | null {
  return screenFor(id)?.tab ?? null
}

/** 탭의 첫 화면(루트). 루트가 없으면 화면표가 깨진 것이므로 즉시 실패한다. */
export function rootScreenFor(tab: TabId): string {
  const root = APP_SCREENS.find(screen => screen.tab === tab && screen.id === tab)
  if (!root) throw new Error(`탭 루트 화면이 없어요: ${tab}`)
  return root.id
}

/**
 * 탭 루트가 아니라 다른 화면으로 돌아가야 하는 경우. 상세는 목록에서 열리므로
 * 뒤로가기도 목록으로 가야 스크롤·맥락이 이어진다(목록을 건너뛰고 탭 첫 화면으로 보내지 않는다).
 */
const PARENT_OVERRIDES: Readonly<Record<string, string>> = {
  'customers/detail': 'customers/list',
}

/** 하위 화면의 부모 화면. 루트 화면이면 null. */
export function parentScreenFor(id: string): string | null {
  const override = PARENT_OVERRIDES[id]
  if (override) return screenFor(override) ? override : null
  const cut = id.lastIndexOf('/')
  if (cut < 1) return null
  const parent = id.slice(0, cut)
  return screenFor(parent) ? parent : null
}

/** 스크롤 저장 키. 오늘 탭 루트는 앱 루트 경로를 쓴다. */
export function screenPath(id: string): string {
  return id === 'today' ? '/dev/mobile-r2/app' : `/dev/mobile-r2/app/${id}`
}

/**
 * 실제 라우트 링크(`/app/customers/:id`)에서 고객 id 를 꺼낸다.
 * 셸은 이 링크를 따라 이동하지 않고, 꺼낸 id 로 상세 화면을 셸 안에서 연다.
 * 고객 상세 링크가 아니면 null — 다른 링크를 상세로 잘못 열지 않는다.
 */
export function customerIdFromHref(href: string | null | undefined): string | null {
  const match = /^\/app\/customers\/([^/?#]+)$/.exec(href ?? '')
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/**
 * 탭 눌림의 목적지(순수). 다른 탭이면 그 탭의 첫 화면으로,
 * 같은 탭의 하위 화면이면 루트로, 이미 루트면 맨 위로만 올린다.
 */
export function resolveTabTap(input: { activeTab: TabId; tab: TabId; screen: string }):
  | { action: 'scroll-top' }
  | { action: 'switch'; screen: string } {
  if (input.tab !== input.activeTab) return { action: 'switch', screen: rootScreenFor(input.tab) }
  const root = rootScreenFor(input.tab)
  return input.screen === root ? { action: 'scroll-top' } : { action: 'switch', screen: root }
}

/** 오늘 탭은 결정을 최대 3개만 펼친다. 나머지는 '더 보기'로 드러내고 삭제하지 않는다. */
export const TODAY_DECISION_LIMIT = 3

export function visibleDecisions<T>(items: readonly T[], expanded: boolean): { visible: readonly T[]; hiddenCount: number } {
  if (expanded) return { visible: items, hiddenCount: 0 }
  const visible = items.slice(0, TODAY_DECISION_LIMIT)
  return { visible, hiddenCount: items.length - visible.length }
}

/**
 * 목록에 그릴 결정. 첫 항목은 위쪽 강조 카드('지금 확인할 일')가 이미 쓰므로 목록에서 뺀다.
 * 같은 항목을 두 번 보여주지 않으면서 나머지는 3개씩 끊어 '더 보기'로 드러낸다.
 *
 * `hasMore` 는 펼친 상태에서도 참이어야 한다(접기 버튼을 계속 보여 주려면).
 */
export function listedDecisions<T>(items: readonly T[], expanded: boolean): {
  visible: readonly T[]
  hiddenCount: number
  hasMore: boolean
} {
  const listed = items.slice(1)
  return { ...visibleDecisions(listed, expanded), hasMore: listed.length > TODAY_DECISION_LIMIT }
}
