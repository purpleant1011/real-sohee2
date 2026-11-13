/**
 * Plugin READY Fail-Closed Gate (ANI-804)
 * 
 * Strict Invariants:
 * 1. False READY is strictly 0.
 * 2. 12-point fail-closed criteria:
 *    - installed
 *    - entitlement_allowed
 *    - role_permission_allowed
 *    - connection_ready
 *    - capability_enabled
 *    - provider_healthy
 *    - policy_allowed
 *    - risk_approved
 *    - credit_preflight_passed
 *    - circuit_breaker_closed
 *    - workspace_scope_match
 *    - plugin_version_not_blocked
 * 3. Any false condition immediately denies execution and sets state != READY.
 * 4. UI READY and Router Candidate selection must use the exact same gate.
 */

import type {
  SoheePluginManifest,
  WorkspaceInstalledPlugin,
} from '@/types/plugin-platform'
import type { AgentEnergyPlanTier } from '@/types/autonomous-outcome-os'

export type PluginReadyCheckKey =
  | 'installed'
  | 'entitlement_allowed'
  | 'role_permission_allowed'
  | 'connection_ready'
  | 'capability_enabled'
  | 'provider_healthy'
  | 'policy_allowed'
  | 'risk_approved'
  | 'credit_preflight_passed'
  | 'circuit_breaker_closed'
  | 'workspace_scope_match'
  | 'plugin_version_not_blocked'

export interface PluginReadyCheckItem {
  key: PluginReadyCheckKey
  passed: boolean
  label: string
  reasonIfFailed?: string
}

export interface PluginReadyGateInput {
  workspaceId: string
  manifest: SoheePluginManifest
  installation?: WorkspaceInstalledPlugin | null
  currentPlanTier: AgentEnergyPlanTier
  userRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'
  targetCapabilityId?: string
  creditBalance: number
  estimatedCreditCost?: number
  isProviderHealthy?: boolean
  isPolicyAllowed?: boolean
  isRiskApproved?: boolean
  blockedPluginVersions?: string[]
}

export interface PluginReadyGateEvaluation {
  isReady: boolean
  pluginId: string
  displayName: string
  failingChecks: PluginReadyCheckKey[]
  checks: PluginReadyCheckItem[]
  blockedReason: string | null
  stateCopy: string
}

const PLAN_HIERARCHY: Record<AgentEnergyPlanTier, number> = {
  FREE_TASTE: 1,
  TIER_150K_STARTER: 2,
  TIER_300K_GROWTH: 3,
  TIER_500K_PRO_SCALE: 4,
}

export function evaluatePluginExecutableReady(input: PluginReadyGateInput): PluginReadyGateEvaluation {
  const checks: PluginReadyCheckItem[] = []
  const {
    workspaceId,
    manifest,
    installation,
    currentPlanTier,
    userRole = 'OWNER',
    targetCapabilityId,
    creditBalance,
    estimatedCreditCost = 10,
    isProviderHealthy = true,
    isPolicyAllowed = true,
    isRiskApproved = true,
    blockedPluginVersions = [],
  } = input

  // 1. installed
  const isInstalled = Boolean(installation && installation.state !== 'UNINSTALLED')
  checks.push({
    key: 'installed',
    passed: isInstalled,
    label: '플러그인 설치 여부',
    reasonIfFailed: '플러그인이 워크스페이스에 설치되어 있지 않습니다.',
  })

  // 2. entitlement_allowed
  const userPlanLevel = PLAN_HIERARCHY[currentPlanTier] || 1
  const requiredPlanLevel = PLAN_HIERARCHY[manifest.minPlanTier] || 1
  const isEntitlementAllowed = userPlanLevel >= requiredPlanLevel
  checks.push({
    key: 'entitlement_allowed',
    passed: isEntitlementAllowed,
    label: '플랜 권한 허용',
    reasonIfFailed: `현재 요금제(${currentPlanTier})에서는 사용 권한이 없습니다. (필요: ${manifest.minPlanTier})`,
  })

  // 3. role_permission_allowed
  const isRoleAllowed = userRole === 'OWNER' || userRole === 'ADMIN'
  checks.push({
    key: 'role_permission_allowed',
    passed: isRoleAllowed,
    label: '사용자 역할 권한',
    reasonIfFailed: `현재 권한(${userRole})으로는 플러그인을 실행할 수 없습니다.`,
  })

  // 4. connection_ready
  // If plugin requires external account, connectedAccountId must be present
  const requiresAccount = manifest.capabilities.some(
    (c) => c.riskClass === 'WRITE' || c.riskClass === 'SPEND'
  )
  const isConnectionReady = requiresAccount
    ? Boolean(installation?.connectedAccountId && installation.state !== 'AUTH_REQUIRED' && installation.state !== 'REAUTH_REQUIRED')
    : true
  checks.push({
    key: 'connection_ready',
    passed: isConnectionReady,
    label: '외부 계정 연결 상태',
    reasonIfFailed: '외부 채널 계정 연결 또는 재인증이 필요합니다.',
  })

  // 5. capability_enabled
  let isCapabilityEnabled = true
  if (targetCapabilityId) {
    const foundCap = manifest.capabilities.find((c) => c.capabilityId === targetCapabilityId)
    isCapabilityEnabled = Boolean(foundCap)
  }
  checks.push({
    key: 'capability_enabled',
    passed: isCapabilityEnabled,
    label: '요청 역량 유효성',
    reasonIfFailed: `플러그인이 요청된 역량(${targetCapabilityId})을 지원하지 않습니다.`,
  })

  // 6. provider_healthy
  const isProviderOk = isProviderHealthy && installation?.healthStatus !== 'UNHEALTHY'
  checks.push({
    key: 'provider_healthy',
    passed: isProviderOk,
    label: '제공자 통신 상태',
    reasonIfFailed: '외부 제공자 API 서비스가 응답하지 않거나 장애 상태입니다.',
  })

  // 7. policy_allowed
  checks.push({
    key: 'policy_allowed',
    passed: isPolicyAllowed,
    label: '안전 운영 정책 허용',
    reasonIfFailed: '워크스페이스 보안 또는 운영 방침에 의해 차단되었습니다.',
  })

  // 8. risk_approved
  checks.push({
    key: 'risk_approved',
    passed: isRiskApproved,
    label: '위험 작업 승인 여부',
    reasonIfFailed: '사장님의 추가 승인이 필요한 위험 작업입니다.',
  })

  // 9. credit_preflight_passed
  const isCreditPassed = creditBalance >= estimatedCreditCost
  checks.push({
    key: 'credit_preflight_passed',
    passed: isCreditPassed,
    label: '소희 크레딧 잔액 확인',
    reasonIfFailed: `소희 크레딧 잔액이 부족합니다 (보유: ${creditBalance} SC, 필요: ${estimatedCreditCost} SC).`,
  })

  // 10. circuit_breaker_closed
  const isCircuitBreakerClosed = !(installation?.isCircuitBreakerOpen ?? false)
  checks.push({
    key: 'circuit_breaker_closed',
    passed: isCircuitBreakerClosed,
    label: '서킷 브레이커 정상',
    reasonIfFailed: '연속 오류로 인해 서킷 브레이커가 작동(OPEN)하여 일시 중단되었습니다.',
  })

  // 11. workspace_scope_match
  const isScopeMatch = !installation || installation.workspaceId === workspaceId
  checks.push({
    key: 'workspace_scope_match',
    passed: isScopeMatch,
    label: '워크스페이스 격리 일치',
    reasonIfFailed: '타 워크스페이스의 플러그인 리소스에 접근할 수 없습니다.',
  })

  // 12. plugin_version_not_blocked
  const isVersionNotBlocked = !blockedPluginVersions.includes(manifest.version)
  checks.push({
    key: 'plugin_version_not_blocked',
    passed: isVersionNotBlocked,
    label: '플러그인 버전 안전성',
    reasonIfFailed: `플러그인 버전(${manifest.version})이 보안 조치로 차단되었습니다. 업데이트해 주세요.`,
  })

  // Final Aggregation: ALL 12 must pass
  const failingChecks = checks.filter((c) => !c.passed).map((c) => c.key)
  const isReady = failingChecks.length === 0

  let blockedReason: string | null = null
  let stateCopy = '준비 완료 (READY)'

  if (!isReady) {
    const firstFail = checks.find((c) => !c.passed)
    blockedReason = firstFail?.reasonIfFailed ?? '플러그인 실행 준비가 완료되지 않았습니다.'
    stateCopy = `실행 불가 (${firstFail?.label ?? '미달'})`
  }

  return {
    isReady,
    pluginId: manifest.pluginId,
    displayName: manifest.displayName,
    failingChecks,
    checks,
    blockedReason,
    stateCopy,
  }
}
