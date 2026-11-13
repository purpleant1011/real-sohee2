import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { approveAndSendReply } from '../dm-adapter';
import { BookingRecoveryRepository } from '../repository';
import { RecoveryActor, RecoveryProposal } from '../contracts';
import { approvedReplyFingerprint } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';

describe('Booking Recovery DM Adapter Hardening', () => {
  let mockSupabase: any;
  let repository: BookingRecoveryRepository;
  const envBackup = { ...process.env };

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
    stage: 'AWAITING_SEND_APPROVAL' as const,
    version: 3,
    created_at: '2026-10-16T10:00:00Z',
    updated_at: '2026-10-16T10:00:00Z',
  };

  const fingerprintB = 'b'.repeat(64);

  const proposalFixture: RecoveryProposal = {
    id: '77777777-7777-4777-8777-777777777777',
    workspace_id: actor.workspaceId,
    case_id: caseFixture.id,
    revision: 1,
    source_inbound_message_id: caseFixture.source_inbound_message_id,
    source_thread_id: caseFixture.source_thread_id,
    service_id: '88888888-8888-4888-8888-888888888888',
    catalog_version: 'cat_v1',
    service_name: '맞춤 펌 시술',
    total_amount_krw: 120000,
    deposit_krw: 30000,
    slot_id: '99999999-9999-4999-8999-999999999999',
    slot_version: 1,
    starts_at: '2026-10-17T14:00:00Z',
    ends_at: '2026-10-17T16:00:00Z',
    timezone: 'Asia/Seoul',
    availability_confirmed_at: '2026-10-16T10:00:00Z',
    valid_until: '2026-10-16T10:15:00Z',
    reply_text: '테스트 답장 문안',
    payload_fingerprint: '',
    created_at: '2026-10-16T10:00:00Z',
  };

  const approvedReply: ApprovedReplyDto = {
    schemaVersion: 2, proposalId: proposalFixture.id, revision: proposalFixture.revision,
    workspaceId: actor.workspaceId, caseId: caseFixture.id, recipientRef: caseFixture.customer_ref,
    sourceMessageId: proposalFixture.source_inbound_message_id, sourceMessageSequence: 1,
    replyText: proposalFixture.reply_text, catalogVersion: proposalFixture.catalog_version,
    facts: [{ factId: 'fact-1', workspaceId: actor.workspaceId, version: '1', sourceRef: 'source-1',
      verifiedAt: '2026-10-16T09:00:00Z', validFrom: '2026-10-16T09:00:00Z', validUntil: null }],
    offer: { serviceId: proposalFixture.service_id, serviceName: proposalFixture.service_name,
      totalAmountKrw: proposalFixture.total_amount_krw, depositKrw: proposalFixture.deposit_krw,
      slotId: proposalFixture.slot_id, slotVersion: proposalFixture.slot_version,
      startsAt: proposalFixture.starts_at, endsAt: proposalFixture.ends_at, timezone: proposalFixture.timezone },
    validUntil: proposalFixture.valid_until, fingerprint: '',
  };
  const fingerprintA = approvedReplyFingerprint(approvedReply);
  proposalFixture.payload_fingerprint = fingerprintA;

  const operationKey = `recovery:${caseFixture.id}:send:${proposalFixture.source_inbound_message_id}:${fingerprintA}`;
  const validStep = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspace_id: actor.workspaceId,
    case_id: caseFixture.id,
    kind: 'SEND_DM',
    status: 'CLAIMED' as const,
    idempotency_key: operationKey,
    input_fingerprint: fingerprintA,
    claim_token: '11111111-1111-4111-8111-111111111111',
    attempt: 1,
  };

  const defaultCred = {
    accessToken: 'real_valid_token_xyz',
    externalAccountId: 'page_real_999',
    grantedScopes: ['instagram_manage_messages'],
  };

  const baseDeps = {
    evaluateAdmission: async () => ({ admitted: true, message: 'admitted' }),
    loadApprovedReply: async () => ({ ...approvedReply, fingerprint: fingerprintA }),
  };
  const exactReadback = {
    isLive: true, messageId: 'prov_msg_123', text: proposalFixture.reply_text,
    recipientId: caseFixture.customer_ref, senderId: defaultCred.externalAccountId,
    observedAt: '2026-10-16T10:01:00Z',
  };

  function prepareSend() {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
    vi.spyOn(repository, 'claimStep').mockResolvedValue({ claimed: true, reclaimed: false,
      claim_token: validStep.claim_token, attempt: 1, step: validStep });
    vi.spyOn(repository, 'transitionCase').mockImplementation(async (_actor, params) => ({
      ...caseFixture, stage: params.nextStage, version: params.expectedVersion + 1,
    }));
    vi.spyOn(repository, 'finishStep').mockResolvedValue({});
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'prov_msg_123' });
    return { repository, client: mockSupabase, ...baseDeps,
      getChannelCredential: async () => defaultCred, sendProviderDm: send,
      readbackFetcher: async () => exactReadback };
  }

  it.each([
    { total_amount_krw: 50000 }, { deposit_krw: 0 }, { revision: 2 },
    { catalog_version: 'cat_v2' }, { slot_version: 2 }, { workspace_id: 'other-workspace' },
  ])('persisted proposal 조건 변경에도 과거 지문 발송 금지: %j', async (patch) => {
    const deps = prepareSend();
    vi.mocked(repository.getLatestProposal).mockResolvedValue({ ...proposalFixture, ...patch });
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('현재 Fact/sequence resolver 없으면 legacy 지문 발송 금지', async () => {
    const deps = prepareSend();
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      { ...deps, loadApprovedReply: undefined });
    expect(result).toMatchObject({ ok: false, code: 'CONTEXT_REQUIRED' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('최신 고객 메시지 조회 오류는 미확인으로 차단', async () => {
    const deps = prepareSend();
    const original = mockSupabase.from.getMockImplementation();
    mockSupabase.from.mockImplementation((table: string) => table === 'instagram_dm_messages'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'unavailable' } }) }
      : original(table));
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'CONTEXT_REQUIRED' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('DB에 승인 레코드가 없으면 FORBIDDEN 반환 및 Provider 호출 0회 차단', async () => {
    const deps = prepareSend();
    const original = mockSupabase.from.getMockImplementation();
    mockSupabase.from.mockImplementation((table: string) => table === 'booking_recovery_approvals'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
      : original(table));
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('approval.authorized_case_version이 expectedVersion과 불일치하면 VERSION_CONFLICT 반환', async () => {
    const deps = prepareSend();
    const original = mockSupabase.from.getMockImplementation();
    mockSupabase.from.mockImplementation((table: string) => table === 'booking_recovery_approvals'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'appr-1', workspace_id: actor.workspaceId, case_id: caseFixture.id, step_kind: 'SEND', payload_fingerprint: fingerprintA, authorized_case_version: 999, expires_at: new Date(Date.now() + 3600000).toISOString(), consumed_at: null }, error: null,
        }) }
      : original(table));
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('이미 consumed_at이 찍힌 승인은 VERSION_CONFLICT 반환 및 Provider 호출 0회 차단', async () => {
    const deps = prepareSend();
    const original = mockSupabase.from.getMockImplementation();
    mockSupabase.from.mockImplementation((table: string) => table === 'booking_recovery_approvals'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'appr-1', workspace_id: actor.workspaceId, case_id: caseFixture.id, step_kind: 'SEND', payload_fingerprint: fingerprintA, authorized_case_version: 3, expires_at: new Date(Date.now() + 3600000).toISOString(), consumed_at: new Date().toISOString() }, error: null,
        }) }
      : original(table));
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('만료된 승인(expires_at 경과)은 VERSION_CONFLICT 반환 및 Provider 호출 0회 차단', async () => {
    const deps = prepareSend();
    const original = mockSupabase.from.getMockImplementation();
    mockSupabase.from.mockImplementation((table: string) => table === 'booking_recovery_approvals'
      ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'appr-1', workspace_id: actor.workspaceId, case_id: caseFixture.id, step_kind: 'SEND', payload_fingerprint: fingerprintA, authorized_case_version: 3, expires_at: new Date(Date.now() - 1000).toISOString(), consumed_at: null }, error: null,
        }) }
      : original(table));
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it.each(['SEND_REQUESTED', 'RESULT_UNKNOWN', 'HUMAN_REVIEW', 'AWAITING_CUSTOMER'] as const)(
    '%s 상태는 lease 만료 후에도 재발송 금지', async (stage) => {
      const deps = prepareSend();
      vi.mocked(repository.getCase).mockResolvedValue({ ...caseFixture, stage });
      const result = await approveAndSendReply(actor,
        { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA }, deps);
      expect(result.ok).toBe(false);
      expect(deps.sendProviderDm).not.toHaveBeenCalled();
    });

  it('admission 이후 source sequence가 바뀌면 최종 방어에서 발송 0건', async () => {
    const deps = prepareSend();
    const load = vi.fn().mockResolvedValueOnce({ ...approvedReply, fingerprint: fingerprintA })
      .mockResolvedValueOnce({ ...approvedReply, sourceMessageSequence: 2, fingerprint: fingerprintA });
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      { ...deps, loadApprovedReply: load });
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(deps.sendProviderDm).not.toHaveBeenCalled();
  });

  it('네트워크 타임아웃 이후 UI 재시도는 발송 1회만 유지', async () => {
    const deps = prepareSend();
    deps.sendProviderDm.mockRejectedValue(new Error('network timeout'));
    const params = { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA };
    expect(await approveAndSendReply(actor, params, deps)).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    vi.mocked(repository.getCase).mockResolvedValue({ ...caseFixture, stage: 'RESULT_UNKNOWN', version: 5 });
    expect((await approveAndSendReply(actor, params, deps)).ok).toBe(false);
    expect(deps.sendProviderDm).toHaveBeenCalledTimes(1);
  });

  it.each([
    { messageId: 'wrong-id' }, { text: '다른 문안' }, { recipientId: 'other-customer' },
    { senderId: 'other-business' }, { observedAt: '' },
  ])('isLive=true여도 독립 증거 불일치면 미확인: %j', async (patch) => {
    const deps = prepareSend();
    const result = await approveAndSendReply(actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      { ...deps, readbackFetcher: async () => ({ ...exactReadback, ...patch }) });
    expect(result).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(deps.sendProviderDm).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:01:00Z'));
    process.env.ENGAGEMENT_SEND_ENABLED = '1';
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*';

    mockSupabase = {
      from: vi.fn((table: string) => {
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
                payload_fingerprint: fingerprintA,
                authorized_case_version: 3,
                case_version: 2,
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
        if (table === 'booking_recovery_outbox') {
          return {
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: vi.fn(),
    };
    repository = new BookingRecoveryRepository(mockSupabase);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...envBackup };
  });

  it('1. ENGAGEMENT_SEND_ENABLED !== 1 (게이트 OFF) 시 mock callback 주입에도 provider 호출 0회 차단', async () => {
    process.env.ENGAGEMENT_SEND_ENABLED = '0'; // Gate OFF
    const send = vi.fn();
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        ...baseDeps,
      }
    );

    expect(result).toMatchObject({ ok: false, code: 'POLICY_BLOCKED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('2. MALFORMED / INVALID step claim 반환 시 provider 호출 0회 차단 (Fail-Closed, placeholder fallback 금지)', async () => {
    const send = vi.fn();
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    // Schema drifting or empty step returned
    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: '11111111-1111-4111-8111-111111111111',
      attempt: 1,
      step: { id: '' } as any, // Missing required fields
    });

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        ...baseDeps,
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VERSION_CONFLICT');
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('3. 승인과 다른 최신 문안을 자동 승인하지 않는다 (409 VERSION_CONFLICT, provider 0회)', async () => {
    const send = vi.fn();
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    const result = await approveAndSendReply(
      actor,
      {
        caseId: caseFixture.id,
        expectedVersion: 3,
        fingerprint: fingerprintA,
      },
      {
        repository,
        client: mockSupabase,
        loadCurrentFingerprint: async () => fingerprintB,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        ...baseDeps,
      }
    );

    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('4. 새로운 고객 메시지가 수신된 경우(stale 승인) provider 호출 0회 차단', async () => {
    const send = vi.fn();
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);

    // Thread contains a newer customer message than case source message
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
              {
                id: 'new-cust-msg-999',
                sender_type: 'customer',
                sent_at: '2026-10-16T10:05:00Z',
              },
            ],
            error: null,
          }),
        };
      }
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
            payload_fingerprint: fingerprintA,
            authorized_case_version: 3,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            consumed_at: null,
          },
          error: null,
        }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        ...baseDeps,
      }
    );

    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('5. provider 호출 시 가짜 하드코딩 토큰이 아닌 실제 조회된 credential을 전달한다', async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'prov_msg_123' });
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: validStep.claim_token,
      attempt: 1,
      step: validStep,
    });
    vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => ({
      ...caseFixture,
      stage: p.nextStage,
      version: caseFixture.version + 1,
    }));
    vi.spyOn(repository, 'finishStep').mockResolvedValue({});

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        readbackFetcher: async () => exactReadback,
        ...baseDeps,
      }
    );

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    // Verified: Delivered actual credentials, NEVER 'page_123' or 'token_123'
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: defaultCred.externalAccountId,
        accessToken: defaultCred.accessToken,
        recipientId: caseFixture.customer_ref,
        text: proposalFixture.reply_text,
      })
    );
  });

  it('6. 독립 readback 검증 성공 시 PROVIDER_ACCEPTED -> SEND_VERIFIED -> AWAITING_CUSTOMER로 완결 전이', async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'prov_msg_123' });
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: validStep.claim_token,
      attempt: 1,
      step: validStep,
    });
    const transitionSpy = vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => ({
      ...caseFixture,
      stage: p.nextStage,
      version: caseFixture.version + 1,
    }));
    vi.spyOn(repository, 'finishStep').mockResolvedValue({});

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        readbackFetcher: async () => exactReadback,
        ...baseDeps,
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stage).toBe('AWAITING_CUSTOMER');
      expect(result.value.providerMessageId).toBe('prov_msg_123');
    }

    const transitions = transitionSpy.mock.calls.map((c) => c[1].nextStage);
    expect(transitions).toContain('SEND_REQUESTED');
    expect(transitions).toContain('PROVIDER_ACCEPTED');
    expect(transitions).toContain('SEND_VERIFIED');
    expect(transitions).toContain('AWAITING_CUSTOMER');
    const verified = transitionSpy.mock.calls.find((call) => call[1].nextStage === 'SEND_VERIFIED')![1];
    expect(JSON.parse(verified.evidenceRef!)).toMatchObject({
      schemaVersion: 1, providerMessageId: 'prov_msg_123', payloadFingerprint: fingerprintA,
      senderId: defaultCred.externalAccountId, recipientRef: caseFixture.customer_ref,
      observedAt: exactReadback.observedAt,
    });
  });

  it('7. 독립 readback 실패 시 RESULT_UNKNOWN으로 전이하고 자동 재발송하지 않는다', async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'prov_msg_unverified' });
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: validStep.claim_token,
      attempt: 1,
      step: validStep,
    });
    const transitionSpy = vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => ({
      ...caseFixture,
      stage: p.nextStage,
      version: caseFixture.version + 1,
    }));
    vi.spyOn(repository, 'finishStep').mockResolvedValue({});

    const result = await approveAndSendReply(
      actor,
      { caseId: caseFixture.id, expectedVersion: 3, fingerprint: fingerprintA },
      {
        repository,
        client: mockSupabase,
        sendProviderDm: send,
        getChannelCredential: async () => defaultCred,
        readbackFetcher: async () => ({ isLive: false }), // Readback fails
        ...baseDeps,
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('RESULT_UNKNOWN');
    }
    const transitions = transitionSpy.mock.calls.map((c) => c[1].nextStage);
    expect(transitions).toContain('RESULT_UNKNOWN');
    expect(transitions).not.toContain('AWAITING_CUSTOMER');
  });
});
