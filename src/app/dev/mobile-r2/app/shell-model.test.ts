import { describe, expect, it } from 'vitest'
import { SHELL_TABS } from '@/features/mobile-shell'
import {
  APP_SCREENS, TODAY_DECISION_LIMIT, customerIdFromHref, listedDecisions, parentScreenFor, resolveTabTap,
  rootScreenFor, screenFor, screenPath, tabForScreen, visibleDecisions,
} from './shell-model'

describe('APP_SCREENS — 탭 소속표', () => {
  it('다섯 탭마다 루트 화면이 정확히 하나씩 있고, 루트 id 는 탭 id 와 같다', () => {
    for (const tab of SHELL_TABS) {
      const roots = APP_SCREENS.filter(screen => screen.tab === tab.id && screen.id === tab.id)
      expect(roots).toHaveLength(1)
      expect(rootScreenFor(tab.id)).toBe(tab.id)
    }
  })

  it('모든 화면의 tab 은 실제 5탭 중 하나이고 id 는 중복되지 않는다', () => {
    const tabIds = SHELL_TABS.map(tab => tab.id)
    for (const screen of APP_SCREENS) expect(tabIds).toContain(screen.tab)
    expect(new Set(APP_SCREENS.map(screen => screen.id)).size).toBe(APP_SCREENS.length)
  })

  it('더보기 하위 4개 화면은 모두 더보기 탭에 속한다', () => {
    const moreIds = APP_SCREENS.filter(screen => screen.id.startsWith('more/')).map(screen => screen.id)
    expect(moreIds).toEqual(['more/channels', 'more/credit', 'more/memory', 'more/settings'])
    for (const id of moreIds) expect(tabForScreen(id)).toBe('more')
  })

  it('고객 상세는 고객 탭의 하위 화면이다', () => {
    expect(screenFor('customers/detail')).toEqual({ id: 'customers/detail', tab: 'customers', title: '고객 상세' })
  })

  it('모르는 화면 id 는 null 이고 부모도 없다', () => {
    expect(screenFor('nope')).toBeNull()
    expect(tabForScreen('nope')).toBeNull()
    expect(parentScreenFor('nope')).toBeNull()
  })
})

describe('parentScreenFor — 하위 화면의 부모', () => {
  it('하위 화면은 탭 루트를 부모로 갖는다', () => {
    expect(parentScreenFor('more/channels')).toBe('more')
    expect(parentScreenFor('more/settings')).toBe('more')
  })

  it('탭 루트는 부모가 없다', () => {
    for (const tab of SHELL_TABS) expect(parentScreenFor(tab.id)).toBeNull()
  })

  it('상세는 탭 루트가 아니라 목록으로 돌아간다 — 열었던 스크롤·맥락을 이어 가려면', () => {
    expect(parentScreenFor('customers/detail')).toBe('customers/list')
    // 다른 고객 하위 화면은 종전 규칙(탭 루트가 부모)을 그대로 따른다.
    expect(parentScreenFor('customers/inbox')).toBe('customers')
  })
})

describe('customerIdFromHref — 셸 안 상세로 열 링크', () => {
  it('고객 상세 링크에서 id 를 꺼낸다', () => {
    expect(customerIdFromHref('/app/customers/preview-customer-1')).toBe('preview-customer-1')
    expect(customerIdFromHref('/app/customers/%EA%B9%80%EC%98%88%EC%8B%9C')).toBe('김예시')
  })

  it('상세 링크가 아니면 null — 다른 링크를 상세로 잘못 열지 않는다', () => {
    for (const href of [
      null, undefined, '',
      '/app/customers',
      '/app/customers/',
      '/app/customers/c1/edit',
      '/app/customers/c1?tab=note',
      '/app/approvals?item=1',
      'https://example.com/app/customers/c1',
    ]) expect(customerIdFromHref(href)).toBeNull()
  })

  it('깨진 퍼센트 인코딩은 원문을 그대로 쓴다(없는 고객을 지어내지 않는다)', () => {
    expect(customerIdFromHref('/app/customers/%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('screenPath — 스크롤 저장 키', () => {
  it('오늘 탭 루트는 앱 루트 경로, 나머지는 화면 경로를 쓴다', () => {
    expect(screenPath('today')).toBe('/dev/mobile-r2/app')
    expect(screenPath('more')).toBe('/dev/mobile-r2/app/more')
    expect(screenPath('more/credit')).toBe('/dev/mobile-r2/app/more/credit')
  })
})

describe('resolveTabTap — 탭 눌림의 목적지', () => {
  it('다른 탭을 누르면 그 탭의 첫 화면으로 간다', () => {
    expect(resolveTabTap({ activeTab: 'today', tab: 'customers', screen: 'today' }))
      .toEqual({ action: 'switch', screen: 'customers' })
  })

  it('같은 탭의 하위 화면에서 누르면 그 탭 루트로 돌아간다', () => {
    expect(resolveTabTap({ activeTab: 'more', tab: 'more', screen: 'more/credit' }))
      .toEqual({ action: 'switch', screen: 'more' })
  })

  it('이미 탭 루트면 맨 위로만 올린다', () => {
    expect(resolveTabTap({ activeTab: 'more', tab: 'more', screen: 'more' }))
      .toEqual({ action: 'scroll-top' })
    expect(resolveTabTap({ activeTab: 'today', tab: 'today', screen: 'today' }))
      .toEqual({ action: 'scroll-top' })
  })
})

describe('visibleDecisions — 오늘 결정 3개 제한', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('접힌 상태에서는 최대 3개만 보이고 나머지 수를 알린다', () => {
    expect(TODAY_DECISION_LIMIT).toBe(3)
    expect(visibleDecisions(items, false)).toEqual({ visible: ['a', 'b', 'c'], hiddenCount: 2 })
  })

  it('펼치면 전부 보이고 숨김은 0건이다', () => {
    expect(visibleDecisions(items, true)).toEqual({ visible: items, hiddenCount: 0 })
  })

  it('3개 이하면 숨김이 없다', () => {
    expect(visibleDecisions(items.slice(0, 3), false)).toEqual({ visible: ['a', 'b', 'c'], hiddenCount: 0 })
    expect(visibleDecisions([], false)).toEqual({ visible: [], hiddenCount: 0 })
  })
})

describe('listedDecisions — 강조 카드와 목록의 중복 제거', () => {
  const items = ['a', 'b', 'c', 'd', 'e']

  it('첫 항목은 강조 카드가 쓰므로 목록에서 빠진다', () => {
    expect(listedDecisions(items, false)).toEqual({ visible: ['b', 'c', 'd'], hiddenCount: 1, hasMore: true })
  })

  it('펼치면 첫 항목을 뺀 나머지가 모두 보이고, 접기 버튼은 남는다', () => {
    expect(listedDecisions(items, true)).toEqual({ visible: ['b', 'c', 'd', 'e'], hiddenCount: 0, hasMore: true })
  })

  it('남은 항목이 3개 이하면 더 보기 버튼이 없다', () => {
    expect(listedDecisions(items.slice(0, 4), false)).toEqual({ visible: ['b', 'c', 'd'], hiddenCount: 0, hasMore: false })
    expect(listedDecisions([], false)).toEqual({ visible: [], hiddenCount: 0, hasMore: false })
  })
})
