import { describe, expect, it } from 'vitest'
import { getMobileTab, mobileTabs } from '@/features/mobile-decision/navigation'
import {
  getMobileActiveSection,
  getMobileActiveTabId,
  getMobileSubTabs,
  MOBILE_BOTTOM_ITEMS,
} from './mobile-navigation'

describe('mobile-navigation (모바일 5대 탭 및 하위 내비게이션 매핑)', () => {
  // ANI-1664-1 / ANI-1665-3: 플래그 OFF 폴백 바도 셸과 같은 5탭 정본을 쓴다.
  it('하단 탭은 셸 정본과 동일한 오늘, 작업, 고객, 성과, 더보기 5개로 구성된다', () => {
    expect(MOBILE_BOTTOM_ITEMS).toHaveLength(mobileTabs.length)
    expect(MOBILE_BOTTOM_ITEMS.map((item) => item.id)).toEqual(mobileTabs.map((tab) => tab.id))
    expect(MOBILE_BOTTOM_ITEMS.map((item) => item.name)).toEqual([
      '오늘',
      '작업',
      '고객',
      '성과',
      '더보기',
    ])
    expect(MOBILE_BOTTOM_ITEMS.map((item) => item.href)).toEqual(mobileTabs.map((tab) => tab.href))
    // 모든 탭은 이동 링크이며 아이콘이 매핑되어 있어야 한다.
    expect(MOBILE_BOTTOM_ITEMS.every((item) => Boolean(item.icon))).toBe(true)
  })

  it('승인 대기 배지는 오늘 탭에만 붙고, 소희대화 액션 탭은 더 이상 없다', () => {
    expect(
      MOBILE_BOTTOM_ITEMS.filter((item) => item.badgeKey === 'approvals').map((item) => item.id)
    ).toEqual(['today'])
    expect(MOBILE_BOTTOM_ITEMS.some((item) => 'action' in item)).toBe(false)
  })

  it('경로별 활성 탭은 정본 getMobileTab 결과와 일치한다', () => {
    const activeItemFor = (pathname: string) =>
      MOBILE_BOTTOM_ITEMS.find((item) => item.id === getMobileTab(pathname))

    expect(activeItemFor('/app')?.id).toBe('today')
    expect(activeItemFor('/app/approvals')?.id).toBe('today')
    expect(activeItemFor('/app/content')?.id).toBe('work')
    expect(activeItemFor('/app/vault')?.id).toBe('work')
    expect(activeItemFor('/app/customers')?.id).toBe('customers')
    expect(activeItemFor('/app/engagement')?.id).toBe('customers')
    expect(activeItemFor('/app/results')?.id).toBe('results')
    expect(activeItemFor('/app/system')?.id).toBe('more')
  })

  // ANI-1664-1: getMobileTab 은 5탭 밖 경로를 'more' 로 흡수하므로,
  // 셸 정식 경로(/app 계열) 밖에서는 활성 탭을 판정하지 않아야 한다.
  it('활성 탭 판정은 /app 계열 경로로 제한한다', () => {
    expect(getMobileActiveTabId('/app')).toBe('today')
    expect(getMobileActiveTabId('/app/approvals')).toBe('today')
    expect(getMobileActiveTabId('/app/content')).toBe('work')
    expect(getMobileActiveTabId('/app/customers')).toBe('customers')
    expect(getMobileActiveTabId('/app/results')).toBe('results')
    expect(getMobileActiveTabId('/app/system')).toBe('more')

    // pathname 이 아직 없으면 홈(/app)으로 간주한다.
    expect(getMobileActiveTabId(null)).toBe('today')

    // 셸 정식 경로가 아닌 dev 프리뷰 등에서는 활성 표시를 붙이지 않는다.
    expect(getMobileActiveTabId('/dev/w1-legacy-bar')).toBeNull()
    expect(getMobileActiveTabId('/dev/mobile-r2')).toBeNull()
    expect(getMobileActiveTabId('/')).toBeNull()
    // '/app' 접두사만 같은 다른 경로를 오탐하지 않는다.
    expect(getMobileActiveTabId('/application')).toBeNull()
  })

  it('경로에 따라 올바른 1차 모바일 섹션을 식별한다', () => {
    // 1. 홈 섹션
    expect(getMobileActiveSection('/app')).toBe('home')
    expect(getMobileActiveSection('/app/command')).toBe('home')

    // 2. 콘텐츠 섹션 (콘텐츠 + 보관함)
    expect(getMobileActiveSection('/app/content')).toBe('content')
    expect(getMobileActiveSection('/app/content/legacy')).toBe('content')
    expect(getMobileActiveSection('/app/vault')).toBe('content')

    // 3. 소희 섹션 (매장 지식·목표·규칙)
    expect(getMobileActiveSection('/app/sohee')).toBe('sohee')
    expect(getMobileActiveSection('/app/sohee/knowledge')).toBe('sohee')

    // 4. 고객 섹션 (고객 + 소통함)
    expect(getMobileActiveSection('/app/customers')).toBe('customers')
    expect(getMobileActiveSection('/app/engagement')).toBe('customers')

    // 5. 성과 섹션 (ANI-1664-2: 전역 탭. 고객 하위가 아니다)
    expect(getMobileActiveSection('/app/results')).toBe('results')
    expect(getMobileActiveSection('/app/results/weekly-1004')).toBe('results')

    // 6. 기타 더보기 대상 섹션 (광고, 설정 등)
    expect(getMobileActiveSection('/app/ads')).toBeNull()
    expect(getMobileActiveSection('/app/system')).toBeNull()
  })

  it('콘텐츠 섹션과 고객 섹션은 하위 전환 탭을 제공한다', () => {
    // 콘텐츠 섹션 하위 탭: 콘텐츠, 보관함
    const contentTabs = getMobileSubTabs('content')
    expect(contentTabs).toHaveLength(2)
    expect(contentTabs.map((t) => t.name)).toEqual(['콘텐츠', '보관함'])

    // 고객 섹션 하위 탭: 고객, 소통함 (ANI-1664-3: 성과는 전역 탭이므로 서브탭에서 뺀다)
    const customerTabs = getMobileSubTabs('customers')
    expect(customerTabs).toHaveLength(2)
    expect(customerTabs.map((t) => t.name)).toEqual(['고객', '소통함'])

    // 홈·소희·성과는 하위 탭 없음
    expect(getMobileSubTabs('home')).toEqual([])
    expect(getMobileSubTabs('sohee')).toEqual([])
    expect(getMobileSubTabs('results')).toEqual([])

    // 어떤 섹션의 서브탭에도 성과(/app/results) 중복 노출이 없어야 한다
    const allSubTabs = (['home', 'content', 'sohee', 'customers', 'results'] as const).flatMap((s) =>
      getMobileSubTabs(s)
    )
    expect(allSubTabs.filter((t) => t.href === '/app/results')).toHaveLength(0)
  })
})
