import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BookingRecoveryService } from '../service';
import { BookingRecoveryRepository } from '../repository';
import { RecoveryActor, RecoveryStage, recoveryCommandSchema } from '../contracts';
import { bookingApprovalFingerprint } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';
import * as inboundProjector from '../inbound-projector';

describe('BookingRecoveryService', () => {
  let repository: BookingRecoveryRepository;
  let service: BookingRecoveryService;
  let mockSupabase: any;

  const actor: RecoveryActor = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'owner',
  };

  const caseFixture = {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: actor.workspaceId,
    mission_id: '44444444-4444-4444-8444-444444444444',
    source_thread_id: '55555555-5555-4555-8555-555555555555',
    source_inbound_message_id: '66666666-6666-4666-8666-666666666666',
    customer_ref: 'cust_abc',
    stage: 'DISCOVERED' as const,
    version: 1,
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:00:00Z',
  };

  let mockDmDeps: any;

  beforeEach(() => {
    process.env.ENGAGEMENT_SEND_ENABLED = '1';
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*';

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
    mockDmDeps = {
      sendProviderDm: vi.fn().mockResolvedValue({ providerMessageId: 'prov_123' }),
      getChannelCredential: vi.fn().mockResolvedValue({
        accessToken: 'tok_123',
        externalAccountId: 'page_123',
        grantedScopes: ['instagram_manage_messages'],
      }),
      readbackFetcher: vi.fn().mockImplementation(async () => ({
        isLive: true,
        messageId: 'prov_1',
        text: '답장 문안',
        recipientId: caseFixture.customer_ref,
        senderId: 'page_123',
        observedAt: new Date().toISOString(),
      })),
      evaluateAdmission: vi.fn().mockResolvedValue({ admitted: true, message: 'admitted' }),
    };
    repository = new BookingRecoveryRepository(mockSupabase);
    service = new BookingRecoveryService(repository, mockSupabase, mockDmDeps);
  });

  it('이미 확정된 슬롯은 장부 재확인으로 다시 열지 않는다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue({ slot_id: 'slot-booked' } as any);
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), error: null });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: {
        id: 'slot-booked', status: 'BOOKED', version: 2,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
      }, error: null }), update,
    });
    const result = await service.reattestSchedule(actor, { caseId: caseFixture.id, expectedVersion: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: 'SLOT_CONFLICT' });
  });

  it('장부 재확인 중 다른 확정이 선점하면 슬롯 CAS 실패를 반환하고 제안을 만들지 않는다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue({ slot_id: 'slot-race' } as any);
    const save = vi.spyOn(repository, 'saveProposal');
    const updateBuilder = {
      eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: {
        id: 'slot-race', status: 'AVAILABLE', version: 3,
        starts_at: new Date(Date.now() + 86400000).toISOString(),
      }, error: null }), update: vi.fn().mockReturnValue(updateBuilder),
    });
    const result = await service.reattestSchedule(actor, { caseId: caseFixture.id, expectedVersion: 1 });
    expect(result).toMatchObject({ ok: false, code: 'SLOT_CONFLICT' });
    expect(updateBuilder.eq).toHaveBeenCalledWith('version', 3);
    expect(updateBuilder.eq).toHaveBeenCalledWith('status', 'AVAILABLE');
    expect(save).not.toHaveBeenCalled();
  });

  it('가용 슬롯이 없으면 첫 슬롯을 임의 생성하지 않고 NEEDS_CONTEXT를 반환한다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'transitionCase').mockResolvedValue({
      ...caseFixture,
      stage: 'NEEDS_CONTEXT',
      version: 2,
    });
    // mock list available slots -> empty
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const result = await service.prepareReply(actor, {
      caseId: caseFixture.id,
      expectedVersion: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('NEEDS_CONTEXT');
      expect(result.value.reply).toBeNull();
    }
  });

  it('후보 슬롯이 여러 개이고 slotId가 명시되지 않으면 첫 슬롯을 임의로 고르지 않고 확인을 요청한다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'transitionCase').mockResolvedValue({
      ...caseFixture,
      stage: 'NEEDS_CONTEXT',
      version: 2,
    });
    // multiple slots
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { id: 's1', starts_at: '2026-10-17T10:00:00Z' },
          { id: 's2', starts_at: '2026-10-17T14:00:00Z' },
        ],
        error: null,
      }),
    });

    const result = await service.prepareReply(actor, {
      caseId: caseFixture.id,
      expectedVersion: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('NEEDS_CONTEXT');
      expect(result.value.statusLabel).toBe('예약 가능 시간 확인 필요');
    }
  });

  it('prepareReply는 카탈로그 서비스의 소요시간(duration_minutes)이 없으면 CONTEXT_REQUIRED를 반환하여 임의 추정을 차단한다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    const slotId = randomUUID();
    const serviceId = randomUUID();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'booking_recovery_slots') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: slotId,
                workspace_id: actor.workspaceId,
                service_id: serviceId,
                deposit_krw: 10000,
                catalog_version: 'cat_v1',
                starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                ends_at: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
                timezone: 'Asia/Seoul',
                confirmed_by: actor.userId,
                confirmed_at: new Date().toISOString(),
                valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                version: 1,
                status: 'AVAILABLE',
              },
            ],
            error: null,
          }),
        };
      }
      if (table === 'workspace_products_services') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: serviceId,
              name: '맞춤 시술',
              price: 50000,
              active: true,
              updated_at: 'cat_v1',
              duration_minutes: null, // 소요시간 부재
            },
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const result = await service.prepareReply(actor, {
      caseId: caseFixture.id,
      expectedVersion: 1,
      slotId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CONTEXT_REQUIRED');
      expect(result.message).toContain('소요시간');
    }
  });

  it('클라이언트가 승인자 ID를 직접 주입할 수 없다 (contracts guard)', () => {
    const parsed = recoveryCommandSchema.safeParse({
      kind: 'approve_send',
      expectedVersion: 1,
      fingerprint: 'a'.repeat(64),
      actorId: 'another-owner',
    });
    expect(parsed.success).toBe(false);
  });

  it('approveSend는 CAS 전이 후 승인을 저장하고 dm-adapter를 호출하여 발송 체인을 완결한다', async () => {
    const sendDmSpy = vi.fn().mockResolvedValue({ providerMessageId: 'prov_1' });
    service = new BookingRecoveryService(repository, mockSupabase, {
      ...mockDmDeps,
      sendProviderDm: sendDmSpy as any,
    });

    const srvId = randomUUID();
    const slotId = randomUUID();
    const proposalId = randomUUID();
    const nowMs = Date.now();
    const futureStart = new Date(nowMs + 24 * 3600 * 1000).toISOString();
    const futureEnd = new Date(nowMs + 25 * 3600 * 1000).toISOString();
    const futureValid = new Date(nowMs + 2 * 3600 * 1000).toISOString();
    const pastVerified = new Date(nowMs - 3600 * 1000).toISOString();

    const snapshotFixture: any = {
      schemaVersion: 2,
      proposalId,
      revision: 1,
      workspaceId: actor.workspaceId,
      caseId: caseFixture.id,
      recipientRef: caseFixture.customer_ref,
      sourceMessageId: caseFixture.source_inbound_message_id,
      sourceMessageSequence: 1,
      replyText: '답장 문안',
      catalogVersion: 'cat_v1',
      facts: [
        {
          factId: 'fact-1',
          workspaceId: actor.workspaceId,
          version: 'active',
          sourceRef: 'source-1',
          verifiedAt: pastVerified,
          validFrom: pastVerified,
          validUntil: null,
        },
      ],
      offer: {
        serviceId: srvId,
        serviceName: '맞춤 펌',
        totalAmountKrw: 120000,
        depositKrw: 20000,
        slotId,
        slotVersion: 1,
        startsAt: futureStart,
        endsAt: futureEnd,
        timezone: 'Asia/Seoul',
      },
      validUntil: futureValid,
      fingerprint: '',
    };

    const { approvedReplyFingerprint } = await import('../approval-binding');
    const fp = approvedReplyFingerprint(snapshotFixture);
    snapshotFixture.fingerprint = fp;

    const proposalFixture: any = {
      id: proposalId,
      workspace_id: actor.workspaceId,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: srvId,
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌',
      total_amount_krw: 120000,
      deposit_krw: 20000,
      slot_id: slotId,
      slot_version: 1,
      starts_at: futureStart,
      ends_at: futureEnd,
      timezone: 'Asia/Seoul',
      availability_confirmed_at: pastVerified,
      valid_until: futureValid,
      reply_text: '답장 문안',
      payload_fingerprint: fp,
      approved_reply_snapshot: snapshotFixture,
      created_at: pastVerified,
    };

    let caseState: any = { ...caseFixture };
    vi.spyOn(repository, 'getCase').mockImplementation(async () => caseState);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    const approveAndTransitionSpy = vi.spyOn(repository, 'approveAndTransition').mockImplementation(async () => {
      caseState = { ...caseFixture, stage: 'AWAITING_SEND_APPROVAL', version: 2 };
      return {
        approvalId: 'appr-1234',
        caseId: caseFixture.id,
        reviewedCaseVersion: 1,
        authorizedCaseVersion: 2,
        stage: 'AWAITING_SEND_APPROVAL' as const,
        replayed: false,
        expiresAt: '2026-10-16T11:00:00Z',
        case: caseState,
      };
    });

    const transitionSpy = vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => {
      caseState = { ...caseState, stage: p.nextStage, version: p.expectedVersion + 1 };
      return caseState;
    });

    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: '11111111-1111-4111-8111-111111111111',
      attempt: 1,
      step: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        kind: 'SEND_DM',
        status: 'CLAIMED' as const,
        idempotency_key: `recovery:${caseFixture.id}:send:${caseFixture.source_inbound_message_id}:${fp}`,
        input_fingerprint: fp,
        claim_token: '11111111-1111-4111-8111-111111111111',
        attempt: 1,
      },
    });
    vi.spyOn(repository, 'finishStep').mockResolvedValue({});

    mockSupabase.from = vi.fn((table: string) => {
      if (table === 'instagram_dm_messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: caseFixture.source_inbound_message_id,
                sender_type: 'customer',
                sent_at: '2026-10-16T10:00:00Z',
              },
            ],
            error: null,
          }),
        };
      }
      if (table === 'booking_recovery_approvals') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'appr-1234',
              workspace_id: actor.workspaceId,
              case_id: caseFixture.id,
              step_kind: 'SEND',
              payload_fingerprint: fp,
              authorized_case_version: 2,
              case_version: 1,
              source_message_id: caseFixture.source_inbound_message_id,
              catalog_version: 'cat_v1',
              slot_version: 1,
              approved_by: actor.userId,
              approved_at: '2026-10-16T10:00:30Z',
              expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
              consumed_at: null,
              consumed_by_step_id: null,
            },
            error: null,
          }),
        };
      }
      if (table === 'instagram_dm_threads') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: caseFixture.source_thread_id,
              workspace_id: actor.workspaceId,
              channel_connection_id: 'conn_123',
              expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
              status: 'NEEDS_REPLY',
            },
            error: null,
          }),
        };
      }
      const defaultChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      return defaultChain;
    });

    const result = await service.approveSend(actor, {
      caseId: caseFixture.id,
      expectedVersion: 1,
      fingerprint: fp,
    });

    expect(result.ok).toBe(true);
    expect(approveAndTransitionSpy).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ expectedVersion: 1, fingerprint: fp })
    );
    expect(transitionSpy).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ nextStage: 'SEND_REQUESTED' })
    );
  });

  it('approveSend는 v2 snapshot 존재 시 client v1 지문 요청을 VERSION_CONFLICT로 거부하고 발송하지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:01:00Z'));
    try {
      const sendDmSpy = vi.fn().mockResolvedValue({ providerMessageId: 'prov_1' });
      service = new BookingRecoveryService(repository, mockSupabase, {
        ...mockDmDeps,
        sendProviderDm: sendDmSpy as any,
        loadApprovedReply: async () => approvedReply,
      });

      const srvId = randomUUID();
      const slotId = randomUUID();

      const proposalFixture = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: '2026-10-17T14:00:00Z',
        ends_at: '2026-10-17T15:00:00Z',
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T11:00:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: '',
        created_at: '2026-10-16T10:00:00Z',
        approved_reply_snapshot: null as any,
      };

      const approvedReply: ApprovedReplyDto = {
        schemaVersion: 2,
        proposalId: proposalFixture.id,
        revision: proposalFixture.revision,
        workspaceId: actor.workspaceId,
        caseId: caseFixture.id,
        recipientRef: caseFixture.customer_ref,
        sourceMessageId: proposalFixture.source_inbound_message_id,
        sourceMessageSequence: 1,
        replyText: proposalFixture.reply_text,
        catalogVersion: proposalFixture.catalog_version,
        facts: [
          {
            factId: 'fact-1',
            workspaceId: actor.workspaceId,
            version: '1',
            sourceRef: 'source-1',
            verifiedAt: '2026-10-16T09:00:00Z',
            validFrom: '2026-10-16T09:00:00Z',
            validUntil: null,
          },
        ],
        offer: {
          serviceId: proposalFixture.service_id,
          serviceName: proposalFixture.service_name,
          totalAmountKrw: proposalFixture.total_amount_krw,
          depositKrw: proposalFixture.deposit_krw,
          slotId: proposalFixture.slot_id,
          slotVersion: proposalFixture.slot_version,
          startsAt: proposalFixture.starts_at,
          endsAt: proposalFixture.ends_at,
          timezone: proposalFixture.timezone,
        },
        validUntil: proposalFixture.valid_until,
        fingerprint: '',
      };

      const { approvedReplyFingerprint, approvalFingerprint } = await import('../approval-binding');
      const v2Fp = approvedReplyFingerprint(approvedReply);
      (approvedReply as any).fingerprint = v2Fp;
      proposalFixture.payload_fingerprint = v2Fp;
      proposalFixture.approved_reply_snapshot = approvedReply;

      // Client sends legacy v1 fingerprint
      const v1Fp = approvalFingerprint({
        workspaceId: actor.workspaceId,
        caseId: caseFixture.id,
        recipientRef: caseFixture.customer_ref,
        sourceInboundMessageId: caseFixture.source_inbound_message_id,
        replyText: proposalFixture.reply_text,
        catalogVersion: proposalFixture.catalog_version,
        slotVersion: proposalFixture.slot_version,
      });

      vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
      const saveApprovalSpy = vi.spyOn(repository, 'saveApproval');

      const result = await service.approveSend(actor, {
        caseId: caseFixture.id,
        expectedVersion: 1,
        fingerprint: v1Fp,
      });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
      expect(saveApprovalSpy).not.toHaveBeenCalled();
      expect(sendDmSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('approveSend는 snapshot이 없거나 v1이면 CONTEXT_REQUIRED를 반환하고 발송하지 않는다', async () => {
    const sendDmSpy = vi.fn().mockResolvedValue({ providerMessageId: 'prov_1' });
    service = new BookingRecoveryService(repository, mockSupabase, {
      ...mockDmDeps,
      sendProviderDm: sendDmSpy as any,
    });

    const proposalWithoutSnapshot = {
      id: randomUUID(),
      workspace_id: actor.workspaceId,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: randomUUID(),
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌',
      total_amount_krw: 120000,
      deposit_krw: 20000,
      slot_id: randomUUID(),
      slot_version: 1,
      starts_at: '2026-10-17T14:00:00Z',
      ends_at: '2026-10-17T15:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: '2026-10-16T10:00:00Z',
      valid_until: '2026-10-16T11:00:00Z',
      reply_text: '답장 문안',
      payload_fingerprint: 'a'.repeat(64),
      created_at: '2026-10-16T10:00:00Z',
      approved_reply_snapshot: null,
    };

    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalWithoutSnapshot);
    const saveApprovalSpy = vi.spyOn(repository, 'saveApproval');

    const result = await service.approveSend(actor, {
      caseId: caseFixture.id,
      expectedVersion: 1,
      fingerprint: 'a'.repeat(64),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'CONTEXT_REQUIRED' });
    expect(saveApprovalSpy).not.toHaveBeenCalled();
    expect(sendDmSpy).not.toHaveBeenCalled();
  });

  it('approveSend는 stale expectedVersion 요청 시 VERSION_CONFLICT를 반환하고 approval을 생성하지 않는다', async () => {
    const saveApprovalSpy = vi.spyOn(repository, 'saveApproval');
    vi.spyOn(repository, 'getCase').mockResolvedValue({
      ...caseFixture,
      version: 5,
    });

    const result = await service.approveSend(actor, {
      caseId: caseFixture.id,
      expectedVersion: 4, // stale
      fingerprint: 'a'.repeat(64),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(saveApprovalSpy).not.toHaveBeenCalled();
  });

  it('approveSend는 admission/lease 사이 fresh 상태가 변경되면 provider 전송을 차단한다 (cached snapshot 금지)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:01:00Z'));
    try {
      const sendDmSpy = vi.fn().mockResolvedValue({ providerMessageId: 'prov_1' });

      const srvId = randomUUID();
      const slotId = randomUUID();

      const proposalFixture = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: '2026-10-17T14:00:00Z',
        ends_at: '2026-10-17T15:00:00Z',
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T11:00:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: '',
        created_at: '2026-10-16T10:00:00Z',
        approved_reply_snapshot: null as any,
      };

      const approvedReply: ApprovedReplyDto = {
        schemaVersion: 2,
        proposalId: proposalFixture.id,
        revision: proposalFixture.revision,
        workspaceId: actor.workspaceId,
        caseId: caseFixture.id,
        recipientRef: caseFixture.customer_ref,
        sourceMessageId: proposalFixture.source_inbound_message_id,
        sourceMessageSequence: 1,
        replyText: proposalFixture.reply_text,
        catalogVersion: proposalFixture.catalog_version,
        facts: [
          {
            factId: 'fact-1',
            workspaceId: actor.workspaceId,
            version: '1',
            sourceRef: 'source-1',
            verifiedAt: '2026-10-16T09:00:00Z',
            validFrom: '2026-10-16T09:00:00Z',
            validUntil: null,
          },
        ],
        offer: {
          serviceId: proposalFixture.service_id,
          serviceName: proposalFixture.service_name,
          totalAmountKrw: proposalFixture.total_amount_krw,
          depositKrw: proposalFixture.deposit_krw,
          slotId: proposalFixture.slot_id,
          slotVersion: proposalFixture.slot_version,
          startsAt: proposalFixture.starts_at,
          endsAt: proposalFixture.ends_at,
          timezone: proposalFixture.timezone,
        },
        validUntil: proposalFixture.valid_until,
        fingerprint: '',
      };

      const { approvedReplyFingerprint } = await import('../approval-binding');
      const fp = approvedReplyFingerprint(approvedReply);
      (approvedReply as any).fingerprint = fp;
      proposalFixture.payload_fingerprint = fp;
      proposalFixture.approved_reply_snapshot = approvedReply;

      // loader invocation count: 1st is in approveSend, 2nd is in dm-adapter step 6, 3rd is in dm-adapter step 11 re-resolve
      let callCount = 0;
      const loaderSpy = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          // Stale on subsequent calls (e.g. facts changed/expired during lease)
          return null;
        }
        return approvedReply;
      });

      service = new BookingRecoveryService(repository, mockSupabase, {
        ...mockDmDeps,
        sendProviderDm: sendDmSpy as any,
        loadApprovedReply: loaderSpy,
      });

      let currentCase = { ...caseFixture, stage: 'DRAFT_READY' as RecoveryStage, version: 1 };
      vi.spyOn(repository, 'getCase').mockImplementation(async () => currentCase);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
      vi.spyOn(repository, 'saveApproval').mockResolvedValue({} as any);
      vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => {
        currentCase = {
          ...currentCase,
          stage: p.nextStage,
          version: p.expectedVersion + 1,
        };
        return currentCase;
      });

      const result = await service.approveSend(actor, {
        caseId: caseFixture.id,
        expectedVersion: 1,
        fingerprint: fp,
      });

      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ ok: false });
      expect(sendDmSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['verified', 'missing-proof', 'before-readback', 'changed-mind', 'provider-accepted',
    'wrong-time', 'wrong-date', 'wrong-service', 'wrong-party', 'question', 'declined', 'bare-yes'])(
    'confirmAcceptance는 독립 전송 근거·최신 고객 발화로만 원자 수락한다 (%s)', async (scenario) => {
    const srvId = randomUUID();
    const slotId = randomUUID();
    const acceptMsgId = randomUUID();

    const proposalFixture = {
      id: randomUUID(),
      workspace_id: actor.workspaceId,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: srvId,
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌',
      total_amount_krw: 120000,
      deposit_krw: 20000,
      slot_id: slotId,
      slot_version: 1,
      starts_at: '2026-10-17T14:00:00Z',
      ends_at: '2026-10-17T15:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: '2026-10-16T10:00:00Z',
      valid_until: '2026-10-16T11:00:00Z',
      reply_text: '답장 문안',
      payload_fingerprint: 'a'.repeat(64),
      created_at: '2026-10-16T10:00:00Z',
    };

    const awaitingCase = {
      ...caseFixture,
      stage: scenario === 'provider-accepted' ? 'PROVIDER_ACCEPTED' as const : 'AWAITING_CUSTOMER' as const,
      version: 2,
    };
    vi.spyOn(repository, 'getCase').mockResolvedValue(awaitingCase);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    // Mock inbound message lookup
    vi.spyOn(repository, 'getInboundMessage').mockResolvedValue({
      id: acceptMsgId,
      workspace_id: actor.workspaceId,
      thread_id: caseFixture.source_thread_id,
      sender_type: 'customer',
      sender_id: caseFixture.customer_ref,
      text: ({
        'wrong-time': '15시로 예약할게요', 'wrong-date': '다음 달 20일로 예약할게요',
        'wrong-service': '펌 말고 커트로 예약할게요', 'wrong-party': '그 시간으로 2명 예약할게요',
        question: '그 시간 예약 가능한가요?', declined: '예약 안 할게요', 'bare-yes': '네',
      } as Record<string, string>)[scenario] ?? '네 그 시간으로 예약해 주세요!',
      sent_at: '2026-10-16T10:05:00Z',
    });

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });
    const observedAt = scenario === 'before-readback' ? '2026-10-16T10:06:00Z' : '2026-10-16T10:01:00Z';
    const proof = {
      schemaVersion: 1, channel: 'instagram', providerMessageId: 'provider-sent',
      payloadFingerprint: proposalFixture.payload_fingerprint,
      senderId: 'business-account', recipientRef: caseFixture.customer_ref,
      requestedAt: '2026-10-16T10:00:00Z', observedAt,
    };
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), update: updateMock,
      maybeSingle: vi.fn().mockResolvedValue({ data:
        table === 'booking_recovery_steps' ? scenario === 'missing-proof' ? null : {
          workspace_id: actor.workspaceId, case_id: caseFixture.id, kind: 'SEND_DM_VERIFIED',
          status: 'COMPLETED', input_fingerprint: proposalFixture.payload_fingerprint,
          provider_message_id: 'provider-sent', actor_id: actor.userId,
          occurred_at: observedAt, evidence_ref: JSON.stringify(proof),
        } : table === 'instagram_dm_threads' ? { channel_connection_id: 'channel-1' }
          : table === 'channel_connections' ? { external_account_id: 'business-account' }
            : table === 'instagram_dm_messages' ? { id: scenario === 'changed-mind' ? randomUUID() : acceptMsgId }
              : null,
        error: null,
      }),
    }));

    const transition = vi.spyOn(repository, 'transitionCase').mockResolvedValue({
      ...caseFixture,
      stage: 'CUSTOMER_ACCEPTED',
      version: 3,
    });

    const result = await service.confirmAcceptance(actor, {
      caseId: caseFixture.id,
      expectedVersion: 2,
      inboundMessageId: acceptMsgId,
      slotId: slotId,
    });

    expect(updateMock).not.toHaveBeenCalled();
    if (scenario !== 'verified') {
      expect(result.ok).toBe(false);
      expect(transition).not.toHaveBeenCalled();
      return;
    }
    expect(result.ok).toBe(true);
    expect(transition).toHaveBeenCalledWith(actor, expect.objectContaining({ evidenceRef: acceptMsgId }));
    if (result.ok) {
      expect(result.value.stage).toBe('CUSTOMER_ACCEPTED');
      expect(result.value.acceptance?.inboundMessageId).toBe(acceptMsgId);
    }
  });

  it('confirmAcceptance는 classifyAcceptance에 제안의 timezone을 전달한다', async () => {
    const srvId = randomUUID();
    const slotId = randomUUID();
    const acceptMsgId = randomUUID();

    const proposalFixture = {
      id: randomUUID(),
      workspace_id: actor.workspaceId,
      case_id: caseFixture.id,
      revision: 1,
      source_inbound_message_id: caseFixture.source_inbound_message_id,
      source_thread_id: caseFixture.source_thread_id,
      service_id: srvId,
      catalog_version: 'cat_v1',
      service_name: '맞춤 펌',
      total_amount_krw: 120000,
      deposit_krw: 20000,
      slot_id: slotId,
      slot_version: 1,
      starts_at: '2026-10-17T14:00:00Z',
      ends_at: '2026-10-17T15:00:00Z',
      timezone: 'Asia/Seoul',
      availability_confirmed_at: '2026-10-16T10:00:00Z',
      valid_until: '2026-10-16T11:00:00Z',
      reply_text: '답장 문안',
      payload_fingerprint: 'a'.repeat(64),
      created_at: '2026-10-16T10:00:00Z',
    };

    const awaitingCase = {
      ...caseFixture,
      stage: 'AWAITING_CUSTOMER' as const,
      version: 2,
    };
    vi.spyOn(repository, 'getCase').mockResolvedValue(awaitingCase);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    vi.spyOn(repository, 'getInboundMessage').mockResolvedValue({
      id: acceptMsgId,
      workspace_id: actor.workspaceId,
      thread_id: caseFixture.source_thread_id,
      sender_type: 'customer',
      sender_id: caseFixture.customer_ref,
      text: '그 시간으로 예약해주세요',
      sent_at: '2026-10-16T10:05:00Z',
    });

    const observedAt = '2026-10-16T10:01:00Z';
    const proof = {
      schemaVersion: 1,
      channel: 'instagram',
      providerMessageId: 'provider-sent',
      payloadFingerprint: proposalFixture.payload_fingerprint,
      senderId: 'business-account',
      recipientRef: caseFixture.customer_ref,
      requestedAt: '2026-10-16T10:00:00Z',
      observedAt,
    };
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      update: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data:
          table === 'booking_recovery_steps'
            ? {
                workspace_id: actor.workspaceId,
                case_id: caseFixture.id,
                kind: 'SEND_DM_VERIFIED',
                status: 'COMPLETED',
                input_fingerprint: proposalFixture.payload_fingerprint,
                provider_message_id: 'provider-sent',
                actor_id: actor.userId,
                occurred_at: observedAt,
                evidence_ref: JSON.stringify(proof),
              }
            : table === 'instagram_dm_threads'
              ? { channel_connection_id: 'channel-1' }
              : table === 'channel_connections'
                ? { external_account_id: 'business-account' }
                : table === 'instagram_dm_messages'
                  ? { id: acceptMsgId }
                  : null,
        error: null,
      }),
    }));

    vi.spyOn(repository, 'transitionCase').mockResolvedValue({
      ...caseFixture,
      stage: 'CUSTOMER_ACCEPTED',
      version: 3,
    });

    const classifySpy = vi.spyOn(inboundProjector, 'classifyAcceptance');

    const result = await service.confirmAcceptance(actor, {
      caseId: caseFixture.id,
      expectedVersion: 2,
      inboundMessageId: acceptMsgId,
      slotId: slotId,
    });

    expect(result.ok).toBe(true);
    expect(classifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: expect.objectContaining({
          timezone: 'Asia/Seoul',
        }),
      })
    );
  });

  it('approveBooking은 과거 수락 ID만 있고 전송 영수증이 없으면 확정 RPC를 호출하지 않는다', async () => {
    const acceptanceId = randomUUID();
    const acceptedCase = { ...caseFixture, stage: 'CUSTOMER_ACCEPTED' as const, version: 3, accepted_inbound_message_id: acceptanceId };
    const proposal = {
      id: randomUUID(), revision: 1, slot_id: randomUUID(), service_id: randomUUID(),
      total_amount_krw: 40000, deposit_krw: 0, catalog_version: 'catalog-1', slot_version: 1,
      payload_fingerprint: 'a'.repeat(64), valid_until: '2026-10-22T00:00:00Z',
      starts_at: '2026-10-22T10:00:00Z', ends_at: '2026-10-22T11:00:00Z', timezone: 'Asia/Seoul',
    };
    vi.spyOn(repository, 'getCase').mockResolvedValue(acceptedCase);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposal as any);
    vi.spyOn(repository, 'getInboundMessage').mockResolvedValue({
      id: acceptanceId, workspace_id: actor.workspaceId, thread_id: caseFixture.source_thread_id,
      sender_id: caseFixture.customer_ref, sender_type: 'customer', text: '그 시간으로 예약해주세요',
      sent_at: '2026-10-21T10:00:00Z',
    });
    const save = vi.spyOn(repository, 'saveApproval').mockResolvedValue({} as any);
    const confirm = vi.spyOn(repository, 'confirmBooking').mockResolvedValue({
      case: { ...acceptedCase, stage: 'BOOKING_CONFIRMED', version: 4 },
      reservation_id: 'bk_test', slot_id: proposal.slot_id, confirmed_at: '2026-10-21T10:10:00Z',
    });
    mockSupabase.from.mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: table === 'booking_recovery_proposals' ? proposal : null, error: null }),
    }));
    const fingerprint = bookingApprovalFingerprint({
      workspaceId: actor.workspaceId, caseId: caseFixture.id, slotId: proposal.slot_id,
      serviceId: proposal.service_id, totalAmountKrw: proposal.total_amount_krw, depositKrw: 0,
      customerRef: caseFixture.customer_ref, acceptedMessageId: acceptanceId, proposalRevision: 1,
      catalogVersion: proposal.catalog_version, slotVersion: 1,
    });
    const result = await service.approveBooking(actor, { caseId: caseFixture.id, expectedVersion: 3, fingerprint });
    expect(confirm).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('approveBooking은 accepted_inbound_message_id가 없는 케이스를 엄격히 거부한다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue({
      ...caseFixture,
      accepted_inbound_message_id: null,
    });

    const result = await service.approveBooking(actor, {
      caseId: caseFixture.id,
      expectedVersion: 3,
      fingerprint: 'b'.repeat(64),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'CONTEXT_REQUIRED' });
  });

  describe('reattestSchedule (15분 TTL 만료 후 장부 재확인)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T10:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reattestSchedule은 카탈로그 서비스의 소요시간(duration_minutes)이 없거나 유효하지 않으면 CONTEXT_REQUIRED를 반환한다', async () => {
      const srvId = randomUUID();
      const slotId = randomUUID();
      const startsAt = '2026-10-25T14:00:00Z';
      const endsAt = '2026-10-25T15:00:00Z';

      const prevProposal = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T10:15:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: 'a'.repeat(64),
        created_at: '2026-10-16T10:00:00Z',
      };

      vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(prevProposal);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'booking_recovery_slots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: slotId,
                workspace_id: actor.workspaceId,
                service_id: srvId,
                starts_at: startsAt,
                ends_at: endsAt,
                deposit_krw: 20000,
                timezone: 'Asia/Seoul',
                version: 1,
                status: 'AVAILABLE',
              },
              error: null,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: slotId,
                  version: 2,
                  valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                  confirmed_at: new Date().toISOString(),
                  status: 'AVAILABLE',
                },
                error: null,
              }),
            }),
          } as any;
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: srvId,
                name: '맞춤 펌',
                price: 120000,
                active: true,
                updated_at: 'cat_v2',
                duration_minutes: null, // 소요시간 누락
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const result = await service.reattestSchedule(actor, {
        caseId: caseFixture.id,
        expectedVersion: 1,
        slotId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONTEXT_REQUIRED');
        expect(result.message).toContain('소요시간');
      }
    });

    it('reattestSchedule은 슬롯 구간이 서비스 소요시간보다 짧으면 SLOT_CONFLICT를 반환한다', async () => {
      const srvId = randomUUID();
      const slotId = randomUUID();
      const startsAt = '2026-10-25T14:00:00Z';
      const endsAt = '2026-10-25T15:00:00Z'; // 60분

      const prevProposal = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T10:15:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: 'a'.repeat(64),
        created_at: '2026-10-16T10:00:00Z',
      };

      vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(prevProposal);

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'booking_recovery_slots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: slotId,
                workspace_id: actor.workspaceId,
                service_id: srvId,
                starts_at: startsAt,
                ends_at: endsAt,
                deposit_krw: 20000,
                timezone: 'Asia/Seoul',
                version: 1,
                status: 'AVAILABLE',
              },
              error: null,
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: slotId,
                  version: 2,
                  valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                  confirmed_at: new Date().toISOString(),
                  status: 'AVAILABLE',
                },
                error: null,
              }),
            }),
          } as any;
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: srvId,
                name: '맞춤 펌',
                price: 120000,
                active: true,
                updated_at: 'cat_v2',
                duration_minutes: 90, // 서비스는 90분인데 슬롯은 60분
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const result = await service.reattestSchedule(actor, {
        caseId: caseFixture.id,
        expectedVersion: 1,
        slotId,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SLOT_CONFLICT');
        expect(result.message).toContain('소요시간');
      }
    });

    it('동일 서비스/가격/시간/예약금이면 고객 수락을 보존하고 새 슬롯 버전과 유효기간을 발급한다', async () => {
      const srvId = randomUUID();
      const slotId = randomUUID();
      const acceptMsgId = randomUUID();
      const startsAt = '2026-10-25T14:00:00Z';
      const endsAt = '2026-10-25T15:00:00Z';

      const prevProposal = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T10:15:00Z', // expired
        reply_text: '답장 문안',
        payload_fingerprint: 'a'.repeat(64),
        created_at: '2026-10-16T10:00:00Z',
      };

      const acceptedCase = {
        ...caseFixture,
        version: 3,
        stage: 'CUSTOMER_ACCEPTED' as const,
        accepted_inbound_message_id: acceptMsgId,
      };

      vi.spyOn(repository, 'getCase').mockResolvedValue(acceptedCase);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(prevProposal);

      const mockSlot = {
        id: slotId,
        workspace_id: actor.workspaceId,
        service_id: srvId,
        starts_at: startsAt,
        ends_at: endsAt,
        deposit_krw: 20000,
        timezone: 'Asia/Seoul',
        version: 1,
        status: 'AVAILABLE',
      };

      const mockRenewedSlot = {
        ...mockSlot,
        version: 2,
        valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        confirmed_at: new Date().toISOString(),
      };

      const mockCatalog = {
        id: srvId,
        name: '맞춤 펌',
        price: 120000,
        active: true,
        updated_at: 'cat_v2',
        duration_minutes: 60,
      };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'booking_recovery_slots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockSlot, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockRenewedSlot, error: null }),
            }),
          } as any;
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockCatalog, error: null }),
          } as any;
        }
        if (table === 'instagram_dm_messages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { sent_at: '2026-10-16T10:05:00Z' },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const transitionSpy = vi.spyOn(repository, 'transitionCase').mockResolvedValue({
        ...acceptedCase,
        version: 4,
        stage: 'AWAITING_BOOKING_APPROVAL',
      });

      const saveProposalSpy = vi.spyOn(repository, 'saveProposal').mockResolvedValue({} as any);

      const result = await service.reattestSchedule(actor, {
        caseId: caseFixture.id,
        expectedVersion: 3,
        slotId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('AWAITING_BOOKING_APPROVAL');
        expect(result.value.acceptance?.inboundMessageId).toBe(acceptMsgId);
        expect(result.value.acceptance?.receivedAt).toBe('2026-10-16T10:05:00.000Z');
      }
      expect(transitionSpy).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ nextStage: 'AWAITING_BOOKING_APPROVAL' })
      );
      expect(saveProposalSpy).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          revision: 2,
          slotVersion: 2,
        })
      );
    });

    it('조건(가격 등)이 변경된 경우 이전 고객 수락을 파기하고 DRAFT_READY로 전이한다', async () => {
      const srvId = randomUUID();
      const slotId = randomUUID();
      const acceptMsgId = randomUUID();
      const startsAt = '2026-10-25T14:00:00Z';
      const endsAt = '2026-10-25T15:00:00Z';

      const prevProposal = {
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: srvId,
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: slotId,
        slot_version: 1,
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T10:15:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: 'a'.repeat(64),
        created_at: '2026-10-16T10:00:00Z',
      };

      const acceptedCase = {
        ...caseFixture,
        version: 3,
        stage: 'CUSTOMER_ACCEPTED' as const,
        accepted_inbound_message_id: acceptMsgId,
      };

      vi.spyOn(repository, 'getCase').mockResolvedValue(acceptedCase);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(prevProposal);

      const mockSlot = {
        id: slotId,
        workspace_id: actor.workspaceId,
        service_id: srvId,
        starts_at: startsAt,
        ends_at: endsAt,
        deposit_krw: 20000,
        timezone: 'Asia/Seoul',
        version: 1,
        status: 'AVAILABLE',
      };

      const mockRenewedSlot = {
        ...mockSlot,
        version: 2,
        valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        confirmed_at: new Date().toISOString(),
      };

      // Price changed from 120,000 to 150,000!
      const mockCatalogChanged = {
        id: srvId,
        name: '맞춤 펌',
        price: 150000,
        active: true,
        updated_at: 'cat_v2',
        duration_minutes: 60,
      };

      const caseUpdateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'booking_recovery_slots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockSlot, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: mockRenewedSlot, error: null }),
            }),
          } as any;
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockCatalogChanged, error: null }),
          } as any;
        }
        if (table === 'booking_recovery_cases') {
          return {
            update: caseUpdateMock,
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const transitionSpy = vi.spyOn(repository, 'transitionCase').mockResolvedValue({
        ...acceptedCase,
        version: 4,
        stage: 'DRAFT_READY',
        accepted_inbound_message_id: null,
      });

      vi.spyOn(repository, 'saveProposal').mockResolvedValue({} as any);

      const result = await service.reattestSchedule(actor, {
        caseId: caseFixture.id,
        expectedVersion: 3,
        slotId,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('DRAFT_READY');
        expect(result.value.acceptance).toBeNull();
      }
      expect(transitionSpy).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ nextStage: 'DRAFT_READY' })
      );
      expect(caseUpdateMock).toHaveBeenCalledWith({ accepted_inbound_message_id: null });
    });
  });

  describe('getCaseView & listCaseViews (지속형 원장 재개 & 예약 복원)', () => {
    it('인스턴스 재개 시 reservations 테이블에서 확정된 예약 정보를 복원한다', async () => {
      const acceptMsgId = randomUUID();
      const confirmedCase = {
        ...caseFixture,
        stage: 'BOOKING_CONFIRMED' as const,
        version: 4,
        accepted_inbound_message_id: acceptMsgId,
      };

      vi.spyOn(repository, 'getCase').mockResolvedValue(confirmedCase);
      vi.spyOn(repository, 'getLatestProposal').mockResolvedValue({
        id: randomUUID(),
        workspace_id: actor.workspaceId,
        case_id: caseFixture.id,
        revision: 1,
        source_inbound_message_id: caseFixture.source_inbound_message_id,
        source_thread_id: caseFixture.source_thread_id,
        service_id: randomUUID(),
        catalog_version: 'cat_v1',
        service_name: '맞춤 펌',
        total_amount_krw: 120000,
        deposit_krw: 20000,
        slot_id: randomUUID(),
        slot_version: 1,
        starts_at: '2026-10-25T14:00:00Z',
        ends_at: '2026-10-25T15:00:00Z',
        timezone: 'Asia/Seoul',
        availability_confirmed_at: '2026-10-16T10:00:00Z',
        valid_until: '2026-10-16T10:15:00Z',
        reply_text: '답장 문안',
        payload_fingerprint: 'a'.repeat(64),
        created_at: '2026-10-16T10:00:00Z',
      });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'reservations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'bk_durable_12345',
                confirmed_at: '2026-10-16T10:30:00Z',
                status: 'CONFIRMED',
              },
              error: null,
            }),
          } as any;
        }
        if (table === 'instagram_dm_messages') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { sent_at: '2026-10-16T10:05:00Z' },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const view = await service.getCaseView(actor.workspaceId, caseFixture.id);
      expect(view).not.toBeNull();
      expect(view?.booking?.id).toBe('bk_durable_12345');
      expect(view?.booking?.status).toBe('CONFIRMED');
      expect(view?.acceptance?.receivedAt).toBe('2026-10-16T10:05:00.000Z');
    });
  });
});
