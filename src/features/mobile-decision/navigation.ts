import type { SystemTrustDomain } from '@/types/system-trust'

export function systemDomainFromSection(section: string | null): SystemTrustDomain | null {
  switch (section) {
    case 'business': return 'account'
    case 'credits': return 'plan_credits'
    case 'connections': return 'connections'
    case 'privacy': return 'privacy'
    case 'security': return 'security'
    case 'health': return 'health'
    default: return null
  }
}

export type MobileTabId = 'today' | 'work' | 'customers' | 'results' | 'more'
export const mobileTabs: ReadonlyArray<{ id: MobileTabId; label: string; href: string }> = [
  { id: 'today', label: '오늘', href: '/app' },
  { id: 'work', label: '작업', href: '/app/content' },
  { id: 'customers', label: '고객', href: '/app/customers' },
  { id: 'results', label: '성과', href: '/app/results' },
  { id: 'more', label: '더보기', href: '/app/system' },
]
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`)
export function getMobileTab(path: string): MobileTabId {
  if (['/app/content', '/app/vault', '/app/work'].some(root => under(path, root))) return 'work'
  if (['/app/customers', '/app/engagement'].some(root => under(path, root))) return 'customers'
  if (under(path, '/app/results')) return 'results'
  if (path === '/app' || under(path, '/app/approvals')) return 'today'
  return 'more'
}
export function getMobileMode(path: string, chatOpen: boolean): 'browse' | 'review' | 'chat' {
  if (chatOpen) return 'chat'
  // ANI-1664-7 / ANI-1665-1: /app/command 는 자체 대화 입력을 가진 CHAT 화면이다
  // (mobile-shell routes.ts M10 mode: 'CHAT'). browse 로 판정하면 하단 5탭과 전역 커맨드바가
  // 함께 떠서 입력이 중복된다. CHAT 모드는 탭바 없이 단일 입력만 둔다.
  if (under(path, '/app/command') || under(path, '/app/conversations')) return 'chat'
  return under(path, '/app/approvals') || /^\/app\/work\/[^/]+\/edit$/.test(path) ? 'review' : 'browse'
}
export function resolveMobileUiEnabled(flag: string | undefined, raw: string | undefined, workspaceId: string): boolean {
  const allowed = (raw ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return flag === '1' && Boolean(workspaceId) && !allowed.includes('*') && allowed.includes(workspaceId)
}
