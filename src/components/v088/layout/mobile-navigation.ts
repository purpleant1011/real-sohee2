import {
  Archive,
  Briefcase,
  ChartNoAxesCombined,
  Ellipsis,
  FileText,
  House,
  MessageCircle,
  Users,
} from 'lucide-react'
import { getMobileTab, mobileTabs, type MobileTabId } from '@/features/mobile-decision/navigation'

export type MobileSection = 'home' | 'content' | 'sohee' | 'customers' | 'results'

export interface MobileBottomItem {
  id: MobileTabId
  name: string
  href: string
  icon: any
  badgeKey?: 'approvals'
}

export interface MobileSubTabItem {
  name: string
  href: string
  icon: any
}

// ANI-1664-1 / ANI-1665-3: 플래그 OFF 폴백 바도 셸과 동일한 5탭(오늘/작업/고객/성과/더보기)을 쓴다.
// 탭 목록은 features/mobile-decision/navigation.ts 의 mobileTabs 를 단일 정본으로 삼아 드리프트를 막는다.
const BOTTOM_ICONS: Record<MobileTabId, any> = {
  today: House,
  work: Briefcase,
  customers: Users,
  results: ChartNoAxesCombined,
  more: Ellipsis,
}

export const MOBILE_BOTTOM_ITEMS: MobileBottomItem[] = mobileTabs.map((tab) => ({
  id: tab.id,
  name: tab.label,
  href: tab.href,
  icon: BOTTOM_ICONS[tab.id],
  // 오늘 탭에만 승인 대기 배지를 붙인다.
  ...(tab.id === 'today' ? { badgeKey: 'approvals' as const } : {}),
}))

// ANI-1664-1: 활성 탭 판정은 /app 계열 경로에서만 유효하다.
// getMobileTab 은 5탭 밖 경로를 모두 'more' 로 흡수하므로, /app 밖 경로(dev 프리뷰 등)에서
// 더보기에 거짓 aria-current 가 붙지 않도록 경로 가드를 여기서 한 번만 건다.
export function getMobileActiveTabId(pathname: string | null): MobileTabId | null {
  const path = pathname ?? '/app'
  // '/app' 또는 '/app/**' 만 통과시킨다. '/application' 같은 접두사 오탐을 막는다.
  return path === '/app' || path.startsWith('/app/') ? getMobileTab(path) : null
}

export function getMobileActiveSection(pathname: string | null): MobileSection | null {
  if (!pathname) return 'home'

  if (pathname === '/app' || pathname === '/app/command') {
    return 'home'
  }

  if (pathname.startsWith('/app/content') || pathname.startsWith('/app/vault')) {
    return 'content'
  }

  if (pathname.startsWith('/app/sohee')) {
    return 'sohee'
  }

  // ANI-1664-2: 성과는 고객 하위가 아니라 전역 섹션이다.
  if (pathname.startsWith('/app/results')) {
    return 'results'
  }

  if (pathname.startsWith('/app/customers') || pathname.startsWith('/app/engagement')) {
    return 'customers'
  }

  return null
}

export function getMobileSubTabs(section: MobileSection | null): MobileSubTabItem[] {
  if (section === 'content') {
    return [
      { name: '콘텐츠', href: '/app/content', icon: FileText },
      { name: '보관함', href: '/app/vault', icon: Archive },
    ]
  }

  if (section === 'customers') {
    // ANI-1664-3: 성과는 전역 섹션이므로 고객 서브탭에서 제거해 이중 노출을 막는다.
    return [
      { name: '고객', href: '/app/customers', icon: Users },
      { name: '소통함', href: '/app/engagement', icon: MessageCircle },
    ]
  }

  return []
}
