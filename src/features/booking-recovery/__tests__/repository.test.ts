import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BookingRecoveryRepository,
  BookingRecoveryRepositoryError,
} from '../repository';
import type { RecoveryActor } from '../contracts';

describe('BookingRecoveryRepository Unit Tests (Task 3)', () => {
  const actor: RecoveryActor = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'owner',
  };

  const sampleCase = {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: '11111111-1111-4111-8111-111111111111',
    mission_id: '44444444-4444-4444-8444-444444444444',
    source_thread_id: '55555555-5555-4555-8555-555555555555',
    source_inbound_message_id: '66666666-6666-4666-8666-666666666666',
    customer_ref: 'cust_insta_1',
    stage: 'DISCOVERED',
    version: 1,
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['23505', '23P01', '40001', '40P01'])('confirmBooking은 DB 경쟁 %s를 409로 반환한다', async (code) => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message: 'transaction conflict' } }) } as any;
    const repo = new BookingRecoveryRepository(client);
    await expect(repo.confirmBooking(actor, {
      caseId: sampleCase.id, expectedVersion: 4, proposalRevision: 1,
      inboundAcceptanceMessageId: sampleCase.source_inbound_message_id, fingerprint: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  describe('openCase', () => {
    it('RPC 호출 성공 시 Zod 파싱을 거쳐 RecoveryCase를 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: sampleCase, error: null });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      const result = await repo.openCase(actor, '66666666-6666-4666-8666-666666666666');

      expect(mockRpc).toHaveBeenCalledWith('open_booking_recovery', {
        p_workspace_id: actor.workspaceId,
        p_source_inbound_message_id: '66666666-6666-4666-8666-666666666666',
        p_actor_id: actor.userId,
      });
      expect(result.id).toBe(sampleCase.id);
      expect(result.version).toBe(1);
    });

    it('권한 없는 사용자가 호출하면 FORBIDDEN 에러를 throw한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'FORBIDDEN' },
      });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      await expect(
        repo.openCase(actor, '66666666-6666-4666-8666-666666666666')
      ).rejects.toThrowError(BookingRecoveryRepositoryError);
    });

    it('RPC 반환 스키마가 불일치하면 SCHEMA_VALIDATION_FAILED 에러를 던진다 (fail-closed)', async () => {
      const malformedData = { ...sampleCase, stage: 'INVALID_STAGE' };
      const mockRpc = vi.fn().mockResolvedValue({ data: malformedData, error: null });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      await expect(
        repo.openCase(actor, '66666666-6666-4666-8666-666666666666')
      ).rejects.toMatchObject({
        code: 'SCHEMA_VALIDATION_FAILED',
      });
    });
  });

  describe('transitionCase', () => {
    it('버전 충돌 시 VERSION_CONFLICT 409 에러를 throw한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '40001', message: 'VERSION_CONFLICT' },
      });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      await expect(
        repo.transitionCase(actor, {
          caseId: sampleCase.id,
          expectedVersion: 1,
          nextStage: 'DRAFT_READY',
          stepKind: 'PREPARE',
          fingerprint: 'a'.repeat(64),
          idempotencyKey: 'idem-1',
        })
      ).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
        status: 409,
      });
    });

    it('성공 시 갱신된 버전과 상태를 반환한다', async () => {
      const transitionedCase = {
        ...sampleCase,
        stage: 'DRAFT_READY',
        version: 2,
        updated_at: '2026-10-16T10:05:00Z',
      };
      const mockRpc = vi.fn().mockResolvedValue({ data: transitionedCase, error: null });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      const result = await repo.transitionCase(actor, {
        caseId: sampleCase.id,
        expectedVersion: 1,
        nextStage: 'DRAFT_READY',
        stepKind: 'PREPARE',
        fingerprint: 'a'.repeat(64),
        idempotencyKey: 'idem-1',
      });

      expect(result.version).toBe(2);
      expect(result.stage).toBe('DRAFT_READY');
    });
  });

  describe('claimStep', () => {
    it('claim_booking_recovery_step RPC를 호출하여 envelope 결과를 파싱해 반환한다', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          claimed: true,
          reclaimed: false,
          claim_token: '88888888-8888-4888-8888-888888888888',
          attempt: 1,
          step: {
            id: '99999999-9999-4999-8999-999999999999',
            workspace_id: actor.workspaceId,
            case_id: sampleCase.id,
            kind: 'SEND_DM',
            status: 'CLAIMED',
            idempotency_key: 'idem-key-1',
            input_fingerprint: 'c'.repeat(64),
            claim_token: '88888888-8888-4888-8888-888888888888',
            attempt: 1,
          },
        },
        error: null,
      });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      const result = await repo.claimStep(actor, {
        caseId: sampleCase.id,
        kind: 'SEND_DM',
        idempotencyKey: 'idem-key-1',
        inputFingerprint: 'c'.repeat(64),
        leaseSeconds: 60,
      });

      expect(mockRpc).toHaveBeenCalledWith('claim_booking_recovery_step', {
        p_workspace_id: actor.workspaceId,
        p_case_id: sampleCase.id,
        p_kind: 'SEND_DM',
        p_idempotency_key: 'idem-key-1',
        p_actor_id: actor.userId,
        p_input_fingerprint: 'c'.repeat(64),
        p_lease_seconds: 60,
      });
      expect(result.claimed).toBe(true);
      if (result.claimed) {
        expect(result.claim_token).toBe('88888888-8888-4888-8888-888888888888');
        expect(result.step.id).toBe('99999999-9999-4999-8999-999999999999');
      }
    });

    it('claimed: true 시 step 필드가 누락/오염되면 SCHEMA_VALIDATION_FAILED 에러를 던진다 (Fail-Closed)', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          claimed: true,
          reclaimed: false,
          claim_token: '88888888-8888-4888-8888-888888888888',
          attempt: 1,
          step: {}, // empty/malformed step
        },
        error: null,
      });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      await expect(
        repo.claimStep(actor, {
          caseId: sampleCase.id,
          kind: 'SEND_DM',
          idempotencyKey: 'idem-key-1',
          inputFingerprint: 'c'.repeat(64),
        })
      ).rejects.toMatchObject({
        code: 'SCHEMA_VALIDATION_FAILED',
      });
    });
  });

  describe('claimOutbox', () => {
    it('claim_booking_recovery_outbox RPC envelope 결과를 파싱해 반환한다', async () => {
      const mockOutboxItem = {
        id: '99999999-9999-4999-8999-999999999999',
        workspace_id: actor.workspaceId,
        case_id: sampleCase.id,
        source_event_key: 'evt_1',
        kind: 'SEND_DM',
        state: 'CLAIMED' as const,
        attempt: 1,
        next_attempt_at: '2026-10-16T10:00:00Z',
        created_at: '2026-10-16T10:00:00Z',
        updated_at: '2026-10-16T10:00:00Z',
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          claimed: true,
          status: 'CLAIMED',
          outbox: mockOutboxItem,
        },
        error: null,
      });
      const client = { rpc: mockRpc } as any;
      const repo = new BookingRecoveryRepository(client);

      const result = await repo.claimOutbox(actor.workspaceId, 60);

      expect(result).not.toBeNull();
      expect(result?.claimed).toBe(true);
      if (result?.claimed) {
        expect(result.outbox.id).toBe(mockOutboxItem.id);
      }
    });
  });

  describe('approveAndTransition (W5 contract 3)', () => {
    const approvalId = '77777777-7777-4777-8777-777777777777';
    const okResult = {
      approval_id: approvalId,
      case_id: sampleCase.id,
      reviewed_case_version: 2,
      authorized_case_version: 3,
      stage: 'AWAITING_SEND_APPROVAL',
      replayed: false,
      expires_at: '2026-10-16T10:15:00Z',
      case: { ...sampleCase, stage: 'AWAITING_SEND_APPROVAL', version: 3 },
    };
    const params = { caseId: sampleCase.id, expectedVersion: 2, fingerprint: 'a'.repeat(64), idempotencyKey: `approve_send:${sampleCase.id}:2` };

    it('원자 RPC를 호출하고 검토 전/승인 후 버전을 분리해 돌려준다 (+1 추론 없음)', async () => {
      const mockRpc = vi.fn().mockResolvedValue({ data: okResult, error: null });
      const repo = new BookingRecoveryRepository({ rpc: mockRpc } as any);
      const result = await repo.approveAndTransition(actor, params);
      expect(mockRpc).toHaveBeenCalledWith('approve_and_transition_recovery', {
        p_workspace_id: actor.workspaceId,
        p_case_id: sampleCase.id,
        p_expected_version: 2,
        p_actor_id: actor.userId,
        p_fingerprint: 'a'.repeat(64),
        p_idempotency_key: params.idempotencyKey,
      });
      expect(result.approvalId).toBe(approvalId);
      expect(result.reviewedCaseVersion).toBe(2);
      expect(result.authorizedCaseVersion).toBe(3);
      expect(result.replayed).toBe(false);
      expect(result.case.version).toBe(3);
    });

    it.each([
      ['40001', 'VERSION_CONFLICT: Expected case version', 'VERSION_CONFLICT', 409],
      ['40001', 'FINGERPRINT_MISMATCH: differs', 'VERSION_CONFLICT', 409],
      ['40001', 'PROPOSAL_EXPIRED: window', 'VERSION_CONFLICT', 409],
      ['40001', 'APPROVAL_ALREADY_EXISTS: prepare', 'VERSION_CONFLICT', 409],
      ['42501', 'FORBIDDEN: Caller', 'FORBIDDEN', 403],
      ['P0002', 'NOT_FOUND: Case', 'NOT_FOUND', 404],
    ])('DB 오류 %s/%s는 안전한 저장소 오류로 변환한다', async (code, message, expectedCode, status) => {
      const repo = new BookingRecoveryRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message } }) } as any);
      await expect(repo.approveAndTransition(actor, params)).rejects.toMatchObject({ code: expectedCode, status });
    });

    it('단계·멱등 바인딩 위반(22000)은 성공으로 취급하지 않고 CONTEXT_REQUIRED로 구분한다', async () => {
      const repo = new BookingRecoveryRepository({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '22000', message: 'INVALID_STAGE_TRANSITION: from DISCOVERED' } }) } as any);
      await expect(repo.approveAndTransition(actor, params)).rejects.toMatchObject({ code: 'CONTEXT_REQUIRED', status: 422 });
    });

    it('반환 스키마가 어긋나거나 승인 후 버전이 검토 버전보다 크지 않으면 fail-closed', async () => {
      for (const data of [{ ...okResult, authorized_case_version: 2 }, { ...okResult, approval_id: 'nope' }, { ...okResult, extra: true }, null]) {
        const repo = new BookingRecoveryRepository({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as any);
        await expect(repo.approveAndTransition(actor, params)).rejects.toMatchObject({ code: 'SCHEMA_VALIDATION_FAILED' });
      }
    });
  });

  describe('승인 행 스키마', () => {
    it('authorized_case_version / consumed_by_step_id 신규 컬럼이 있는 행도 strict 파싱을 통과한다', async () => {
      const row = {
        id: '77777777-7777-4777-8777-777777777777',
        workspace_id: actor.workspaceId,
        case_id: sampleCase.id,
        step_kind: 'SEND',
        payload_fingerprint: 'b'.repeat(64),
        case_version: 2,
        authorized_case_version: 3,
        consumed_by_step_id: '88888888-8888-4888-8888-888888888888',
        source_message_id: '66666666-6666-4666-8666-666666666666',
        catalog_version: 'cat-v1',
        slot_version: 1,
        approved_by: actor.userId,
        approved_at: '2026-10-16T10:00:00Z',
        expires_at: '2026-10-16T10:15:00Z',
        consumed_at: '2026-10-16T10:05:00Z',
      };
      const client = { from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) }),
      }) } as any;
      const loaded = await new BookingRecoveryRepository(client).getApproval(actor.workspaceId, sampleCase.id, 'SEND', 'b'.repeat(64));
      expect(loaded?.authorized_case_version).toBe(3);
      expect(loaded?.consumed_by_step_id).toBe('88888888-8888-4888-8888-888888888888');
    });
  });

  describe('saveApproval & getApproval (Zero in-memory fallback)', () => {
    it('승인 기록을 durable 테이블에 저장하고 조회한다', async () => {
      const sampleApproval = {
        id: '77777777-7777-4777-8777-777777777777',
        workspace_id: actor.workspaceId,
        case_id: sampleCase.id,
        step_kind: 'SEND',
        payload_fingerprint: 'b'.repeat(64),
        case_version: 1,
        source_message_id: '66666666-6666-4666-8666-666666666666',
        catalog_version: 'cat-v1',
        slot_version: 1,
        approved_by: actor.userId,
        approved_at: '2026-10-16T10:00:00Z',
        expires_at: '2026-10-16T10:15:00Z',
      };

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: sampleApproval, error: null }),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: sampleApproval, error: null }),
      });

      const client = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'booking_recovery_approvals') {
            return {
              insert: mockInsert,
              select: mockSelect,
            };
          }
          return {};
        }),
      } as any;

      const repo = new BookingRecoveryRepository(client);

      const saved = await repo.saveApproval(actor, {
        caseId: sampleCase.id,
        stepKind: 'SEND',
        payloadFingerprint: 'b'.repeat(64),
        caseVersion: 1,
        sourceMessageId: '66666666-6666-4666-8666-666666666666',
        catalogVersion: 'cat-v1',
        slotVersion: 1,
        expiresAt: '2026-10-16T10:15:00Z',
      });

      expect(saved.payload_fingerprint).toBe('b'.repeat(64));

      const loaded = await repo.getApproval(
        actor.workspaceId,
        sampleCase.id,
        'SEND',
        'b'.repeat(64)
      );

      expect(loaded?.id).toBe(sampleApproval.id);
    });
  });
});
