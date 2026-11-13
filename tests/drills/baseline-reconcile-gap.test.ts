import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reconcileOutboxItem, type AttemptedSendEvidence, type ReadbackResult } from '@/features/booking-recovery/reconcile';
import type { RecoveryOutboxItem } from '@/features/booking-recovery/repository';
import {
  FIXED_DRILL_NOW,
  FIXED_DRILL_NOW_MS,
  defaultActor,
  createBaseCase,
  buildApprovedReply,
  createStatefulMockRepository,
  createMockSupabase,
} from './v2-fixtures';

describe('V0.93 Reconcile Boundary & Security Regression (ANI-1640 / ANI-1641)', () => {
  const caseFixture = createBaseCase({ stage: 'RESULT_UNKNOWN' });
  const approvedDto = buildApprovedReply({
    caseId: caseFixture.id,
    workspaceId: defaultActor.workspaceId,
    recipientRef: caseFixture.customer_ref,
    sourceMessageId: caseFixture.source_inbound_message_id,
  });

  const validSourceEventKey = `recovery:${caseFixture.id}:send:${approvedDto.sourceMessageId}:${approvedDto.fingerprint}`;

  const validAttemptedSend: AttemptedSendEvidence = {
    reply: approvedDto,
    providerMessageId: 'prov_msg_drill_123',
    senderId: 'page_business_123',
    requestedAt: '2026-10-22T09:45:00.000Z',
    actor: defaultActor,
  };

  let repoControl: ReturnType<typeof createStatefulMockRepository>;
  let supabaseControl: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_DRILL_NOW));

    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Real network access is strictly blocked during drills');
    }));

    repoControl = createStatefulMockRepository(caseFixture);
    supabaseControl = createMockSupabase({
      workspaceId: defaultActor.workspaceId,
      sourceThreadId: caseFixture.source_thread_id,
      sourceInboundMessageId: caseFixture.source_inbound_message_id,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function makeOutboxItem(overrides?: Partial<RecoveryOutboxItem>): RecoveryOutboxItem {
    return {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      workspace_id: defaultActor.workspaceId,
      case_id: caseFixture.id,
      source_event_key: validSourceEventKey,
      kind: 'SEND_DM',
      state: 'UNKNOWN',
      attempt: 1,
      next_attempt_at: new Date(FIXED_DRILL_NOW_MS + 120000).toISOString(),
      created_at: '2026-10-22T09:46:00.000Z',
      updated_at: '2026-10-22T09:46:00.000Z',
      ...overrides,
    };
  }

  // --------------------------------------------------------------------------
  // 1. Malicious verified: true with field mismatches
  // --------------------------------------------------------------------------
  describe('Malicious verified:true readback with mismatched fields', () => {
    const mismatchCases: Array<{
      name: string;
      patch: Partial<ReadbackResult>;
    }> = [
      {
        name: 'different recipientRef',
        patch: { recipientRef: 'wrong_victim_customer_999' },
      },
      {
        name: 'different reply text',
        patch: { text: '변조된_다른_메시지_본문' },
      },
      {
        name: 'different senderId',
        patch: { senderId: 'attacker_wrong_page_999' },
      },
      {
        name: 'different providerMessageId',
        patch: { providerMessageId: 'different_msg_id_999' },
      },
      {
        name: 'stale observedAt prior to requestedAt',
        patch: { observedAt: '2026-10-22T09:00:00.000Z' },
      },
      {
        name: 'future observedAt after current time',
        patch: { observedAt: '2026-10-22T11:00:00.000Z' },
      },
    ];

    for (const { name, patch } of mismatchCases) {
      it(`refuses promotion to RESOLVED_VERIFIED when readback has ${name}`, async () => {
        let readbackCallCount = 0;
        const readbackFetcher = vi.fn(async (): Promise<ReadbackResult> => {
          readbackCallCount += 1;
          return {
            verified: true,
            providerMessageId: validAttemptedSend.providerMessageId!,
            recipientRef: approvedDto.recipientRef,
            text: approvedDto.replyText,
            senderId: validAttemptedSend.senderId,
            observedAt: '2026-10-22T09:50:00.000Z',
            ...patch,
          };
        });

        const outboxItem = makeOutboxItem();
        const result = await reconcileOutboxItem(outboxItem, {
          repository: repoControl.repository,
          client: supabaseControl.client,
          loadAttemptedSend: async () => validAttemptedSend,
          readbackFetcher,
        });

        // 1. Must NOT be promoted to RESOLVED_VERIFIED
        expect(result.status).not.toBe('RESOLVED_VERIFIED');

        // 2. readbackFetcher MUST be invoked because attemptedSend was valid
        expect(readbackCallCount).toBeGreaterThanOrEqual(1);

        // 3. Must NOT transition case to SEND_VERIFIED
        const transitions = repoControl.getTransitions();
        expect(transitions.some((t) => t.params.nextStage === 'SEND_VERIFIED')).toBe(false);

        // 4. Outbox state must NOT be marked FINISHED
        expect(supabaseControl.updatedOutbox.some((u) => u.state === 'FINISHED')).toBe(false);
      });
    }
  });

  // --------------------------------------------------------------------------
  // 2. Missing immutable attempted evidence
  // --------------------------------------------------------------------------
  describe('Missing or invalid attempted evidence', () => {
    it('refuses to invoke readbackFetcher and aborts transitions when loadAttemptedSend is null', async () => {
      let readbackCallCount = 0;
      const readbackFetcher = vi.fn(async (): Promise<ReadbackResult> => {
        readbackCallCount += 1;
        return {
          verified: true,
          providerMessageId: 'prov_msg_drill_123',
          recipientRef: approvedDto.recipientRef,
          text: approvedDto.replyText,
          senderId: 'page_business_123',
          observedAt: '2026-10-22T09:50:00.000Z',
        };
      });

      const outboxItem = makeOutboxItem();
      const result = await reconcileOutboxItem(outboxItem, {
        repository: repoControl.repository,
        client: supabaseControl.client,
        loadAttemptedSend: async () => null,
        readbackFetcher,
      });

      // 1. readbackFetcher must NEVER be invoked without valid attempted evidence
      expect(readbackCallCount).toBe(0);

      // 2. No transitions to SEND_VERIFIED
      expect(repoControl.getTransitions().length).toBe(0);

      // 3. Outbox remains UNKNOWN
      expect(result.status).toBe('RETRY_SCHEDULED');
      expect(supabaseControl.updatedOutbox.some((u) => u.state === 'FINISHED')).toBe(false);
    });

    it('refuses to invoke readbackFetcher when source_event_key does not match fingerprint', async () => {
      const mismatchedItem = makeOutboxItem({
        source_event_key: `recovery:${caseFixture.id}:send:${approvedDto.sourceMessageId}:0000000000000000000000000000000000000000000000000000000000000000`,
      });

      let readbackCallCount = 0;
      const readbackFetcher = vi.fn(async (): Promise<ReadbackResult> => {
        readbackCallCount += 1;
        return { verified: true };
      });

      const result = await reconcileOutboxItem(mismatchedItem, {
        repository: repoControl.repository,
        client: supabaseControl.client,
        loadAttemptedSend: async () => validAttemptedSend,
        readbackFetcher,
      });

      expect(readbackCallCount).toBe(0);
      expect(result.status).toBe('RETRY_SCHEDULED');
      expect(repoControl.getTransitions().length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Positive control: all fields match exactly
  // --------------------------------------------------------------------------
  describe('Positive control', () => {
    it('promotes to RESOLVED_VERIFIED and transitions case with valid actor and fingerprint', async () => {
      let readbackCallCount = 0;
      const readbackFetcher = vi.fn(async (): Promise<ReadbackResult> => {
        readbackCallCount += 1;
        return {
          verified: true,
          providerMessageId: validAttemptedSend.providerMessageId!,
          recipientRef: approvedDto.recipientRef,
          text: approvedDto.replyText,
          senderId: validAttemptedSend.senderId,
          observedAt: '2026-10-22T09:50:00.000Z',
        };
      });

      const outboxItem = makeOutboxItem();
      const result = await reconcileOutboxItem(outboxItem, {
        repository: repoControl.repository,
        client: supabaseControl.client,
        loadAttemptedSend: async () => validAttemptedSend,
        readbackFetcher,
      });

      expect(result.status).toBe('RESOLVED_VERIFIED');
      expect(readbackCallCount).toBe(1);

      // Verify transitions
      const transitions = repoControl.getTransitions();
      expect(transitions.length).toBeGreaterThanOrEqual(1);

      // Verify transition actor is NOT zero UUID
      for (const t of transitions) {
        expect(t.actor.userId).toBe(defaultActor.userId);
        expect(t.actor.userId).not.toBe('00000000-0000-0000-0000-000000000000');
        expect(t.actor.role).toBe('owner');
        expect(t.params.fingerprint).toBe(approvedDto.fingerprint);
      }

      // Verify SEND_VERIFIED transition occurred
      const verifiedTransition = transitions.find((t) => t.params.nextStage === 'SEND_VERIFIED');
      expect(verifiedTransition).toBeDefined();
      expect(verifiedTransition!.params.providerMessageId).toBe(validAttemptedSend.providerMessageId);

      // Verify outbox was updated to FINISHED
      expect(supabaseControl.updatedOutbox.some((u) => u.state === 'FINISHED')).toBe(true);
    });
  });
});
