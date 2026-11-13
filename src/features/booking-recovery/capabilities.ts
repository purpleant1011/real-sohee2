/**
 * Booking Recovery Capability Definitions & Readiness Gate (Task 2)
 *
 * 모델 실행 통제 원칙:
 * 1. 모델에는 조회/초안 제안 도구만 노출한다.
 * 2. 승인(approve_send, approve_booking), 실제 발송(send_dm), 확정 실행(confirm_booking) 권한은 모델에 노출하지 않는다.
 * 3. 승인은 사용자 화면 카드 인터랙션에서만 서버 인증 후 실행된다.
 * 4. 도구 준비 상태(readiness)는 연결, 스코프, 정책, 킬스위치, 신선도가 완전히 입증(FRESH)되어야만 READY가 된다 (UNKNOWN = NOT_READY).
 */

export const RECOVERY_CAPABILITY_TOOLS = [
  'recovery.list',
  'recovery.open',
  'recovery.prepare',
  'recovery.get',
  'recovery.request_send_approval',
  'recovery.request_booking_approval',
] as const;

export type RecoveryToolId = (typeof RECOVERY_CAPABILITY_TOOLS)[number];

export interface ToolReadinessInput {
  connected: boolean;
  hasScope: boolean;
  policyAllowed: boolean;
  killSwitchActive: boolean;
  sourceFreshness: 'FRESH' | 'STALE' | 'UNKNOWN';
}

export interface ToolReadinessEvaluation {
  ready: boolean;
  reason?: 'KILL_SWITCH_ACTIVE' | 'NOT_CONNECTED' | 'SCOPE_MISSING' | 'POLICY_DISALLOWED' | 'SOURCE_NOT_FRESH';
  isStaleObservation?: boolean;
}

/**
 * Checks whether tool is safe and permitted to be exposed to AI model.
 */
export function isAllowedRecoveryModelTool(toolName: string): boolean {
  return (RECOVERY_CAPABILITY_TOOLS as readonly string[]).includes(toolName);
}

/**
 * Distinguishes read-only query tools from state-mutating proposal/request tools.
 */
export function isReadOnlyRecoveryTool(toolId: RecoveryToolId): boolean {
  return toolId === 'recovery.list' || toolId === 'recovery.get';
}

/**
 * Evaluates readiness for recovery capability tools.
 * - Read-only query tools (recovery.list, recovery.get) remain accessible for ledger audit/reconciliation even under kill switch or channel disconnect.
 * - Mutation/Proposal tools (recovery.open, prepare, request_send_approval, request_booking_approval) are fail-closed on any missing prerequisite.
 */
export function evaluateRecoveryCapabilityReadiness(
  toolId: RecoveryToolId,
  input: ToolReadinessInput
): ToolReadinessEvaluation {
  const isReadOnly = isReadOnlyRecoveryTool(toolId);

  // Read-only inspection tools must never be locked by external write gates
  if (isReadOnly) {
    return {
      ready: true,
      isStaleObservation: input.sourceFreshness !== 'FRESH',
    };
  }

  // Mutation / Proposal / Approval Request tools: Strictly fail-closed
  if (input.killSwitchActive) {
    return { ready: false, reason: 'KILL_SWITCH_ACTIVE' };
  }

  if (!input.connected) {
    return { ready: false, reason: 'NOT_CONNECTED' };
  }

  if (!input.hasScope) {
    return { ready: false, reason: 'SCOPE_MISSING' };
  }

  if (!input.policyAllowed) {
    return { ready: false, reason: 'POLICY_DISALLOWED' };
  }

  if (input.sourceFreshness !== 'FRESH') {
    return { ready: false, reason: 'SOURCE_NOT_FRESH' };
  }

  return { ready: true };
}
