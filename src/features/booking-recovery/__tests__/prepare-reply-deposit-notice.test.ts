import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BookingRecoveryService } from '../service';
import { BookingRecoveryRepository } from '../repository';
import type { RecoveryActor } from '../contracts';

/**
 * ANI-1615: 0원 예약금은 안내 문장을 만들지 않는다.
 * 예약금이 0원이면 "예약금은 0원입니다" 같은 안내를 고객에게 보내지 않는다.
 */
describe('prepareReply 예약금 안내 문구', () => {
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

  let repository: BookingRecoveryRepository;
  let service: BookingRecoveryService;
  let mockSupabase: any;
  let savedProposals: any[];

  const buildSupabase = (depositKrw: number) => {
    const slotId = randomUUID();
    const serviceId = randomUUID();
    const now = Date.now();
    const slotRow = {
      id: slotId,
      workspace_id: actor.workspaceId,
      service_id: serviceId,
      deposit_krw: depositKrw,
      catalog_version: 'cat_v1',
      starts_at: new Date(now + 24 * 3600 * 1000).toISOString(),
      ends_at: new Date(now + 25 * 3600 * 1000).toISOString(),
      timezone: 'Asia/Seoul',
      confirmed_by: actor.userId,
      confirmed_at: new Date(now - 60 * 1000).toISOString(),
      valid_until: new Date(now + 15 * 60 * 1000).toISOString(),
      version: 1,
      status: 'AVAILABLE',
    };
    const serviceRow = {
      id: serviceId,
      name: '맞춤 시술',
      price: 50000,
      active: true,
      updated_at: 'cat_v1',
      duration_minutes: 60,
    };
    return {
      from: vi.fn((table: string) => {
        if (table === 'booking_recovery_slots') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [slotRow], error: null }),
          };
        }
        if (table === 'workspace_products_services') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: serviceRow, error: null }),
          };
        }
        if (table === 'instagram_dm_messages') {
          // W4 v2 snapshot binding reads the thread to confirm the latest customer turn.
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                { id: caseFixture.source_inbound_message_id, sent_at: '2026-10-16T10:00:00Z' },
              ],
              error: null,
            }),
          };
        }
        if (table === 'knowledge_facts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
      rpc: vi.fn(),
    };
  };

  const prepareWithDeposit = async (depositKrw: number) => {
    mockSupabase = buildSupabase(depositKrw);
    repository = new BookingRecoveryRepository(mockSupabase);
    service = new BookingRecoveryService(repository, mockSupabase, {
      sendProviderDm: vi.fn(),
      getChannelCredential: vi.fn(),
      readbackFetcher: vi.fn(),
      evaluateAdmission: vi.fn(),
    } as any);
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture as any);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(null);
    savedProposals = [];
    vi.spyOn(repository, 'saveProposal').mockImplementation(async (_actor, input: any) => {
      savedProposals.push(input);
      // read-model expects the persisted DB row shape (snake_case).
      return {
        id: randomUUID(),
        workspace_id: input.workspaceId ?? actor.workspaceId,
        case_id: input.caseId,
        revision: input.revision,
        source_inbound_message_id: input.sourceInboundMessageId,
        source_thread_id: input.sourceThreadId,
        service_id: input.serviceId,
        catalog_version: input.catalogVersion,
        service_name: input.serviceName,
        total_amount_krw: input.totalAmountKrw,
        deposit_krw: input.depositKrw,
        slot_id: input.slotId,
        slot_version: input.slotVersion,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        timezone: input.timezone,
        availability_confirmed_at: input.availabilityConfirmedAt,
        valid_until: input.validUntil,
        dm_draft_id: input.dmDraftId ?? null,
        reply_text: input.replyText,
        payload_fingerprint: input.payloadFingerprint,
        created_at: new Date().toISOString(),
        approved_reply_snapshot: null,
      } as any;
    });
    vi.spyOn(repository, 'transitionCase').mockResolvedValue({
      ...caseFixture,
      stage: 'DRAFT_READY',
      version: 2,
    } as any);

    return service.prepareReply(actor, { caseId: caseFixture.id, expectedVersion: 1 });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('예약금이 0원이면 예약금 안내 문장을 만들지 않는다', async () => {
    const result = await prepareWithDeposit(0);
    expect(result.ok).toBe(true);
    expect(savedProposals).toHaveLength(1);
    const replyText = savedProposals[0].replyText as string;
    expect(replyText).not.toContain('예약금');
    expect(replyText).not.toContain('0원');
    expect(replyText).toContain('예약 가능한 시간은');
    expect(replyText).toContain('이 시간으로 예약 진행해 드릴까요?');
  });

  it('예약금이 0원보다 크면 예약금 안내 문장을 그대로 유지한다', async () => {
    const result = await prepareWithDeposit(10000);
    expect(result.ok).toBe(true);
    expect(savedProposals).toHaveLength(1);
    const replyText = savedProposals[0].replyText as string;
    expect(replyText).toContain('예약금은 10,000원입니다.');
  });
});
