import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { approveAndSendReply } from '../dm-adapter';
import { confirmRecoveryBooking } from '../booking-adapter';
import { BookingRecoveryRepository } from '../repository';
import { RecoveryActor, RecoveryProposal } from '../contracts';
import { approvedReplyFingerprint } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';
import { calculateRecoveryOutcome, type RecoveryEventRecord } from '../outcomes';
import {
  LEDGER_FRESHNESS_TTL_MS,
  resolveLedgerFreshness,
  toLedgerFreshnessView,
} from '../ledger-freshness-view';

// ANI-1736: DM → 예약 → 장부 전체 체인을 mock provider 로 로컬 검증한다. 실발송 없음.
// 계약: provider accepted ≠ verified (readback 성공해야만 SEND_VERIFIED),
//       재시도(탭 재탭·네트워크 재요청)가 와도 provider 호출·예약·장부 집계는 각각 1건.

describe('ANI-1736 DM → 예약 → 장부 체인 E2E (mock provider)', () => {
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
  const fingerprint = approvedReplyFingerprint(approvedReply);
  proposalFixture.payload_fingerprint = fingerprint;

  const operationKey = `recovery:${caseFixture.id}:send:${proposalFixture.source_inbound_message_id}:${fingerprint}`;
  const validStep = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspace_id: actor.workspaceId,
    case_id: caseFixture.id,
    kind: 'SEND_DM',
    status: 'CLAIMED' as const,
    idempotency_key: operationKey,
    input_fingerprint: fingerprint,
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
    loadApprovedReply: async () => ({ ...approvedReply, fingerprint }),
  };

  const exactReadback = {
    isLive: true,
    messageId: 'prov_msg_123',
    text: proposalFixture.reply_text,
    recipientId: caseFixture.customer_ref,
    senderId: defaultCred.externalAccountId,
    observedAt: '2026-10-16T10:01:00Z',
  };

  /** 체인 전체 상태. provider·DB·장부를 한 곳에서 관측한다. */
  function createChain() {
    const state = {
      stage: caseFixture.stage as string,
      version: caseFixture.version,
      approvalConsumedAt: null as string | null,
      providerSendCalls: 0,
      providerReadbackCalls: 0,
      reservations: [] as { id: string; slotId: string }[],
      ledger: [] as RecoveryEventRecord[],
    };

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
            maybeSingle: vi.fn().mockImplementation(async () => ({
              data: {
                id: 'appr-1234',
                workspace_id: actor.workspaceId,
                case_id: caseFixture.id,
                step_kind: 'SEND',
                payload_fingerprint: fingerprint,
                authorized_case_version: 3,
                approved_by: actor.userId,
                approved_at: '2026-10-16T10:00:30Z',
                expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
                consumed_at: state.approvalConsumedAt,
              },
              error: null,
            })),
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

    vi.spyOn(repository, 'getCase').mockImplementation(
      async () => ({ ...caseFixture, stage: state.stage as any, version: state.version }) as any
    );
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(proposalFixture);
    vi.spyOn(repository, 'claimStep').mockResolvedValue({
      claimed: true,
      reclaimed: false,
      claim_token: validStep.claim_token,
      attempt: 1,
      step: validStep,
    });
    vi.spyOn(repository, 'transitionCase').mockImplementation(async (_a, p) => {
      state.stage = p.nextStage;
      state.version = p.expectedVersion + 1;
      return { ...caseFixture, stage: p.nextStage, version: state.version } as any;
    });
    vi.spyOn(repository, 'finishStep').mockResolvedValue({} as any);

    // 예약 확정 RPC 의 원자 계약을 상태 있는 fake 로 흉내낸다.
    vi.spyOn(repository, 'confirmBooking').mockImplementation(async (_a, p) => {
      if (!p.inboundAcceptanceMessageId) {
        throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
      }
      if (p.expectedVersion !== state.version) {
        throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
      }
      if (state.reservations.length > 0) {
        throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
      }
      state.version += 1;
      state.reservations.push({ id: 'bk_1', slotId: proposalFixture.slot_id });
      state.ledger.push({
        id: 'evt_1',
        workspaceId: actor.workspaceId,
        caseId: caseFixture.id,
        eventType: 'BOOKING_CONFIRMED',
        reservationId: 'bk_1',
        amountKrw: proposalFixture.deposit_krw,
        occurredAt: new Date(Date.now()).toISOString(),
        isActual: true,
      });
      return {
        reservation_id: 'bk_1',
        slot_id: proposalFixture.slot_id,
        confirmed_at: new Date(Date.now()).toISOString(),
        case: { ...caseFixture, stage: 'BOOKING_CONFIRMED', version: state.version },
      } as any;
    });

    const sendProviderDm = vi.fn().mockImplementation(async () => {
      state.providerSendCalls += 1;
      return { providerMessageId: 'prov_msg_123' };
    });
    const readbackFetcher = vi.fn().mockImplementation(async () => {
      state.providerReadbackCalls += 1;
      return exactReadback;
    });

    return {
      state,
      deps: {
        repository,
        client: mockSupabase,
        ...baseDeps,
        getChannelCredential: async () => defaultCred,
        sendProviderDm,
        readbackFetcher,
      },
      sendProviderDm,
      readbackFetcher,
    };
  }

  const sendParams = { caseId: caseFixture.id, expectedVersion: 3, fingerprint };
  const bookingParams = {
    caseId: caseFixture.id,
    expectedVersion: 3,
    proposalRevision: 1,
    inboundAcceptanceMessageId: 'inbound_accept_1',
    fingerprint,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T10:01:00Z'));
    process.env.ENGAGEMENT_SEND_ENABLED = '1';
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = { ...envBackup };
  });

  it('1. DM 발송 verified → 예약 확정 → 장부 1건: 전 구간이 같은 예약을 가리킨다', async () => {
    const { state, deps } = createChain();

    const sent = await approveAndSendReply(actor, sendParams, deps);
    expect(sent.ok).toBe(true);
    if (sent.ok) {
      expect(sent.value.stage).toBe('AWAITING_CUSTOMER');
      expect(sent.value.providerMessageId).toBe('prov_msg_123');
    }
    // provider accepted 와 verified 를 분리: readback 을 실제로 한 번 수행했다.
    expect(state.providerSendCalls).toBe(1);
    expect(state.providerReadbackCalls).toBe(1);

    // DM 검증 후 케이스 버전이 전진했으므로, 고객 수락 시점의 최신 버전으로 확정한다.
    const booked = await confirmRecoveryBooking(
      actor,
      { ...bookingParams, expectedVersion: state.version },
      { repository, client: mockSupabase }
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) throw new Error('예약 확정 실패');
    expect(booked.value.reservationId).toBe('bk_1');
    expect(booked.value.slotId).toBe(proposalFixture.slot_id);

    const outcome = calculateRecoveryOutcome(state.ledger, { requireActual: true });
    expect(outcome.confirmedBookings).toBe(1);
    expect(outcome.activeConfirmedBookings).toBe(1);
    // 결제 관측이 없으므로 매출은 지어내지 않는다.
    expect(outcome.revenue).toEqual({ status: 'NOT_OBSERVED', amountKrw: null });
    expect(state.ledger.filter((e) => e.eventType === 'BOOKING_CONFIRMED')).toHaveLength(1);
  });

  it('2. DM 재시도(같은 승인 재사용)는 provider 를 다시 부르지 않는다', async () => {
    const { state, deps, sendProviderDm } = createChain();

    const first = await approveAndSendReply(actor, sendParams, deps);
    expect(first.ok).toBe(true);
    expect(sendProviderDm).toHaveBeenCalledTimes(1);

    // 발송 직후 승인 행이 소진된 상태에서 같은 요청이 재도착(탭 재탭·네트워크 재요청).
    state.approvalConsumedAt = '2026-10-16T10:01:05Z';
    const retry = await approveAndSendReply(actor, sendParams, deps);

    expect(retry).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(sendProviderDm).toHaveBeenCalledTimes(1);
    expect(state.providerSendCalls).toBe(1);
  });

  it('3. 예약 확정 재시도는 중복 예약·중복 장부 집계를 만들지 않는다', async () => {
    const { state, deps } = createChain();
    await approveAndSendReply(actor, sendParams, deps);

    const acceptParams = { ...bookingParams, expectedVersion: state.version };
    const first = await confirmRecoveryBooking(actor, acceptParams, { repository, client: mockSupabase });
    expect(first.ok).toBe(true);

    const retry = await confirmRecoveryBooking(actor, acceptParams, { repository, client: mockSupabase });
    expect(retry).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });

    expect(state.reservations).toHaveLength(1);
    expect(calculateRecoveryOutcome(state.ledger).confirmedBookings).toBe(1);
    expect(calculateRecoveryOutcome(state.ledger).activeConfirmedBookings).toBe(1);
  });

  it('4. readback 실패는 RESULT_UNKNOWN 이며 자동 재발송·예약 확정으로 이어지지 않는다', async () => {
    const { state, deps } = createChain();
    deps.readbackFetcher.mockImplementation(async () => {
      state.providerReadbackCalls += 1;
      return { isLive: false, reason: 'NOT_FOUND', messageId: 'prov_msg_123' };
    });

    const sent = await approveAndSendReply(actor, sendParams, deps);
    expect(sent).toMatchObject({ ok: false, code: 'RESULT_UNKNOWN' });
    expect(state.providerSendCalls).toBe(1);

    // 고객 수락 메시지가 없으므로 예약 확정은 막히고 장부도 비어 있다.
    const booked = await confirmRecoveryBooking(
      actor,
      { ...bookingParams, inboundAcceptanceMessageId: '' },
      { repository, client: mockSupabase }
    );
    expect(booked).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(state.reservations).toHaveLength(0);
    expect(state.ledger).toHaveLength(0);
  });

  it('5. 장부는 관측 전·오래됨 모두 "확인 필요"로 fail-closed 이고, 예약 가능으로 표시되지 않는다', () => {
    const nowIso = new Date(Date.now()).toISOString();

    const never = resolveLedgerFreshness({ hasExternalLedgerConnection: false, lastConfirmedAt: null });
    expect(never.freshness).toBe('NOT_OBSERVED');
    expect(never.requiresOwnerConfirmation).toBe(true);
    expect(toLedgerFreshnessView({ freshness: never.freshness }).headline).toBe('확인 필요');

    const stale = resolveLedgerFreshness({
      hasExternalLedgerConnection: true,
      lastConfirmedAt: new Date(Date.now() - LEDGER_FRESHNESS_TTL_MS - 1000).toISOString(),
    });
    expect(stale.freshness).toBe('STALE');
    expect(stale.requiresOwnerConfirmation).toBe(true);

    const fresh = resolveLedgerFreshness({ hasExternalLedgerConnection: true, lastConfirmedAt: nowIso });
    expect(fresh.freshness).toBe('CURRENT');
    expect(fresh.requiresOwnerConfirmation).toBe(false);
    expect(toLedgerFreshnessView({ freshness: fresh.freshness, observedAt: nowIso }).tone).toBe('current');
  });
});
