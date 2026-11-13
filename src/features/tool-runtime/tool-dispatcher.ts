/**
 * Master Real Domain Tool Dispatcher (ANI-920, ANI-919)
 * 
 * Replaces synthetic success mocks with real domain executors.
 * Enforces preflight checks: Kill Switch, credit sufficiency, scope approval, and fail-closed handling.
 */

import { resolveCapabilityId, SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry';
import { ToolAdmissionController } from '@/lib/mcp-gateway/tool-admission-controller';
import {
  DomainToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolPreflightResult,
  ToolStatus,
} from './types';
import { contentDispatcher } from './dispatchers/content-dispatcher';
import { customerDispatcher } from './dispatchers/customer-dispatcher';
import { adsDispatcher } from './dispatchers/ads-dispatcher';
import { soheeDispatcher } from './dispatchers/sohee-dispatcher';
import { resultsDispatcher } from './dispatchers/results-dispatcher';
import { systemDispatcher } from './dispatchers/system-dispatcher';
import { recoveryDispatcher } from './dispatchers/recovery-dispatcher';

export class ToolDispatcher {
  private static readonly domainMap: Record<string, DomainToolHandler> = {
    // Content & Media
    'content.generate': contentDispatcher,
    'content.rewrite': contentDispatcher,
    'image.generate': contentDispatcher,
    'mcp_generate_visual_image': contentDispatcher,
    'publish.create': contentDispatcher,
    'mcp_publish_live': contentDispatcher,

    // CRM & Interaction
    'customer.search': customerDispatcher,
    'mcp_query_customers': customerDispatcher,
    'comment.reply': customerDispatcher,
    'dm.send': customerDispatcher,
    'reservation.list': customerDispatcher,
    'reservation.create': customerDispatcher,
    'mcp_manage_reservation': customerDispatcher,
    'review.list': customerDispatcher,
    'review.respond': customerDispatcher,
    'interaction.list': customerDispatcher,
    'comment.reply_draft': customerDispatcher,
    'dm.reply_draft': customerDispatcher,

    // Booking Recovery (ANI-1512 Safe Discovery & Dispatch)
    'recovery.list': recoveryDispatcher,
    'recovery.open': recoveryDispatcher,
    'recovery.prepare': recoveryDispatcher,
    'recovery.get': recoveryDispatcher,
    'recovery.request_send_approval': recoveryDispatcher,
    'recovery.request_booking_approval': recoveryDispatcher,

    // Ads
    'ads.list': adsDispatcher,
    'ads.status': adsDispatcher,
    'campaign.create': adsDispatcher,

    // My Sohee
    'automation.list': soheeDispatcher,
    'knowledge.search': soheeDispatcher,
    'knowledge.propose': soheeDispatcher,
    'autonomy.update': soheeDispatcher,
    'mcp_control_autonomy': soheeDispatcher,
    'emergency_killswitch': soheeDispatcher,
    'mcp_emergency_killswitch': soheeDispatcher,

    // Results & Reports
    'performance.summary': resultsDispatcher,
    'report.generate': resultsDispatcher,

    // System & Navigation
    'app.navigate': systemDispatcher,
    'mcp_navigate_console': systemDispatcher,
    'credit.status': systemDispatcher,
  };

  /**
   * Preflight validation before executing any domain tool
   */
  public static async runPreflight(
    toolId: string,
    context: ToolExecutionContext
  ): Promise<ToolPreflightResult> {
    const canonicalToolId = resolveCapabilityId(toolId);
    if (context.allowedCapabilityIds !== undefined
      && !context.allowedCapabilityIds.some(id => resolveCapabilityId(id) === canonicalToolId)) {
      return { allowed: false, status: 'BLOCKED', errorCode: 'UNAUTHORIZED_SCOPE', rejectionReason: '이 요청에 허용되지 않은 도구입니다.' };
    }
    if (context.authorizeCapability) {
      try {
        if (!await context.authorizeCapability(canonicalToolId)) return { allowed: false, status: 'BLOCKED', errorCode: 'UNAUTHORIZED_SCOPE', rejectionReason: '현재 실행 권한을 확인할 수 없습니다.' };
      } catch {
        return { allowed: false, status: 'BLOCKED', errorCode: 'UNAUTHORIZED_SCOPE', rejectionReason: '현재 실행 권한을 확인할 수 없습니다.' };
      }
    }

    // 1. Check Admission Controller Gate (ANI-974)
    const admission = await ToolAdmissionController.checkAdmission(
      {
        workspaceId: context.workspaceId,
        capabilityId: canonicalToolId,
      },
      {
        creditBalance: context.creditBalance,
        isTestAccount: context.isTestAccount,
      }
    );

    if (!admission.admitted) {
      const isKillSwitch =
        admission.errorCode === 'KILLSWITCH_ACTIVE' ||
        admission.status === 'BLOCKED' && admission.reason?.includes('킬스위치');
      const isNotImplemented =
        admission.status === 'NOT_IMPLEMENTED' ||
        admission.errorCode === 'NOT_IMPLEMENTED' ||
        !this.domainMap[canonicalToolId];
      const isCredits = admission.errorCode === 'INSUFFICIENT_CREDITS';

      let errorCode = 'CAPABILITY_NOT_READY';
      if (isKillSwitch) errorCode = 'KILLSWITCH_ACTIVE';
      else if (isNotImplemented) errorCode = 'NOT_IMPLEMENTED';
      else if (isCredits) errorCode = 'INSUFFICIENT_CREDITS';

      return {
        allowed: false,
        status: (admission.status as ToolStatus) || 'BLOCKED',
        errorCode,
        rejectionReason: admission.reason || `도구 [${toolId}] 실행 조건이 충족되지 않았습니다.`,
      };
    }

    // 2. Check handler registration as defense-in-depth
    const handler = this.domainMap[canonicalToolId];
    if (!handler) {
      return {
        allowed: false,
        status: 'NOT_IMPLEMENTED',
        errorCode: 'NOT_IMPLEMENTED',
        rejectionReason: `도구 [${toolId}]에 대응하는 실제 도메인 디스패처가 등록되지 않았습니다 (Fail-Closed).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Dispatch and execute a domain tool with full safety gates
   */
  public static async dispatch(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const canonicalToolId = resolveCapabilityId(toolName);

    const interrupted = async (): Promise<ToolExecutionResult | undefined> => {
      if (context.authorizeCapability) {
        let allowed = false;
        try { allowed = await context.authorizeCapability(canonicalToolId); } catch { /* Authority lookup failure is not permission. */ }
        if (!allowed) return { success: false, toolId: canonicalToolId, status: 'BLOCKED', error: { code: 'UNAUTHORIZED_SCOPE', message: '현재 실행 권한을 확인할 수 없어 추가 실행을 차단했어요.' } };
      }
      const executable = context.canContinue ? await context.canContinue() : true;
      const code = context.signal?.aborted || !executable
        ? 'ABORTED'
        : context.deadlineAt !== undefined && Date.now() >= context.deadlineAt ? 'TIMEOUT' : undefined;
      if (!code) return undefined;
      return {
        success: false, toolId: canonicalToolId, status: 'BLOCKED',
        error: { code, message: '작업 중단 또는 제한 시간 초과로 추가 실행을 차단했습니다.' },
      };
    };
    const beforePreflight = await interrupted();
    if (beforePreflight) return beforePreflight;

    // 1. Run Preflight
    const preflight = await this.runPreflight(canonicalToolId, context);
    if (!preflight.allowed) {
      let status: ToolStatus = 'BLOCKED';
      if (preflight.status) {
        status = preflight.status;
      } else if (preflight.errorCode === 'NOT_IMPLEMENTED') {
        status = 'NOT_IMPLEMENTED';
      }

      return {
        success: false,
        toolId: canonicalToolId,
        status,
        error: {
          code: preflight.errorCode || 'PREFLIGHT_BLOCKED',
          message: preflight.rejectionReason || '도구 실행 사전 조건 검증에 실패했습니다.',
        },
      };
    }

    // 2. Find Handler
    const handler = this.domainMap[canonicalToolId];
    if (!handler) {
      return {
        success: false,
        toolId: canonicalToolId,
        status: 'NOT_IMPLEMENTED',
        error: {
          code: 'TOOL_NOT_IMPLEMENTED',
          message: `도구 [${canonicalToolId}]의 핸들러가 구현되지 않았습니다 (Fail-Closed).`,
        },
      };
    }

    // 3. Execute Handler with Real Backend
    let executionStarted = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const executionController = new AbortController();
    const abortExecution = () => executionController.abort(context.signal?.reason);
    const isWrite = SOHEE_CAPABILITY_REGISTRY[canonicalToolId]?.isWrite === true;
    try {
      const beforeStarting = await interrupted();
      if (beforeStarting) return beforeStarting;
      // A durable activity hook must finish before the handler can cause effects.
      await context.onExecutionStarting?.();
      const beforeExecution = await interrupted();
      if (beforeExecution) return beforeExecution;
      context.signal?.addEventListener('abort', abortExecution, { once: true });
      if (context.signal?.aborted) abortExecution();
      if (context.deadlineAt !== undefined) {
        const deadlineAt = context.deadlineAt;
        const scheduleDeadline = () => {
          const remaining = deadlineAt - Date.now();
          if (remaining <= 0) executionController.abort(new DOMException('Tool deadline exceeded', 'TimeoutError'));
          else deadlineTimer = setTimeout(scheduleDeadline, Math.min(remaining, 2_147_483_647));
        };
        scheduleDeadline();
      }
      executionController.signal.throwIfAborted();
      executionStarted = true;
      const executionResult = await handler.execute(
        { ...args, _toolName: canonicalToolId },
        { ...context, signal: executionController.signal }
      );
      // A completed write is not undone by cancellation. Discard only stale read results.
      if (!isWrite) {
        const afterExecution = await interrupted();
        if (afterExecution) return afterExecution;
      }
      return executionResult;
    } catch (err: unknown) {
      // Once a write handler starts, a lost response cannot establish that no effect occurred.
      const resultUnknown = executionStarted && isWrite;
      if (!resultUnknown) {
        const interruption = await interrupted();
        if (interruption) return interruption;
      }
      return {
        success: false,
        toolId: canonicalToolId,
        status: resultUnknown ? 'RESULT_UNKNOWN' : 'FAILED',
        error: {
          code: resultUnknown ? 'RESULT_UNKNOWN' : 'TOOL_EXECUTION_ERROR',
          message: err instanceof Error ? err.message : String(err),
          details: err,
        },
      };
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      context.signal?.removeEventListener('abort', abortExecution);
    }
  }
}
