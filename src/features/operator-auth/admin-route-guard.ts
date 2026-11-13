import 'server-only'

import type { OperatorPermission } from './permissions'
import {
  OperatorAccessError,
  type CurrentOperatorContext,
  type OperatorAuthGateway,
} from './current-operator'
import { requireOperator, requireOperatorAnyScope } from './require-operator'
import { NextResponse } from 'next/server'

export interface AdminRouteSecurityEntry {
  route: string
  methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[]
  permission: OperatorPermission
  aalLevel: 'aal2'
  description: string
  privilegedRpcMapping?: string[]
}

/**
 * 14 Admin API Routes Security Matrix (ANI-1144)
 * Maps every administrative endpoint to its required AAL2 Operator Permission and privileged DB RPCs.
 * Ensures zero contradiction with ANI-1140 SECURITY DEFINER capability inventory.
 */
export const ADMIN_ROUTE_SECURITY_MATRIX: AdminRouteSecurityEntry[] = [
  {
    route: '/api/admin/system/fleet-snapshot',
    methods: ['GET'],
    permission: 'dashboard.read',
    aalLevel: 'aal2',
    description: '전체 플릿 현황, 워크스페이스 통계, 스케줄러 지연 실측',
  },
  {
    route: '/api/admin/runtime/snapshot',
    methods: ['GET', 'POST'],
    permission: 'agent.read',
    aalLevel: 'aal2',
    description: '런타임 진실 스냅샷 조회 및 강제 갱신',
  },
  {
    route: '/api/admin/system/kill-switches',
    methods: ['GET', 'POST'],
    permission: 'runtime_control.change.request',
    aalLevel: 'aal2',
    description: '긴급 킬스위치 조회 및 발동/해제',
  },
  {
    route: '/api/admin/system/wing-stack',
    methods: ['GET', 'POST'],
    permission: 'dashboard.read',
    aalLevel: 'aal2',
    description: '윙 스택 프로세스 상태 및 큐 모니터링',
  },
  {
    route: '/api/admin/governance/approvals',
    methods: ['GET', 'POST'],
    permission: 'governance.read',
    aalLevel: 'aal2',
    description: '2인 승인 원칙 거버넌스 큐 조회 및 승인',
  },
  {
    route: '/api/admin/channels/reconcile',
    methods: ['POST'],
    permission: 'publish.reconcile.request',
    aalLevel: 'aal2',
    description: 'Meta 채널 상태 동기화 및 누락 검증 복구',
  },
  {
    route: '/api/admin/credits/bulk-grant/preview',
    methods: ['POST'],
    permission: 'credit.adjust.approve',
    aalLevel: 'aal2',
    description: '실제 고객사 대상 지급 미리보기',
    privilegedRpcMapping: ['preview_bulk_credit_grant'],
  },
  {
    route: '/api/admin/credits/bulk-grant',
    methods: ['POST'],
    permission: 'credit.adjust.approve',
    aalLevel: 'aal2',
    description: '실제 고객사 대상 크레딧 일괄 지급',
    privilegedRpcMapping: ['grant_bulk_credits'],
  },
  {
    route: '/api/admin/privacy/requests',
    methods: ['GET', 'POST'],
    permission: 'privacy.read',
    aalLevel: 'aal2',
    description: '사용자 데이터 삭제/프라이버시 요청 처리',
  },
  {
    route: '/api/admin/agents/eval',
    methods: ['GET', 'POST'],
    permission: 'agent.read',
    aalLevel: 'aal2',
    description: '에이전트 품질 평가 지표 및 골든 시나리오 진단',
  },
  {
    route: '/api/admin/safety/risk-reviews',
    methods: ['GET'],
    permission: 'admin.read',
    aalLevel: 'aal2',
    description: 'AI 생성물 유해성/브랜드 리스크 리뷰 큐',
  },
  {
    route: '/api/admin/refine/workspaces',
    methods: ['GET'],
    permission: 'workspace.read',
    aalLevel: 'aal2',
    description: '전체 워크스페이스 목록 정제 및 관리자 필터링',
  },
  {
    route: '/api/admin/refine/workspaces/[workspaceId]',
    methods: ['GET'],
    permission: 'workspace.read',
    aalLevel: 'aal2',
    description: '특정 워크스페이스 단일 정제 상세 조회',
  },
  {
    route: '/api/admin/workspaces/[workspaceId]/adjust-credits',
    methods: ['POST'],
    permission: 'credit.adjust.request',
    aalLevel: 'aal2',
    description: '특정 워크스페이스 크레딧 수동 조정/지급',
  },
  {
    route: '/api/admin/workspaces/[workspaceId]/verify-business',
    methods: ['POST'],
    permission: 'workspace.lifecycle.manage',
    aalLevel: 'aal2',
    description: '사업자등록증 수동 심사 승인/반려',
  },
  {
    route: '/api/admin/engagement/killswitch',
    methods: ['POST'],
    permission: 'system.read',
    aalLevel: 'aal2',
    description: '소통함(DM·댓글) 자율성 긴급 격하(L1) 및 일시중지 킬스위치',
  },
]

/**
 * Unified Server-Side AAL2 & Role Guard for Admin API Routes.
 * Returns 401 when unauthenticated, 403 when AAL1 or unauthorized.
 */
export async function assertAdminAal2RouteGuard(
  permission: OperatorPermission,
  workspaceId?: string,
  gateway?: OperatorAuthGateway,
): Promise<CurrentOperatorContext> {
  if (workspaceId || !permission.endsWith('.read')) {
    return requireOperator(permission, workspaceId, gateway)
  }
  return requireOperatorAnyScope(permission, gateway)
}

/**
 * Creates standardized JSON error response for route guard failures.
 */
export function handleAdminGuardError(err: unknown): NextResponse {
  if (err instanceof OperatorAccessError) {
    if (err.code === 'AUTH_REQUIRED') {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', message: '관리자 인증 세션이 필요합니다.' },
        { status: 401 },
      )
    }
    if (err.code === 'MFA_REQUIRED') {
      return NextResponse.json(
        { error: 'MFA_REQUIRED', message: 'AAL2 수준의 2단계 인증(TOTP)이 필요합니다.' },
        { status: 403 },
      )
    }
    if (err.code === 'PERMISSION_DENIED') {
      return NextResponse.json(
        { error: 'PERMISSION_DENIED', message: '해당 작업을 수행할 관리자 권한이 없습니다.' },
        { status: 403 },
      )
    }
    if (err.code === 'WORKSPACE_SCOPE_DENIED') {
      return NextResponse.json(
        { error: 'WORKSPACE_SCOPE_DENIED', message: '해당 워크스페이스에 대한 관리자 권한 범위가 아닙니다.' },
        { status: 403 },
      )
    }
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 403 },
    )
  }

  return NextResponse.json(
    { error: 'INTERNAL_GUARD_ERROR', message: (err as Error).message || '인가 가드 평가 중 오류가 발생했습니다.' },
    { status: 500 },
  )
}

/**
 * Privileged Session Cache Invalidation on Session Downgrade / Expiry / Workspace Switch.
 */
const privilegedCache = new Map<string, { data: unknown; expiresAt: number }>()

export function setPrivilegedCache(key: string, data: unknown, ttlMs = 60000): void {
  privilegedCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

export function getPrivilegedCache<T>(key: string): T | null {
  const item = privilegedCache.get(key)
  if (!item) return null
  if (Date.now() > item.expiresAt) {
    privilegedCache.delete(key)
    return null
  }
  return item.data as T
}

export function invalidatePrivilegedSessionCache(userId?: string, workspaceId?: string): number {
  let invalidatedCount = 0
  for (const [key] of privilegedCache.entries()) {
    if ((userId && key.includes(userId)) || (workspaceId && key.includes(workspaceId)) || (!userId && !workspaceId)) {
      privilegedCache.delete(key)
      invalidatedCount++
    }
  }
  return invalidatedCount
}
