/**
 * Sohee V0.9 Agent Approval Service (ANI-939)
 * 
 * Durable Human-In-The-Loop Approval Ledger:
 * - Persistent storage in `agent_approvals` table.
 * - Strict ActionRun linkage & version optimistic locking.
 * - Resumes execution with `intentMode = 'EXECUTE'` upon approval.
 * - Cancels ActionRun upon rejection.
 * - Transitions AgentSession state (AWAITING_APPROVAL -> ACTIVE).
 * - Zero client-only synthetic approvals.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { AgentSessionService } from './agent-session-service';
import { ConversationRepository } from '@/lib/conversation/conversation-repository';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';
import { SupabaseCreativeBundleStore } from '@/features/creative/creative-bundle-store';
import { assertPublishMissionGateAllowed } from '@/lib/mission-os/mission-lineage-guard';

/**
 * 승인 1건의 도구 실행은 프로세스당 한 번만 (ANI-1778).
 *
 * DB 낙관적 잠금(CAS)은 `agent_approvals` 레코드가 있을 때만 동작한다. 메모리 스토어로만
 * 존재하는 승인은 동시에 들어온 두 APPROVE 가 모두 PENDING 을 읽고 각자 도구를 실행할 수
 * 있어, 발송·게시·예약 같은 외부 쓰기가 두 번 나간다. 이 집합이 그 경로의 마지막 차단층이다.
 * 일부러 지우지 않는다 — 실패한 실행을 자동으로 다시 실행하지 않는 쪽이 안전하다(fail-closed).
 */
const approvalExecutionClaims = new Set<string>();

/** 테스트 전용: 프로세스 실행 기록을 비운다. 제품 코드에서는 호출하지 않는다. */
export function resetApprovalExecutionClaimsForTests(): void {
  approvalExecutionClaims.clear();
}

export interface AgentApprovalRecord {
  id: string;
  workspaceId: string;
  proposalId: string;
  sessionId: string;
  actionRunId?: string | null;
  proposalType: string;
  title: string;
  description: string;
  targetField?: string | null;
  currentValue?: unknown;
  proposedValue: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  actorId?: string | null;
  rejectionReason?: string | null;
  version: number;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

export interface CreateProposalParams {
  workspaceId: string;
  sessionId: string;
  actionRunId?: string;
  proposalId?: string;
  proposalType: string;
  title: string;
  description: string;
  targetField?: string;
  currentValue?: unknown;
  proposedValue: Record<string, unknown>;
  expiresAt?: string;
}

export interface ResolveApprovalParams {
  workspaceId: string;
  proposalId: string;
  action: 'APPROVE' | 'REJECT';
  actorId?: string;
  rejectionReason?: string;
  expectedVersion?: number;
}

export interface ResolveApprovalResult {
  success: boolean;
  status: 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'PENDING';
  approval: AgentApprovalRecord;
  executionResult?: Record<string, unknown>;
  error?: {
    code:
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'APPROVAL_EXPIRED'
      | 'ALREADY_RESOLVED'
      | 'ALREADY_EXECUTING'
      | 'RESULT_UNKNOWN'
      | 'ARTIFACT_REVIEW_REQUIRED'
      | 'EXECUTION_FAILED';
    message: string;
  };
}

const approvalMemoryStore = new Map<string, AgentApprovalRecord>();

function makeApprovalKey(workspaceId: string, proposalId: string): string {
  return `${workspaceId}:${proposalId}`;
}

export class AgentApprovalService {
  /**
   * Reset in-memory cache (for testing)
   */
  public static resetMemoryStoreForTesting(): void {
    approvalMemoryStore.clear();
  }

  /**
   * 1. Create or upsert a durable proposal
   */
  public static async createProposal(params: CreateProposalParams): Promise<AgentApprovalRecord> {
    const proposalId = params.proposalId || `prop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const row = {
      workspace_id: params.workspaceId,
      proposal_id: proposalId,
      session_id: params.sessionId,
      action_run_id: params.actionRunId || null,
      proposal_type: params.proposalType,
      title: params.title,
      description: params.description,
      target_field: params.targetField || null,
      current_value: params.currentValue ?? null,
      proposed_value: params.proposedValue,
      status: 'PENDING',
      version: 1,
      expires_at: params.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h default
      updated_at: new Date().toISOString()
    };

    let record: AgentApprovalRecord;

    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;

      const { data, error } = await db
        .from('agent_approvals')
        .upsert(row, { onConflict: 'workspace_id,proposal_id' })
        .select('*')
        .single();

      if (error || !data) {
        record = {
          id: crypto.randomUUID(),
          workspaceId: params.workspaceId,
          proposalId,
          sessionId: params.sessionId,
          actionRunId: params.actionRunId,
          proposalType: params.proposalType,
          title: params.title,
          description: params.description,
          targetField: params.targetField,
          currentValue: params.currentValue,
          proposedValue: params.proposedValue,
          status: 'PENDING',
          version: 1,
          expiresAt: row.expires_at,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      } else {
        record = this.mapRowToRecord(data);
      }
    } catch {
      record = {
        id: crypto.randomUUID(),
        workspaceId: params.workspaceId,
        proposalId,
        sessionId: params.sessionId,
        actionRunId: params.actionRunId,
        proposalType: params.proposalType,
        title: params.title,
        description: params.description,
        targetField: params.targetField,
        currentValue: params.currentValue,
        proposedValue: params.proposedValue,
        status: 'PENDING',
        version: 1,
        expiresAt: row.expires_at,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    approvalMemoryStore.set(makeApprovalKey(params.workspaceId, proposalId), record);

    // Set session status to AWAITING_APPROVAL
    await AgentSessionService.setSessionStatus(params.workspaceId, params.sessionId, 'AWAITING_APPROVAL');

    return record;
  }

  /**
   * 2. Query approvals for workspace
   */
  public static async getApprovals(
    workspaceId: string,
    options?: { sessionId?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' }
  ): Promise<AgentApprovalRecord[]> {
    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;

      let query = db
        .from('agent_approvals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });

      if (options?.sessionId) {
        query = query.eq('session_id', options.sessionId);
      }
      if (options?.status) {
        query = query.eq('status', options.status);
      }

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        return data.map((d: any) => this.mapRowToRecord(d));
      }
    } catch (err) {
      console.error('[AgentApprovalService] Error fetching approvals:', err);
    }

    // In-memory fallback
    const list = Array.from(approvalMemoryStore.values()).filter(
      (a) => a.workspaceId === workspaceId
    );
    return list.filter((a) => {
      if (options?.sessionId && a.sessionId !== options.sessionId) return false;
      if (options?.status && a.status !== options.status) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * 3. Resolve approval (Approve or Reject with optimistic locking)
   */
  public static async resolveApproval(params: ResolveApprovalParams): Promise<ResolveApprovalResult> {
    const memKey = makeApprovalKey(params.workspaceId, params.proposalId);
    let existingRecord: AgentApprovalRecord | null = null;
    let existingDbId: string | null = null;

    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;

      const { data: existing, error: fetchErr } = await db
        .from('agent_approvals')
        .select('*')
        .eq('workspace_id', params.workspaceId)
        .eq('proposal_id', params.proposalId)
        .single();

      if (!fetchErr && existing) {
        existingRecord = this.mapRowToRecord(existing);
        existingDbId = existing.id;
      }
    } catch {}

    // Fallback to in-memory store if DB didn't return
    if (!existingRecord) {
      existingRecord = approvalMemoryStore.get(memKey) || null;
    }

    if (!existingRecord) {
      return {
        success: false,
        status: params.action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        approval: null as any,
        error: {
          code: 'NOT_FOUND',
          message: `승인 요청 [${params.proposalId}]을 찾을 수 없습니다.`
        }
      };
    }

    // 연결된 실행 승인은 durable 원장이 유일한 권한 근거다. 캐시는 만료된 승인을 되살릴 수 없다.
    if (params.action === 'APPROVE' && existingRecord.actionRunId && !existingDbId) {
      return {
        success: false,
        status: existingRecord.status,
        approval: existingRecord,
        error: { code: 'RESULT_UNKNOWN', message: '최신 승인 상태를 확인하지 못했습니다. 외부 실행을 시작하지 않았습니다.' }
      };
    }

    // B. Check status (already resolved?)
    if (existingRecord.status !== 'PENDING') {
      return {
        success: false,
        status: existingRecord.status,
        approval: existingRecord,
        error: {
          code: 'ALREADY_RESOLVED',
          message: `이미 ${existingRecord.status} 처리된 승인 요청입니다.`
        }
      };
    }

    // C. Check expiration
    if (existingRecord.expiresAt && new Date(existingRecord.expiresAt).getTime() < Date.now()) {
      const expiredRecord: AgentApprovalRecord = {
        ...existingRecord,
        status: 'EXPIRED',
        updatedAt: new Date().toISOString()
      };
      approvalMemoryStore.set(memKey, expiredRecord);

      try {
        const supabase = await createServerSupabaseClient();
        const db = supabase as any;
        if (existingDbId) {
          await db
            .from('agent_approvals')
            .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
            .eq('id', existingDbId);
        }
      } catch {}

      return {
        success: false,
        status: 'REJECTED',
        approval: expiredRecord,
        error: {
          code: 'APPROVAL_EXPIRED',
          message: '승인 유효 시간이 만료되었습니다.'
        }
      };
    }

    // D. Version conflict check (Optimistic Locking)
    if (params.expectedVersion !== undefined && existingRecord.version !== params.expectedVersion) {
      return {
        success: false,
        status: existingRecord.status,
        approval: existingRecord,
        error: {
          code: 'VERSION_CONFLICT',
          message: `버전 불일치 (현재 v${existingRecord.version} vs 요청 v${params.expectedVersion}). 다른 사용자가 이미 수정했을 수 있습니다.`
        }
      };
    }

    // 일반 실행 승인은 원고·사진의 정확 승인이나 미션 계약 승인을 대체하지 않는다.
    // 서버의 기존 승인만 검증하며, 여기서 묶음이나 미션을 자동 승인하지 않는다.
    if (params.action === 'APPROVE'
      && (existingRecord.proposalType === 'PUBLISH_APPROVAL' || existingRecord.proposalType === 'CONTENT_PUBLISH')) {
      let missionId = existingRecord.proposedValue?.missionId;
      if (existingRecord.actionRunId) {
        try {
          const db = await createServerSupabaseClient();
          const run = await db.from('conversation_jobs').select('id,workspace_id,plan_data')
            .eq('workspace_id', params.workspaceId).eq('id', existingRecord.actionRunId).maybeSingle();
          if (run.error || !run.data || !run.data.plan_data
            || typeof run.data.plan_data !== 'object' || Array.isArray(run.data.plan_data)) {
            throw new Error('APPROVAL_SCOPE_UNAVAILABLE');
          }
          const runMissionId = (run.data.plan_data as Record<string, unknown>).missionId;
          if (missionId && runMissionId && missionId !== runMissionId) throw new Error('APPROVAL_SCOPE_MISMATCH');
          missionId = missionId || runMissionId;
        } catch {
          return {
            success: false,
            status: existingRecord.status,
            approval: existingRecord,
            error: { code: 'RESULT_UNKNOWN', message: '게시할 작업의 승인 범위를 확인하지 못했습니다. 외부 실행을 시작하지 않았습니다.' }
          };
        }
      }
      const reviewRequired = (): ResolveApprovalResult => ({
        success: false as const, status: existingRecord.status, approval: existingRecord,
        error: { code: 'ARTIFACT_REVIEW_REQUIRED', message: '게시할 원고와 사진을 먼저 확인하고 최종 승인해 주세요.' }
      });
      const proposed = existingRecord.proposedValue;
      if (!existingDbId || !params.actorId || typeof proposed.bundleId !== 'string'
        || typeof proposed.expectedFingerprint !== 'string' || !proposed.expectedFingerprint
        || typeof proposed.contentVersionId !== 'string'
        || !['INSTAGRAM', 'THREADS'].includes(String(proposed.channel))) return reviewRequired();
      try {
        const db = await createServerSupabaseClient();
        const bundle = await new SupabaseCreativeBundleStore(db).getBundleById(params.workspaceId, proposed.bundleId);
        if (!bundle || bundle.workspaceId !== params.workspaceId || bundle.versionId !== proposed.contentVersionId
          || bundle.channel !== String(proposed.channel).toLowerCase()
          || bundle.approvalStatus !== 'APPROVED' || bundle.bundleFingerprint !== proposed.expectedFingerprint
          || bundle.approvedFingerprint !== proposed.expectedFingerprint) return reviewRequired();
        if (missionId) {
          if (typeof missionId !== 'string' || proposed.missionId !== missionId) return reviewRequired();
          const mission = await db.from('marketing_missions').select('id,workspace_id,content_id,content_version_id')
            .eq('workspace_id', params.workspaceId).eq('id', missionId).maybeSingle();
          if (mission.error) throw mission.error;
          if (!mission.data || mission.data.workspace_id !== params.workspaceId
            || mission.data.content_id !== bundle.contentId || mission.data.content_version_id !== bundle.versionId) return reviewRequired();
          await assertPublishMissionGateAllowed({ supabase: db, workspaceId: params.workspaceId, missionId,
            workerObservedEpoch: typeof proposed.workerObservedEpoch === 'number' ? proposed.workerObservedEpoch : undefined });
        }
      } catch {
        return { success: false, status: existingRecord.status, approval: existingRecord,
          error: { code: 'RESULT_UNKNOWN', message: '최신 게시 승인 조건을 확인하지 못해 실행을 시작하지 않았어요.' } };
      }
    }

    // E. Apply Resolution Update
    const newStatus = params.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const resolvedAt = new Date().toISOString();
    const nextVersion = (existingRecord.version || 1) + 1;

    let updatedRecord: AgentApprovalRecord = {
      ...existingRecord,
      status: newStatus,
      actorId: params.actorId || null,
      rejectionReason: params.rejectionReason || null,
      version: nextVersion,
      resolvedAt,
      updatedAt: resolvedAt
    };

    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;

      if (existingDbId) {
        const { data: updated, error: updateErr } = await db
          .from('agent_approvals')
          .update({
            status: newStatus,
            actor_id: params.actorId || null,
            rejection_reason: params.rejectionReason || null,
            version: nextVersion,
            resolved_at: resolvedAt,
            updated_at: resolvedAt
          })
          .eq('id', existingDbId)
          .eq('version', existingRecord.version) // Concurrency CAS guard
          .select('*')
          .single();

        if (updateErr || !updated) {
          return {
            success: false,
            status: existingRecord.status,
            approval: existingRecord,
            error: {
              code: 'VERSION_CONFLICT',
              message: '동시성 충돌로 인해 승인 상태를 업데이트하지 못했습니다.'
            }
          };
        }
        updatedRecord = this.mapRowToRecord(updated);
      }
    } catch (updateThrow: unknown) {
      // DB 쓰기가 예외로 끊겨도 커밋은 반영됐을 수 있다(응답 유실). 대사 없이 실패로 끝내면
      // 재시도는 APPROVED 행을 읽고 ALREADY_RESOLVED 로 끝나, 승인된 외부 쓰기가 영영 실행되지 않는다.
      // 그래서 durable 상태를 다시 읽어 (a) 반영됨 → 이 요청에서 실행을 이어가고
      // (b) 아직 PENDING → 재시도 가능한 실패, (c) 확인 불가 → RESULT_UNKNOWN 으로 정직하게 끝낸다.
      console.error(
        '[AgentApproval] approval status write failed:',
        updateThrow instanceof Error ? updateThrow.message : 'unknown'
      );

      const reconciled = await this.readDurableRecord(params.workspaceId, params.proposalId);
      if (!reconciled) {
        return {
          success: false,
          status: existingRecord.status,
          approval: existingRecord,
          error: {
            code: 'RESULT_UNKNOWN',
            message: '승인 상태를 확인하지 못했습니다. 반영 여부를 알 수 없으니 승인함에서 확인한 뒤 다시 시도해 주세요.'
          }
        };
      }

      if (reconciled.status !== newStatus) {
        return {
          success: false,
          status: reconciled.status,
          approval: reconciled,
          error: {
            code: 'VERSION_CONFLICT',
            message: '승인 상태를 저장하지 못했습니다. 반영 여부를 확인한 뒤 다시 시도해 주세요.'
          }
        };
      }

      // 저장은 반영됐다. 실행 기록이 남지 않은 채 끝내지 않도록 이 요청에서 승인 실행을 이어간다.
      updatedRecord = reconciled;
    }

    approvalMemoryStore.set(memKey, updatedRecord);
    const approvalRecord = updatedRecord;

    // F-0. 같은 승인의 외부 쓰기는 프로세스당 한 번만 실행한다.
    if (params.action === 'APPROVE') {
      if (approvalExecutionClaims.has(memKey)) {
        return {
          success: false,
          status: newStatus,
          approval: approvalRecord,
          error: {
            code: 'ALREADY_EXECUTING',
            message: '같은 승인이 이미 실행 중이거나 실행되었습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
          }
        };
      }
      approvalExecutionClaims.add(memKey);
    }

    // F. Resume underlying ActionRun or execute tool
    let executionResult: Record<string, unknown> | undefined;

    const PROPOSAL_TYPE_TOOL_MAP: Record<string, string> = {
      COMMENT_REPLY_APPROVAL: 'comment.reply',
      DM_SEND_APPROVAL: 'dm.send',
      CAMPAIGN_APPROVAL: 'campaign.create',
      RESERVATION_CONFIRMATION: 'reservation.create',
      PUBLISH_APPROVAL: 'publish.create',
      CONTENT_PUBLISH: 'publish.create',
    };

    if (params.action === 'APPROVE') {
      // Resume action run if linked
      if (existingRecord.actionRunId) {
        await ConversationRepository.updateAgentRunStatus(existingRecord.actionRunId, 'executing', false);
      }

      const targetToolId = PROPOSAL_TYPE_TOOL_MAP[existingRecord.proposalType];

      if (targetToolId) {
        const proposed = existingRecord.proposedValue || {};
        try {
          const dispatchRes = await ToolDispatcher.dispatch(
            targetToolId,
            proposed,
            {
              workspaceId: params.workspaceId,
              sessionId: existingRecord.sessionId,
              actionRunId: existingRecord.actionRunId || undefined,
              correlationId: `resume-${params.proposalId}`,
              actorId: params.actorId,
              intentMode: 'EXECUTE',
            }
          );

          executionResult = {
            success: dispatchRes.success,
            status: dispatchRes.status,
            ...(dispatchRes.data || {}),
            ...(dispatchRes.error ? { error: dispatchRes.error } : {})
          };

          if (existingRecord.actionRunId) {
            await ConversationRepository.updateAgentRunStatus(
              existingRecord.actionRunId,
              dispatchRes.success ? 'completed' : 'failed',
              true
            );
          }
        } catch (dispatchError: unknown) {
          console.error('[AgentApproval] resume dispatch failed:', dispatchError instanceof Error ? dispatchError.message : 'unknown');
          executionResult = {
            success: false,
            status: 'FAILED',
            error: {
              code: 'DISPATCH_EXECUTION_FAILED',
              message: '승인한 작업을 실행하는 중 문제가 생겼어요. 실행되지 않았으니 잠시 후 다시 시도해 주세요.',
            },
          };

          if (existingRecord.actionRunId) {
            await ConversationRepository.updateAgentRunStatus(
              existingRecord.actionRunId,
              'failed',
              true
            );
          }
        }
      } else {
        // Unmapped proposalType: fail honestly without pretending completion
        executionResult = {
          success: false,
          status: 'FAILED',
          error: {
            code: 'UNSUPPORTED_PROPOSAL_TYPE',
            message: `자동 실행을 지원하지 않는 제안 유형입니다. 직접 수동 처리가 필요해요.`,
          },
        };

        if (existingRecord.actionRunId) {
          await ConversationRepository.updateAgentRunStatus(
            existingRecord.actionRunId,
            'failed',
            true
          );
        }
      }
    } else {
      // REJECT: Cancel the action run
      if (existingRecord.actionRunId) {
        await ConversationRepository.updateAgentRunStatus(existingRecord.actionRunId, 'cancelled', true);
      }
    }

    // G. Transition Session back to ACTIVE
    await AgentSessionService.setSessionStatus(params.workspaceId, existingRecord.sessionId, 'ACTIVE');

    return {
      success: true,
      status: newStatus,
      approval: approvalRecord,
      executionResult
    };
  }

  /**
   * durable 승인 행을 다시 읽는다 (ANI-1778).
   *
   * 상태 저장이 예외로 끊긴 뒤 "실제로 반영됐는지"를 판정하는 데만 쓴다.
   * 읽지 못하면 추측하지 않고 null 을 돌려준다 — 호출부는 RESULT_UNKNOWN 으로 끝낸다.
   */
  private static async readDurableRecord(
    workspaceId: string,
    proposalId: string
  ): Promise<AgentApprovalRecord | null> {
    try {
      const supabase = await createServerSupabaseClient();
      const db = supabase as any;

      const { data, error } = await db
        .from('agent_approvals')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('proposal_id', proposalId)
        .single();

      if (error || !data) return null;
      return this.mapRowToRecord(data);
    } catch {
      return null;
    }
  }

  private static mapRowToRecord(row: any): AgentApprovalRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      proposalId: row.proposal_id,
      sessionId: row.session_id,
      actionRunId: row.action_run_id,
      proposalType: row.proposal_type,
      title: row.title,
      description: row.description,
      targetField: row.target_field,
      currentValue: row.current_value,
      proposedValue: row.proposed_value || {},
      status: row.status,
      actorId: row.actor_id,
      rejectionReason: row.rejection_reason,
      version: row.version,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at
    };
  }
}
