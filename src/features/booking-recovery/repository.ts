import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RecoveryStage,
  RecoveryActor,
  recoveryCaseIdSchema,
  recoveryStageSchema,
  sha256HexSchema,
  recoveryProposalSchema,
  RecoveryProposal,
} from './contracts';

/**
 * 1. Zod Schemas for Repository Ledger Entities
 */
export const recoveryCaseSchema = z
  .object({
    id: recoveryCaseIdSchema,
    workspace_id: z.string().uuid(),
    mission_id: z.string().uuid(),
    source_thread_id: z.string().uuid(),
    source_inbound_message_id: z.string().uuid(),
    customer_ref: z.string().min(1),
    stage: recoveryStageSchema,
    version: z.number().int().positive(),
    accepted_inbound_message_id: z.string().uuid().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type RecoveryCase = z.infer<typeof recoveryCaseSchema>;

export const recoveryApprovalSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    case_id: recoveryCaseIdSchema,
    step_kind: z.enum(['SEND', 'BOOK']),
    payload_fingerprint: sha256HexSchema,
    case_version: z.number().int().positive(),
    // Version the owner reviewed (before the approval CAS). NULL authorized version = legacy two-step approval row.
    authorized_case_version: z.number().int().positive().nullable().optional(),
    source_message_id: z.string().uuid(),
    catalog_version: z.string().min(1),
    slot_version: z.number().int().positive(),
    approved_by: z.string().uuid(),
    approved_at: z.string(),
    expires_at: z.string(),
    consumed_at: z.string().nullable().optional(),
    consumed_by_step_id: z.string().uuid().nullable().optional(),
  })
  .strict();

export type RecoveryApproval = z.infer<typeof recoveryApprovalSchema>;

/**
 * Result of the atomic approve + transition RPC. The two versions are issued by the server and persisted on the
 * approval row; callers must pass `authorizedCaseVersion` onward and never derive it with `+ 1`.
 */
const approveAndTransitionRpcSchema = z
  .object({
    approval_id: z.string().uuid(),
    case_id: recoveryCaseIdSchema,
    reviewed_case_version: z.number().int().positive(),
    authorized_case_version: z.number().int().positive(),
    stage: recoveryStageSchema,
    replayed: z.boolean(),
    expires_at: z.string(),
    case: recoveryCaseSchema,
  })
  .strict()
  .refine((value) => value.authorized_case_version > value.reviewed_case_version, {
    message: 'authorized_case_version must be greater than reviewed_case_version',
  });

export interface ApproveAndTransitionResult {
  approvalId: string;
  caseId: string;
  reviewedCaseVersion: number;
  authorizedCaseVersion: number;
  stage: RecoveryStage;
  replayed: boolean;
  expiresAt: string;
  case: RecoveryCase;
}

export const recoveryOutboxItemSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    case_id: recoveryCaseIdSchema,
    source_event_key: z.string().min(1),
    kind: z.string().min(1),
    state: z.enum(['PENDING', 'CLAIMED', 'FINISHED', 'UNKNOWN']),
    lease_until: z.string().nullable().optional(),
    attempt: z.number().int().nonnegative(),
    next_attempt_at: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export type RecoveryOutboxItem = z.infer<typeof recoveryOutboxItemSchema>;

export const claimOutboxResultSchema = z.discriminatedUnion('claimed', [
  z.object({
    claimed: z.literal(true),
    status: z.literal('CLAIMED'),
    outbox: recoveryOutboxItemSchema,
  }),
  z.object({
    claimed: z.literal(false),
    status: z.literal('MOVED_TO_UNKNOWN_RECONCILE_ONLY'),
    outbox: recoveryOutboxItemSchema,
  }),
]);

export type ClaimOutboxResult = z.infer<typeof claimOutboxResultSchema>;

export const recoveryStepSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    case_id: recoveryCaseIdSchema,
    kind: z.string().min(1),
    status: z.enum(['CLAIMED', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'UNKNOWN']),
    idempotency_key: z.string().min(1),
    input_fingerprint: sha256HexSchema,
    claim_token: z.string().uuid(),
    attempt: z.number().int().positive(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    lease_until: z.string().nullable().optional(),
  })
  .passthrough();

export type RecoveryStep = z.infer<typeof recoveryStepSchema>;

export const claimStepResultSchema = z.discriminatedUnion('claimed', [
  z.object({
    claimed: z.literal(true),
    reclaimed: z.boolean(),
    claim_token: z.string().uuid(),
    attempt: z.number().int().positive(),
    step: recoveryStepSchema,
  }),
  z.object({
    claimed: z.literal(false),
    reason: z.string(),
    step: z.record(z.string(), z.unknown()).optional(),
    lease_until: z.string().nullable().optional(),
    status: z.string().optional(),
  }),
]);

export type ClaimStepResult = z.infer<typeof claimStepResultSchema>;

export const confirmBookingResultSchema = z
  .object({
    case: recoveryCaseSchema,
    reservation_id: z.string(),
    slot_id: z.string().uuid(),
    confirmed_at: z.string(),
  })
  .strict();

export type ConfirmBookingResult = z.infer<typeof confirmBookingResultSchema>;

function normalizeCase(c: RecoveryCase): RecoveryCase {
  return {
    ...c,
    created_at: new Date(c.created_at).toISOString(),
    updated_at: new Date(c.updated_at).toISOString(),
  };
}

export class BookingRecoveryRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'REPOSITORY_ERROR',
    public readonly status: number = 500
  ) {
    super(message);
    this.name = 'BookingRecoveryRepositoryError';
  }
}

/**
 * BookingRecoveryRepository:
 * Supabase PostgreSQL authoritative persistence.
 * Zero in-memory fallback. All writes go through atomic server RPCs and durable ledger tables.
 */
export class BookingRecoveryRepository {
  constructor(private readonly client: SupabaseClient<any>) {}

  /**
   * Atomically opens or returns an existing booking recovery case using server RPC.
   */
  public async openCase(
    actor: RecoveryActor,
    sourceInboundMessageId: string
  ): Promise<RecoveryCase> {
    const { data, error } = await this.client.rpc('open_booking_recovery', {
      p_workspace_id: actor.workspaceId,
      p_source_inbound_message_id: sourceInboundMessageId,
      p_actor_id: actor.userId,
    });

    if (error) {
      if (error.code === '42501' || error.message?.includes('FORBIDDEN')) {
        throw new BookingRecoveryRepositoryError('접근 권한이 없습니다.', 'FORBIDDEN', 403);
      }
      if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
        throw new BookingRecoveryRepositoryError('원본 문의 메시지를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      }
      throw new BookingRecoveryRepositoryError(
        `회수 케이스 생성 실패: ${error.message}`,
        error.code || 'OPEN_CASE_FAILED',
        500
      );
    }

    const parsed = recoveryCaseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `케이스 데이터 정합성 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return normalizeCase(parsed.data);
  }

  /**
   * Atomically transitions a case to the next stage with optimistic version CAS.
   */
  public async transitionCase(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      nextStage: RecoveryStage;
      stepKind: string;
      fingerprint: string;
      idempotencyKey: string;
      providerMessageId?: string;
      evidenceRef?: string;
    }
  ): Promise<RecoveryCase> {
    const { data, error } = await this.client.rpc('transition_booking_recovery', {
      p_workspace_id: actor.workspaceId,
      p_case_id: params.caseId,
      p_expected_version: params.expectedVersion,
      p_next_stage: params.nextStage,
      p_actor_id: actor.userId,
      p_step_kind: params.stepKind,
      p_fingerprint: params.fingerprint,
      p_idempotency_key: params.idempotencyKey,
      p_provider_msg_id: params.providerMessageId ?? null,
      p_evidence_ref: params.evidenceRef ?? null,
    });

    if (error) {
      if (error.code === '40001' || error.message?.includes('VERSION_CONFLICT')) {
        throw new BookingRecoveryRepositoryError(
          '케이스 버전이 일치하지 않습니다. 최신 상태를 다시 불러와주세요.',
          'VERSION_CONFLICT',
          409
        );
      }
      if (error.code === '42501' || error.message?.includes('FORBIDDEN')) {
        throw new BookingRecoveryRepositoryError('접근 권한이 없습니다.', 'FORBIDDEN', 403);
      }
      if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
        throw new BookingRecoveryRepositoryError('케이스를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      }
      throw new BookingRecoveryRepositoryError(
        `상태 전이 실패: ${error.message}`,
        error.code || 'TRANSITION_FAILED',
        500
      );
    }

    const parsed = recoveryCaseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `전이 후 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return normalizeCase(parsed.data);
  }

  /**
   * Atomically approves the latest proposal for sending: case transition to AWAITING_SEND_APPROVAL, the SEND
   * approval row and the audit step commit in one DB transaction (W4 contract 3).
   * Approval metadata (source message, catalog/slot version, expiry) is derived by the DB from the latest
   * proposal; the caller only supplies what the owner reviewed (version + fingerprint) and an idempotency key.
   */
  public async approveAndTransition(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      fingerprint: string;
      idempotencyKey: string;
    }
  ): Promise<ApproveAndTransitionResult> {
    const { data, error } = await this.client.rpc('approve_and_transition_recovery', {
      p_workspace_id: actor.workspaceId,
      p_case_id: params.caseId,
      p_expected_version: params.expectedVersion,
      p_actor_id: actor.userId,
      p_fingerprint: params.fingerprint,
      p_idempotency_key: params.idempotencyKey,
    });

    if (error) {
      if (error.code === '40001' || error.message?.includes('VERSION_CONFLICT')) {
        throw new BookingRecoveryRepositoryError(
          '승인 대상이 변경되었거나 이미 처리되었습니다. 최신 상태를 다시 불러와주세요.',
          'VERSION_CONFLICT',
          409
        );
      }
      if (error.code === '42501' || error.message?.includes('FORBIDDEN')) {
        throw new BookingRecoveryRepositoryError('접근 권한이 없습니다.', 'FORBIDDEN', 403);
      }
      if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
        throw new BookingRecoveryRepositoryError('케이스를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      }
      if (error.code === '22000') {
        throw new BookingRecoveryRepositoryError(
          '현재 단계에서는 발송 승인을 할 수 없습니다. 상태를 확인해 주세요.',
          'CONTEXT_REQUIRED',
          422
        );
      }
      throw new BookingRecoveryRepositoryError(
        `발송 승인 실패: ${error.message}`,
        error.code || 'APPROVE_AND_TRANSITION_FAILED',
        500
      );
    }

    const parsed = approveAndTransitionRpcSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `발송 승인 결과 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    const value = parsed.data;
    return {
      approvalId: value.approval_id,
      caseId: value.case_id,
      reviewedCaseVersion: value.reviewed_case_version,
      authorizedCaseVersion: value.authorized_case_version,
      stage: value.stage,
      replayed: value.replayed,
      expiresAt: value.expires_at,
      case: normalizeCase(value.case),
    };
  }

  /**
   * Claims an outbox work item atomically with SKIP LOCKED.
   * Returns null if no eligible jobs exist.
   * Expired jobs are demoted to UNKNOWN and returned with claimed: false.
   */
  public async claimOutbox(
    workspaceId: string,
    leaseSeconds: number = 60
  ): Promise<ClaimOutboxResult | null> {
    const { data, error } = await this.client.rpc('claim_booking_recovery_outbox', {
      p_workspace_id: workspaceId,
      p_lease_seconds: leaseSeconds,
    });

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `Outbox 클레임 실패: ${error.message}`,
        error.code || 'OUTBOX_CLAIM_FAILED',
        500
      );
    }

    if (!data) return null;

    const parsed = claimOutboxResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `Outbox 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Atomically claims an execution step lease using server RPC.
   */
  public async claimStep(
    actor: RecoveryActor,
    params: {
      caseId: string;
      kind: string;
      idempotencyKey: string;
      inputFingerprint: string;
      leaseSeconds?: number;
    }
  ): Promise<ClaimStepResult> {
    const { data, error } = await this.client.rpc('claim_booking_recovery_step', {
      p_workspace_id: actor.workspaceId,
      p_case_id: params.caseId,
      p_kind: params.kind,
      p_idempotency_key: params.idempotencyKey,
      p_actor_id: actor.userId,
      p_input_fingerprint: params.inputFingerprint,
      p_lease_seconds: params.leaseSeconds ?? 60,
    });

    if (error) {
      if (error.code === '42501' || error.message?.includes('FORBIDDEN')) {
        throw new BookingRecoveryRepositoryError('접근 권한이 없습니다.', 'FORBIDDEN', 403);
      }
      if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
        throw new BookingRecoveryRepositoryError('케이스를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      }
      throw new BookingRecoveryRepositoryError(
        `Step 클레임 실패: ${error.message}`,
        error.code || 'CLAIM_STEP_FAILED',
        500
      );
    }

    const parsed = claimStepResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `Step 클레임 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Queries a recovery case scoped to workspace.
   */
  public async getCase(workspaceId: string, caseId: string): Promise<RecoveryCase | null> {
    const { data, error } = await this.client
      .from('booking_recovery_cases')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', caseId)
      .maybeSingle();

    if (error) {
      throw new BookingRecoveryRepositoryError(`케이스 조회 실패: ${error.message}`, error.code, 500);
    }

    if (!data) return null;

    const parsed = recoveryCaseSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `조회된 케이스 스키마 불일치: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return normalizeCase(parsed.data);
  }

  /**
   * Lists recovery cases for a workspace.
   */
  public async listCases(workspaceId: string, limit: number = 20): Promise<RecoveryCase[]> {
    const { data, error } = await this.client
      .from('booking_recovery_cases')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error || !Array.isArray(data)) {
      throw new BookingRecoveryRepositoryError(
        error ? `케이스 목록 조회 실패: ${error.message}` : '케이스 목록 조회 실패: 응답에 행 목록이 없습니다',
        error?.code,
        500,
      );
    }

    const items: RecoveryCase[] = [];
    for (const item of data) {
      const parsed = recoveryCaseSchema.safeParse(item);
      if (parsed.success) {
        items.push(normalizeCase(parsed.data));
      }
    }

    return items;
  }

  /**
   * Durably binds an owner approval to the recovery approvals ledger.
   * Never falls back to in-memory caching.
   */
  public async saveApproval(
    actor: RecoveryActor,
    params: {
      caseId: string;
      stepKind: 'SEND' | 'BOOK';
      payloadFingerprint: string;
      caseVersion: number;
      sourceMessageId: string;
      catalogVersion: string;
      slotVersion: number;
      expiresAt: string;
    }
  ): Promise<RecoveryApproval> {
    const existing = await this.getApproval(
      actor.workspaceId,
      params.caseId,
      params.stepKind,
      params.payloadFingerprint
    ).catch(() => null);

    if (existing) {
      return existing;
    }

    const row = {
      workspace_id: actor.workspaceId,
      case_id: params.caseId,
      step_kind: params.stepKind,
      payload_fingerprint: params.payloadFingerprint,
      case_version: params.caseVersion,
      source_message_id: params.sourceMessageId,
      catalog_version: params.catalogVersion,
      slot_version: params.slotVersion,
      approved_by: actor.userId,
      expires_at: params.expiresAt,
    };

    const { data, error } = await this.client
      .from('booking_recovery_approvals')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `승인 기록 영속화 실패: ${error.message}`,
        error.code || 'SAVE_APPROVAL_FAILED',
        500
      );
    }

    const parsed = recoveryApprovalSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `승인 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Loads an active durable approval record.
   */
  public async getApproval(
    workspaceId: string,
    caseId: string,
    stepKind: 'SEND' | 'BOOK',
    payloadFingerprint: string
  ): Promise<RecoveryApproval | null> {
    const { data, error } = await this.client
      .from('booking_recovery_approvals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('case_id', caseId)
      .eq('step_kind', stepKind)
      .eq('payload_fingerprint', payloadFingerprint)
      .maybeSingle();

    if (error) {
      throw new BookingRecoveryRepositoryError(`승인 조회 실패: ${error.message}`, error.code, 500);
    }

    if (!data) return null;

    const parsed = recoveryApprovalSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `승인 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Durably saves a proposal snapshot for a case revision.
   */
  public async saveProposal(
    actor: RecoveryActor,
    params: {
      id?: string;
      caseId: string;
      revision: number;
      sourceInboundMessageId: string;
      sourceThreadId: string;
      serviceId: string;
      catalogVersion: string;
      serviceName: string;
      totalAmountKrw: number;
      depositKrw: number;
      slotId: string;
      slotVersion: number;
      startsAt: string;
      endsAt: string;
      timezone?: string;
      availabilityConfirmedAt: string;
      validUntil: string;
      dmDraftId?: string | null;
      replyText: string;
      payloadFingerprint: string;
      approvedReplySnapshot?: Record<string, unknown> | null;
    }
  ): Promise<RecoveryProposal> {
    const row = {
      ...(params.id ? { id: params.id } : {}),
      workspace_id: actor.workspaceId,
      case_id: params.caseId,
      revision: params.revision,
      source_inbound_message_id: params.sourceInboundMessageId,
      source_thread_id: params.sourceThreadId,
      service_id: params.serviceId,
      catalog_version: params.catalogVersion,
      service_name: params.serviceName,
      total_amount_krw: params.totalAmountKrw,
      deposit_krw: params.depositKrw,
      slot_id: params.slotId,
      slot_version: params.slotVersion,
      starts_at: params.startsAt,
      ends_at: params.endsAt,
      timezone: params.timezone ?? 'Asia/Seoul',
      availability_confirmed_at: params.availabilityConfirmedAt,
      valid_until: params.validUntil,
      dm_draft_id: params.dmDraftId ?? null,
      reply_text: params.replyText,
      payload_fingerprint: params.payloadFingerprint,
      approved_reply_snapshot: params.approvedReplySnapshot ?? null,
    };

    const { data, error } = await this.client
      .from('booking_recovery_proposals')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `제안 스냅샷 저장 실패: ${error.message}`,
        error.code || 'SAVE_PROPOSAL_FAILED',
        500
      );
    }

    const parsed = recoveryProposalSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `제안 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Loads the latest proposal snapshot for a case.
   */
  public async getLatestProposal(
    workspaceId: string,
    caseId: string
  ): Promise<RecoveryProposal | null> {
    const { data, error } = await this.client
      .from('booking_recovery_proposals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('case_id', caseId)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `최신 제안 조회 실패: ${error.message}`,
        error.code,
        500
      );
    }

    if (!data) return null;

    const parsed = recoveryProposalSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `제안 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Loads a proposal snapshot by specific revision.
   */
  public async getProposalByRevision(
    workspaceId: string,
    caseId: string,
    revision: number
  ): Promise<RecoveryProposal | null> {
    const { data, error } = await this.client
      .from('booking_recovery_proposals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('case_id', caseId)
      .eq('revision', revision)
      .maybeSingle();

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `제안 버전 조회 실패: ${error.message}`,
        error.code,
        500
      );
    }

    if (!data) return null;

    const parsed = recoveryProposalSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `제안 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return parsed.data;
  }

  /**
   * Finishes an execution step atomically with CAS checks.
   */
  public async finishStep(
    actor: RecoveryActor,
    params: {
      caseId: string;
      stepId: string;
      claimToken: string;
      attempt: number;
      inputFingerprint: string;
      status: 'COMPLETED' | 'FAILED';
      providerMessageId?: string;
      evidenceRef?: string;
    }
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.rpc('finish_booking_recovery_step', {
      p_workspace_id: actor.workspaceId,
      p_case_id: params.caseId,
      p_step_id: params.stepId,
      p_claim_token: params.claimToken,
      p_attempt: params.attempt,
      p_input_fingerprint: params.inputFingerprint,
      p_status: params.status,
      p_provider_msg_id: params.providerMessageId ?? null,
      p_evidence_ref: params.evidenceRef ?? null,
    });

    if (error) {
      if (error.code === '40001' || error.message?.includes('CAS_FAILED')) {
        throw new BookingRecoveryRepositoryError(
          '단계 완료 CAS 실패: 만료되었거나 다른 작업자가 갱신했습니다.',
          'CAS_FAILED',
          409
        );
      }
      throw new BookingRecoveryRepositoryError(
        `Step 완료 실패: ${error.message}`,
        error.code || 'FINISH_STEP_FAILED',
        500
      );
    }

    return (data as Record<string, unknown>) || {};
  }

  /**
   * Atomically commits a confirmed booking reservation using server RPC.
   */
  public async confirmBooking(
    actor: RecoveryActor,
    params: {
      caseId: string;
      expectedVersion: number;
      proposalRevision: number;
      inboundAcceptanceMessageId: string;
      fingerprint: string;
    }
  ): Promise<ConfirmBookingResult> {
    const { data, error } = await this.client.rpc('confirm_booking_recovery', {
      p_workspace_id: actor.workspaceId,
      p_case_id: params.caseId,
      p_expected_version: params.expectedVersion,
      p_proposal_revision: params.proposalRevision,
      p_actor_id: actor.userId,
      p_inbound_acceptance_message_id: params.inboundAcceptanceMessageId,
      p_fingerprint: params.fingerprint,
    });

    if (error) {
      if (['40001', '23505', '23P01', '40P01'].includes(error.code) || error.message?.includes('VERSION_CONFLICT')) {
        throw new BookingRecoveryRepositoryError(
          '케이스 버전이 일치하지 않습니다. 최신 상태를 다시 불러와주세요.',
          'VERSION_CONFLICT',
          409
        );
      }
      if (error.code === '42501' || error.message?.includes('FORBIDDEN')) {
        throw new BookingRecoveryRepositoryError('접근 권한이 없습니다.', 'FORBIDDEN', 403);
      }
      if (error.code === 'P0002' || error.message?.includes('NOT_FOUND')) {
        throw new BookingRecoveryRepositoryError('필요한 리소스를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      }
      throw new BookingRecoveryRepositoryError(
        `예약 확정 실패: ${error.message}`,
        error.code || 'CONFIRM_BOOKING_FAILED',
        500
      );
    }

    const parsed = confirmBookingResultSchema.safeParse(data);
    if (!parsed.success) {
      throw new BookingRecoveryRepositoryError(
        `예약 확정 결과 데이터 검증 실패: ${parsed.error.message}`,
        'SCHEMA_VALIDATION_FAILED',
        500
      );
    }

    return {
      ...parsed.data,
      case: normalizeCase(parsed.data.case),
      confirmed_at: new Date(parsed.data.confirmed_at).toISOString(),
    };
  }

  /**
   * Loads an inbound DM message scoped to workspace.
   */
  public async getInboundMessage(
    workspaceId: string,
    messageId: string
  ): Promise<{
    id: string;
    workspace_id: string;
    thread_id: string;
    sender_type: string;
    sender_id: string;
    text: string;
    sent_at: string;
  } | null> {
    const { data, error } = await this.client
      .from('instagram_dm_messages')
      .select('id, workspace_id, thread_id, sender_type, sender_id, text, sent_at')
      .eq('workspace_id', workspaceId)
      .eq('id', messageId)
      .maybeSingle();

    if (error) {
      throw new BookingRecoveryRepositoryError(
        `메시지 조회 실패: ${error.message}`,
        error.code,
        500
      );
    }

    return data;
  }
}
