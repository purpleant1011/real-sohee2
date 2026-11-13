/**
 * Dynamic Tool Admission Controller (ANI-974)
 * 
 * Preflight Safety & Operational Policy Gate:
 * Enforces strict Fail-Closed admission before any tool execution:
 * 1. Operational Readiness Check: Must be OPERATIONAL_READY. If NOT_IMPLEMENTED,
 *    DISCONNECTED, BLOCKED, or DEGRADED, immediately throws CAPABILITY_NOT_READY.
 * 2. Kill Switch Check: Emergency kill switch blocks all external mutations.
 * 3. FinOps Credit Gate: Verifies credit balance sufficiency for cost-bearing tools.
 * 4. Tenant Scope Authorization: Prevents unentitled or cross-tenant execution.
 */

import { resolveCapabilityId, SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry';
import { AgentControlPlaneService, type AgentControlState } from '@/features/marketing-agent/engine/agent-control-state';
import {
  CapabilityStatusRegistry,
  CapabilityOperationalStatus,
} from './capability-status-registry';
import type { ToolExecutionEnvelope } from './tool-execution-envelope';

export class CapabilityNotReadyError extends Error {
  public readonly code = 'CAPABILITY_NOT_READY';
  public readonly capabilityId: string;
  public readonly operationalStatus: CapabilityOperationalStatus;
  public readonly reason: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    capabilityId: string,
    operationalStatus: CapabilityOperationalStatus,
    reason: string,
    details?: Record<string, unknown>
  ) {
    super(`[CAPABILITY_NOT_READY] 도구 '${capabilityId}' 실행 차단 (${operationalStatus}): ${reason}`);
    this.name = 'CapabilityNotReadyError';
    this.capabilityId = capabilityId;
    this.operationalStatus = operationalStatus;
    this.reason = reason;
    this.details = details;
  }
}

export interface AdmissionOptions {
  creditBalance?: number;
  isTestAccount?: boolean;
  actorId?: string;
  requiredScopes?: string[];
  tenantScopes?: string[];
}

export interface ToolAdmissionResult {
  admitted: boolean;
  capabilityId: string;
  workspaceId: string;
  admittedAt: string;
}

export interface AdmissionCheckResult {
  admitted: boolean;
  status?: CapabilityOperationalStatus;
  reason?: string;
  errorCode?: string;
}

export class ToolAdmissionController {
  /**
   * Non-throwing admission preflight check
   */
  public static async checkAdmission(
    envelopeOrRequest: ToolExecutionEnvelope | { workspaceId: string; capabilityId: string; inputPayload?: Record<string, unknown> },
    options?: AdmissionOptions
  ): Promise<AdmissionCheckResult> {
    const canonicalId = resolveCapabilityId(envelopeOrRequest.capabilityId);
    const workspaceId = envelopeOrRequest.workspaceId;

    const isKillSwitchTool = canonicalId === 'emergency_killswitch' || canonicalId === 'mcp_emergency_killswitch';

    // 1. Check Kill Switch via Authoritative DB State (Fail-Closed)
    let controlState: AgentControlState | undefined;
    try {
      controlState = await AgentControlPlaneService.getControlState(workspaceId);
    } catch {
      // DB 조회 실패(PersistenceError)는 fail-closed: 읽기 전용 LOW 위험 도구가 아니면 차단하고 한국어 사유 반환, emergency_killswitch 도구 자체는 항상 통과.
      const capDef = SOHEE_CAPABILITY_REGISTRY[canonicalId];
      const isReadOnlyLowRisk = Boolean(capDef && !capDef.isWrite && capDef.riskTier === 'LOW');
      if (!isReadOnlyLowRisk && !isKillSwitchTool) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reason: '시스템 제어 상태를 확인할 수 없어 안전을 위해 도구 실행이 차단되었습니다. 잠시 후 다시 시도해 주세요.',
          errorCode: 'CONTROL_STATE_DB_ERROR',
        };
      }
      // 읽기 전용 저위험 도구·긴급 차단 자체에는 캐시를 허가 근거로 쓰지 않는다.
    }

    const isKillSwitchActive =
      controlState?.actual_mode === 'BLOCKED' ||
      controlState?.actualMode === 'BLOCKED' ||
      controlState?.blocker_code === 'KILL_SWITCH_ACTIVE' ||
      Boolean(controlState?.killSwitchActive);

    if (isKillSwitchActive && !isKillSwitchTool) {
      return {
        admitted: false,
        status: 'BLOCKED',
        reason: '긴급 킬스위치가 활성화되어 있어 도구 실행이 차단되었습니다.',
        errorCode: 'KILLSWITCH_ACTIVE',
      };
    }

    // 2. Check Operational Readiness from Registry
    const statusResult = await CapabilityStatusRegistry.getStatus(workspaceId, canonicalId);
    if (statusResult.status !== 'OPERATIONAL_READY') {
      return {
        admitted: false,
        status: statusResult.status,
        reason: statusResult.reason || `도구 [${canonicalId}]의 상태가 ${statusResult.status}입니다.`,
        errorCode: 'CAPABILITY_NOT_READY',
      };
    }

    // 3. FinOps Credit Sufficiency Gate
    if (options && !options.isTestAccount && options.creditBalance !== undefined) {
      const isCostBearing =
        canonicalId === 'image.generate' ||
        canonicalId === 'mcp_generate_visual_image' ||
        canonicalId === 'publish.create' ||
        canonicalId === 'mcp_publish_live';

      const minCost = canonicalId.startsWith('image') ? 150 : 30;
      if (isCostBearing && options.creditBalance < minCost) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reason: `잔여 크레딧(${options.creditBalance})이 필요 크레딧(${minCost})보다 부족합니다.`,
          errorCode: 'INSUFFICIENT_CREDITS',
        };
      }
    }

    // 4. Tenant Scope Check
    if (options?.requiredScopes && options?.tenantScopes) {
      const hasAllScopes = options.requiredScopes.every(sc => options.tenantScopes?.includes(sc));
      if (!hasAllScopes) {
        return {
          admitted: false,
          status: 'BLOCKED',
          reason: '테넌트 권한 스코프가 부족합니다.',
          errorCode: 'UNAUTHORIZED_SCOPE',
        };
      }
    }

    return { admitted: true, status: 'OPERATIONAL_READY' };
  }

  /**
   * Fail-Closed Admission Gate: Throws CapabilityNotReadyError if not admitted
   */
  public static async admit(
    envelopeOrRequest: ToolExecutionEnvelope | { workspaceId: string; capabilityId: string; inputPayload?: Record<string, unknown> },
    options?: AdmissionOptions
  ): Promise<ToolAdmissionResult> {
    const canonicalId = resolveCapabilityId(envelopeOrRequest.capabilityId);
    const workspaceId = envelopeOrRequest.workspaceId;

    const check = await this.checkAdmission(envelopeOrRequest, options);

    if (!check.admitted) {
      throw new CapabilityNotReadyError(
        canonicalId,
        check.status || 'BLOCKED',
        check.reason || '도구 실행 조건이 충족되지 않았습니다.',
        {
          errorCode: check.errorCode,
          workspaceId,
          admitted: false,
        }
      );
    }

    return {
      admitted: true,
      capabilityId: canonicalId,
      workspaceId,
      admittedAt: new Date().toISOString(),
    };
  }
}
