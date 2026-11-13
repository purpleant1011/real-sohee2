import type { OperatorPermission } from '@/features/operator-auth/permissions'

export type OperatorNavigationItem = Readonly<{
  href: string
  label: string
  permission: OperatorPermission
  badge?: string
  description?: string
}>

export type OperatorNavigationGroup = Readonly<{
  id: string
  title: string
  items: readonly OperatorNavigationItem[]
}>

// 권한은 각 페이지의 requireOperator / requireOperatorAnyScope 와 동일하게 유지한다.
export const operatorNavigationGroups: readonly OperatorNavigationGroup[] = [
  {
    id: 'dashboard',
    title: '대시보드',
    items: [
      { href: '/admin', label: '운영 현황', permission: 'dashboard.read', description: '오늘 확인할 위험과 실패 한눈에 보기' },
    ],
  },
  {
    id: 'customers',
    title: '고객사',
    items: [
      { href: '/admin/workspaces', label: '고객사', permission: 'workspace.read', description: '고객사 목록과 상세 상태' },
      { href: '/admin/onboarding', label: '온보딩', permission: 'agreement.read', description: '가입·약관 동의 진행 현황' },
      { href: '/admin/cohort', label: '코호트', permission: 'workspace.read', description: '가입 시기별 정착·이탈 흐름' },
      { href: '/admin/feedback', label: '고객 의견', permission: 'workspace.read', description: '고객이 남긴 의견 분류와 처리' },
    ],
  },
  {
    id: 'publishing',
    title: '콘텐츠·발행',
    items: [
      { href: '/admin/publishing', label: '발행 현황', permission: 'publish.read', description: '채널별 발행 성공·실패' },
      { href: '/admin/engagement', label: '소통함 관제', permission: 'publish.read', description: 'DM·댓글 자동 답글 현황 및 킬스위치' },
      { href: '/admin/vault', label: '보관함 감시', permission: 'audit.read', description: '고객 보관함 접근과 변경 점검' },
      { href: '/admin/preflight', label: '발행 전 점검', permission: 'content.read', description: '발행 전에 막힌 항목 확인' },
      { href: '/admin/reconcile', label: '외부 대사', permission: 'publish.read', description: '외부 채널 결과와 내부 기록 대조' },
      { href: '/admin/missions', label: '미션', permission: 'agent.read', description: '자동 실행되는 미션 진행 상태' },
    ],
  },
  {
    id: 'channels',
    title: '채널',
    items: [
      { href: '/admin/channels', label: '채널 연결', permission: 'channel.read', description: '고객사별 채널 연결 상태' },
    ],
  },
  {
    id: 'money',
    title: '매출·비용',
    items: [
      { href: '/admin/billing', label: '결제·구독', permission: 'billing.read', description: '구독과 결제 처리 현황' },
      { href: '/admin/revenue', label: '크레딧 원장', permission: 'billing.read', description: '크레딧 충전·사용 내역' },
      { href: '/admin/credits', label: '크레딧 일괄 지급', permission: 'credit.adjust.approve', description: '실제 고객사 대상 지급과 이전 내역' },
      { href: '/admin/finops', label: 'AI 비용', permission: 'dashboard.read', description: '모델 사용량과 원가' },
      { href: '/admin/cost', label: '비용 대비 가치', permission: 'finops.read', description: '고객사별 비용과 가치 비교' },
    ],
  },
  {
    id: 'safety',
    title: '안전·운영',
    items: [
      { href: '/admin/interventions', label: '긴급 개입', permission: 'runtime_control.read', description: '발행 중지 등 긴급 조치' },
      { href: '/admin/system', label: '시스템', permission: 'system.read', description: '서비스 상태와 장애 기록' },
      { href: '/admin/audit', label: '감사 로그', permission: 'audit.read', description: '운영자 행동 기록 조회' },
      { href: '/admin/admins', label: '관리자 계정', permission: 'admin.read', description: '관리자 초대와 권한' },
      { href: '/admin/governance', label: '보안 설정', permission: 'admin.read', description: '인증·승인 정책' },
    ],
  },
] as const

export const operatorNavigation: readonly OperatorNavigationItem[] = operatorNavigationGroups.flatMap((group) => group.items)

export function groupOperatorNavigation(
  permissions: readonly OperatorPermission[],
): readonly OperatorNavigationGroup[] {
  return operatorNavigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canViewOperatorNavigation(item, permissions)) }))
    .filter((group) => group.items.length > 0)
}

export function canViewOperatorNavigation(
  item: OperatorNavigationItem,
  permissions: readonly OperatorPermission[],
): boolean {
  return permissions.includes(item.permission)
}

export function isCurrentOperatorRoute(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
