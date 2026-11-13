import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
import { randomUUID } from 'node:crypto';
import { BookingRecoveryService } from '../service';
import { BookingRecoveryRepository } from '../repository';
import { RecoveryActor } from '../contracts';
import { approvedReplyFingerprint, validateApprovedReply } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';

describe('prepareReply v2 snapshot binding (TDD)', () => {
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

  const srvId = randomUUID();
  const slotId = randomUUID();

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };
    repository = new BookingRecoveryRepository(mockSupabase);
    service = new BookingRecoveryService(repository, mockSupabase);
  });

  it('prepareReply는 v2 ApprovedReplyDto 스냅샷을 생성하고 proposal.approved_reply_snapshot에 영속화한다', async () => {
    vi.spyOn(repository, 'getCase').mockResolvedValue(caseFixture);
    vi.spyOn(repository, 'getLatestProposal').mockResolvedValue(null);

    const nowIso = new Date().toISOString();
    const futureStart = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    const futureValid = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const slotRow = {
      id: slotId,
      workspace_id: actor.workspaceId,
      service_id: srvId,
      starts_at: futureStart,
      ends_at: futureEnd,
      timezone: 'Asia/Seoul',
      deposit_krw: 30000,
      catalog_version: 'cat_v1',
      slot_version: 1,
      confirmed_by: actor.userId,
      confirmed_at: nowIso,
      valid_until: futureValid,
      version: 1,
      status: 'AVAILABLE',
    };

    const serviceRow = {
      id: srvId,
      workspace_id: actor.workspaceId,
      name: '맞춤 펌 시술',
      price: 120000,
      active: true,
      updated_at: 'cat_v1',
      duration_minutes: 60,
    };

    const savedProposalCapture = vi.fn();
    vi.spyOn(repository, 'saveProposal').mockImplementation(async (_actor, params: any) => {
      savedProposalCapture(params);
      return {
        id: params.id || randomUUID(),
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
        timezone: params.timezone,
        availability_confirmed_at: params.availabilityConfirmedAt,
        valid_until: params.validUntil,
        dm_draft_id: params.dmDraftId,
        reply_text: params.replyText,
        payload_fingerprint: params.payloadFingerprint,
        approved_reply_snapshot: params.approvedReplySnapshot,
        created_at: new Date().toISOString(),
      };
    });

    vi.spyOn(repository, 'transitionCase').mockImplementation(async (_act, p) => ({
      ...caseFixture,
      stage: p.nextStage,
      version: 2,
    }));

    mockSupabase.from.mockImplementation((table: string) => {
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
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'prior-msg-1', sent_at: '2026-10-22T07:50:00Z' },
              { id: caseFixture.source_inbound_message_id, sent_at: '2026-10-22T07:55:00Z' },
            ],
            error: null,
          }),
        };
      }
      if (table === 'knowledge_facts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'fact-1',
                workspace_id: actor.workspaceId,
                category: 'price',
                content: '맞춤 펌 120,000원',
                status: 'active',
                source_candidate_id: 'cand-1',
                approved_by_user_id: actor.userId,
                approved_at: nowIso,
                valid_from: nowIso,
                valid_until: null,
                supersedes_fact_id: null,
                created_at: nowIso,
              },
            ],
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
      slotId: slotRow.id,
    });

    expect(result.ok).toBe(true);
    expect(savedProposalCapture).toHaveBeenCalledOnce();

    const savedParams = savedProposalCapture.mock.calls[0][0];
    const snapshot: ApprovedReplyDto = savedParams.approvedReplySnapshot;

    // 1. Snapshot exists and has schemaVersion 2
    expect(snapshot).toBeDefined();
    expect(snapshot.schemaVersion).toBe(2);

    // 2. 14 core fields check
    expect(snapshot.workspaceId).toBe(actor.workspaceId);
    expect(snapshot.caseId).toBe(caseFixture.id);
    expect(snapshot.recipientRef).toBe(caseFixture.customer_ref);
    expect(snapshot.sourceMessageId).toBe(caseFixture.source_inbound_message_id);
    expect(snapshot.sourceMessageSequence).toBe(2); // 2nd message in thread!
    expect(snapshot.catalogVersion).toBe(serviceRow.updated_at);
    expect(snapshot.facts.length).toBeGreaterThan(0);
    expect(snapshot.offer).toMatchObject({
      serviceId: srvId,
      serviceName: '맞춤 펌 시술',
      totalAmountKrw: 120000,
      depositKrw: 30000,
      slotId: slotRow.id,
      slotVersion: 1,
      timezone: 'Asia/Seoul',
    });

    // 3. payload_fingerprint is v2 fingerprint
    const expectedFp = approvedReplyFingerprint(snapshot);
    expect(savedParams.payloadFingerprint).toBe(expectedFp);
    expect(snapshot.fingerprint).toBe(expectedFp);

    // 4. validateApprovedReply passes
    expect(validateApprovedReply(snapshot, expectedFp, new Date(slotRow.confirmed_at))).toBe(true);
  });
});
