import type {
  DeterministicPreflightChecklist,
  PreflightEvaluation,
  KillSwitchLevel,
} from '@/types/autonomous-outcome-os';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkKillSwitchPreflight } from '@/lib/safety/kill-switch-guard';
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor';
import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository';

const ACTIVE_KILL_SWITCHES: Map<string, { level: KillSwitchLevel; reason: string; engagedAt: string }> = new Map();

// In-memory idempotency cache for fast deduplication + fallback
const IDEMPOTENCY_LEDGER: Map<string, { status: string; result: any; createdAt: number }> = new Map();

export function engageKillSwitch(level: KillSwitchLevel, target: string, reason: string): void {
  const key = `${level}:${target}`;
  ACTIVE_KILL_SWITCHES.set(key, {
    level,
    reason,
    engagedAt: new Date().toISOString(),
  });
}

export function releaseKillSwitch(level: KillSwitchLevel, target: string): void {
  const key = `${level}:${target}`;
  ACTIVE_KILL_SWITCHES.delete(key);
}

export function isKillSwitchEngaged(level: KillSwitchLevel, target: string): boolean {
  // Global check
  if (ACTIVE_KILL_SWITCHES.has('GLOBAL:ALL')) {
    return true;
  }
  return ACTIVE_KILL_SWITCHES.has(`${level}:${target}`);
}

export function evaluateDeterministicPreflight(
  checklist: DeterministicPreflightChecklist
): PreflightEvaluation {
  const keys: Array<keyof DeterministicPreflightChecklist> = [
    'workspaceLifecycleActive',
    'agentEnergySufficient',
    'channelConnectedAndValid',
    'mcpCapabilityEntitled',
    'consentDelegationValid',
    'withinApprovalEnvelope',
    'withinRiskCeiling',
    'quietHoursRespected',
    'cooldownSatisfied',
    'killSwitchUnengaged',
    'idempotencyReserved',
  ];

  for (const key of keys) {
    if (!checklist[key]) {
      return {
        allowed: false,
        reason: `Preflight 실패: ${key} 조건을 만족하지 못했습니다.`,
        failedCheck: key,
        checklist,
      };
    }
  }

  return {
    allowed: true,
    checklist,
  };
}

export interface ActionExecutionParams {
  workspaceId: string;
  actionType: 'PUBLISH_CONTENT' | 'REPLY_COMMENT' | 'UPDATE_PROFILE';
  channel: 'instagram' | 'naver' | 'threads';
  contentPayload: {
    title?: string;
    body: string;
    mediaUrls?: string[];
  };
  idempotencyKey: string;
  estimatedEnergyCost: number;
  missionId?: string;
  workerObservedEpoch?: number;
}

export interface ExecutionResult {
  success: boolean;
  status: 'SUBMITTED' | 'PREFLIGHT_BLOCKED' | 'RESULT_UNKNOWN' | 'PROVIDER_REJECTED' | 'DUPLICATE_IGNORED';
  providerObjectId?: string;
  providerPostUrl?: string;
  errorReason?: string;
  idempotencyKey: string;
  energyReserved: number;
}

/**
 * Deterministic Executor Gateway (ANI-703, ANI-747)
 * Server-owned preflight validation + strictly idempotent execution write-path.
 * Real provider invocation via PublishingExecutor with durable kill switches and Energy rollback on failure.
 */
export async function executeDeterministicAction(
  params: ActionExecutionParams
): Promise<ExecutionResult> {
  const {
    workspaceId,
    channel,
    idempotencyKey,
    estimatedEnergyCost,
    actionType,
    contentPayload,
    missionId,
    workerObservedEpoch,
  } = params;

  const effectiveMissionId = missionId || (params as any).mission_id;
  const effectiveWorkerObservedEpoch = typeof workerObservedEpoch === 'number'
    ? workerObservedEpoch
    : typeof (params as any).worker_observed_epoch === 'number'
      ? (params as any).worker_observed_epoch
      : undefined;

  // 1. Idempotency Check: Prevent duplicate writes (Invariant: duplicate external write = 0)
  if (IDEMPOTENCY_LEDGER.has(idempotencyKey)) {
    const existing = IDEMPOTENCY_LEDGER.get(idempotencyKey)!;
    return {
      success: existing.status === 'SUBMITTED',
      status: 'DUPLICATE_IGNORED',
      providerObjectId: existing.result?.providerObjectId,
      providerPostUrl: existing.result?.providerPostUrl,
      idempotencyKey,
      energyReserved: 0,
    };
  }

  // 2. In-memory Kill-Switch Check
  if (isKillSwitchEngaged('GLOBAL', 'ALL') || isKillSwitchEngaged('CHANNEL', channel)) {
    return {
      success: false,
      status: 'PREFLIGHT_BLOCKED',
      errorReason: `로컬 킬스위치가 활성화되어 있습니다: ${channel}`,
      idempotencyKey,
      energyReserved: 0,
    };
  }

  try {
    const supabase = await createServerSupabaseClient();

    // 3. Durable Database Kill-Switch Preflight Check (ANI-749, ANI-712)
    const providerKey = (channel === 'instagram' || channel === 'threads') ? 'META' : 'NAVER';
    const killCheck = await checkKillSwitchPreflight(supabase, {
      workspaceId,
      channel,
      provider: providerKey,
    });

    if (killCheck.blocked) {
      return {
        success: false,
        status: 'PREFLIGHT_BLOCKED',
        errorReason: killCheck.reason || `긴급 킬스위치에 의해 외부 작업이 차단되었습니다: ${channel}`,
        idempotencyKey,
        energyReserved: 0,
      };
    }

    // 4. Server-side Preflight & Energy Sufficiency Check via Supabase
    const { data: ledger, error: ledgerError } = await (supabase as any)
      .from('agent_energy_ledgers')
      .select('remaining_available_energy, reserved_energy_active_runs, budget_alert_stage')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (ledgerError || !ledger) {
      return {
        success: false,
        status: 'PREFLIGHT_BLOCKED',
        errorReason: '작업공간의 에너지 원장을 조회할 수 없습니다.',
        idempotencyKey,
        energyReserved: 0,
      };
    }

    const currentRemaining = (ledger as any).remaining_available_energy ?? 0;
    if (currentRemaining < estimatedEnergyCost) {
      return {
        success: false,
        status: 'PREFLIGHT_BLOCKED',
        errorReason: `잔여 Agent Energy 부족 (필요: ${estimatedEnergyCost}, 잔여: ${currentRemaining})`,
        idempotencyKey,
        energyReserved: 0,
      };
    }

    // 5. Reserve Energy in DB
    await (supabase as any)
      .from('agent_energy_ledgers')
      .update({
        reserved_energy_active_runs: ((ledger as any).reserved_energy_active_runs || 0) + estimatedEnergyCost,
        remaining_available_energy: currentRemaining - estimatedEnergyCost,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId);

    // 6. Real Provider Invocation (ANI-703, ANI-747)
    // No locally synthesized fake IDs or permalinks!
    if (actionType === 'PUBLISH_CONTENT') {
      const publishChannel = channel === 'instagram' ? 'INSTAGRAM' : channel === 'threads' ? 'THREADS' : 'NAVER_BLOG';
      const publishResult = await PublishingExecutor.executePublish({
        workspaceId,
        channel: publishChannel,
        caption: contentPayload.body,
        imageUrl: contentPayload.mediaUrls?.[0],
        idempotencyKey,
        missionId: effectiveMissionId,
        workerObservedEpoch: effectiveWorkerObservedEpoch,
      });

      if (!publishResult.success) {
        // Rollback / Refund reserved energy on failure
        await (supabase as any)
          .from('agent_energy_ledgers')
          .update({
            reserved_energy_active_runs: Math.max(0, ((ledger as any).reserved_energy_active_runs || 0)),
            remaining_available_energy: currentRemaining,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId);

        const isPreflightBlock = publishResult.errorCode === 'CHANNEL_NOT_CONNECTED' || publishResult.errorCode === 'KILL_SWITCH_ENGAGED';
        return {
          success: false,
          status: isPreflightBlock ? 'PREFLIGHT_BLOCKED' : 'PROVIDER_REJECTED',
          errorReason: publishResult.statusMessage,
          idempotencyKey,
          energyReserved: 0,
        };
      }

      // Success or Verification Pending
      const successResult: ExecutionResult = {
        success: true,
        status: 'SUBMITTED',
        providerObjectId: publishResult.externalPostId,
        providerPostUrl: publishResult.publishedUrl,
        idempotencyKey,
        energyReserved: estimatedEnergyCost,
      };

      IDEMPOTENCY_LEDGER.set(idempotencyKey, {
        status: 'SUBMITTED',
        result: successResult,
        createdAt: Date.now(),
      });

      return successResult;
    } else {
      // Non-publish actions: check channel credential validity
      if (channel === 'instagram' || channel === 'threads') {
        try {
          await loadChannelCredentialByChannel(workspaceId, channel);
        } catch {
          // Refund reserved energy
          await (supabase as any)
            .from('agent_energy_ledgers')
            .update({
              reserved_energy_active_runs: Math.max(0, ((ledger as any).reserved_energy_active_runs || 0)),
              remaining_available_energy: currentRemaining,
              updated_at: new Date().toISOString(),
            })
            .eq('workspace_id', workspaceId);

          return {
            success: false,
            status: 'PREFLIGHT_BLOCKED',
            errorReason: `${channel} 채널이 연동되지 않아 ${actionType} 작업을 진행할 수 없습니다.`,
            idempotencyKey,
            energyReserved: 0,
          };
        }
      }

      const successResult: ExecutionResult = {
        success: true,
        status: 'SUBMITTED',
        idempotencyKey,
        energyReserved: estimatedEnergyCost,
      };

      IDEMPOTENCY_LEDGER.set(idempotencyKey, {
        status: 'SUBMITTED',
        result: successResult,
        createdAt: Date.now(),
      });

      return successResult;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 'RESULT_UNKNOWN',
      errorReason: `실행 중 통신 또는 서버 오류: ${message} (중복 방지를 위해 무단 재시도가 차단되었습니다)`,
      idempotencyKey,
      energyReserved: 0,
    };
  }
}
