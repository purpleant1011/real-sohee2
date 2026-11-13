import {
  Bot,
  Calendar,
  ChartNoAxesCombined,
  Layers,
  MessageCircle,
  MessageSquare,
  Puzzle,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react'
import type { AppNavigationItem } from './desktop-sidebar'

export const CONVERSATION_COMPATIBILITY_PATHS = Object.freeze({
  inbox: '/app/inbox',
  work: '/app/work',
})

export function isCurrentAppRoute(pathname: string, href: string) {
  if (href === '/app') return pathname === href

  return pathname === href || pathname.startsWith(`${href}/`)
}

export const appNavigation: readonly AppNavigationItem[] = [
  { href: '/app', label: '오늘', icon: Sparkles },
  { href: '/app/conversations', label: '대화', icon: MessageSquare },
  { href: '/app/engagement', label: '소통함', icon: MessageCircle },
  { href: '/app/customers', label: '고객', icon: Users, badge: 4 },
  { href: '/app/campaigns', label: '캠페인', icon: Calendar },
  { href: '/app/plugins', label: '플러그인', icon: Puzzle },
  { href: '/app/knowledge/harnesses', label: '소희 업무 기준', icon: Layers },
  { href: '/app/content', label: '콘텐츠', icon: Bot },
  { href: '/app/automation', label: '자동화', icon: Sparkles },
  { href: '/app/reports', label: '성과', icon: ChartNoAxesCombined },
  { href: '/app/account', label: '나의 소희', icon: UserRound },
]
