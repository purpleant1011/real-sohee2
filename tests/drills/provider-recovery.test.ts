/**
 * V0.93 Provider Recovery & Failure Injection Drills (ANI-1640 / ANI-1641)
 *
 * Ground Truth:
 * - v2 W4 계약 기준, integration/v093@8e03b7b9
 * - docs/security/v093-drill-v2-design.md
 * - Invariants 1-8 enforced:
 *   1. Zero weak contracts / zero v1 fallback.
 *   2. Valid v2 ApprovedReplyDto with real approvedReplyFingerprint and validateApprovedReply.
 *   3. Fake timer with toFake: ['Date'] and restore useRealTimers().
 *   4. Positive controls paired with failure paths.
 *   5. Realistic readback field matching (sender/recipient/text/messageId/observedAt).
 *   6. Stateful mock repository with version & stage tracking.
 *   7. Zero network / zero real DB / zero PII.
 *   8. Zero skip/it.fails/weak assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { approveAndSendReply } from '@/features/booking-recovery/dm-adapter';
import { reconcileOutboxItem, type AttemptedSendEvidence } from '@/features/booking-recovery/reconcile';
import { confirmRecoveryBooking } from '@/features/booking-recovery/booking-adapter';
import { ingestDmMessage, type DmIngestRepository } from '@/features/engagement/dm/ingest';
import type { RecoveryOutboxItem } from '@/features/booking-recovery/repository';
import { FakeChannelProvider } from './fake-provider';
import {
  FIXED_DRILL_NOW,
  FIXED_DRILL_NOW_MS,
  defaultActor,
  defaultChannelCredential,
  createBaseCase,
  buildApprovedReply,
  buildProposalFromApprovedReply,
  createStatefulMockRepository,
  createMockSupabase,
} from './v2-fixtures';

describe('V0.93 Provider Recovery & Failure Injection Drills (ANI-1640 v2)', () => {
  const envBackup = { ...process.env };
  let fakeProvider: FakeChannelProvider;
  let repoControl: ReturnType<typeof createStatefulMockRepository>;
  let supabaseControl: ReturnType<typeof createMockSupabase>;

  const caseFixture = createBaseCase({ stage: 'AWAITING_SEND_APPROVAL', version: 3 });
  const approvedFixture = buildApprovedReply({
    caseId: caseFixture.id,
    workspaceId: defaultActor.workspaceId,
    recipientRef: caseFixture.customer_ref,
    sourceMessageId: caseFixture.source_inbound_message_id,
  });
  const proposalFixture = buildProposalFromApprovedReply(approvedFixture, caseFixture);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_DRILL_NOW));

    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Real network access is strictly blocked during drills');
    }));

    process.env.ENGAGEMENT_SEND_ENABLED = '1';
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*';

    fakeProvider = new FakeChannelProvider('OK');

    repoControl = createStatefulMockRepository(caseFixture, proposalFixture);
    supabaseControl = createMockSupabase({
      workspaceId: defaultActor.workspaceId,
      sourceThreadId: caseFixture.source_thread_id,
      sourceInboundMessageId: caseFixture.source_inbound_message_id,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...envBackup };
  });

  function makeSendDeps(options?: {
    customCred?: typeof defaultChannelCredential;
    loadApprovedReply?: any;
    loadCurrentDraft?: any;
    loadCurrentFingerprint?: any;
    customReadback?: any;
  }) {
    const cred = options?.customCred ?? defaultChannelCredential;
    return {
      repository: repoControl.repository,
      client: supabaseControl.client,
      loadApprovedReply: options && 'loadApprovedReply' in options
        ? options.loadApprovedReply
        : vi.fn(async () => structuredClone(approvedFixture)),
      loadCurrentDraft: options?.loadCurrentDraft,
      loadCurrentFingerprint: options?.loadCurrentFingerprint,
      sendProviderDm: (payload: any) => fakeProvider.sendDm(payload),
      readbackFetcher: options?.customReadback ?? ((payload: any) => fakeProvider.readbackDm(payload)),
      getChannelCredential: async () => cred,
      evaluateAdmission: async () => ({ admitted: true, message: 'admitted' }),
    };
  }

  // --------------------------------------------------------------------------
  // D093-01: 401, 403, scope missing, loadApprovedReply unprovided
  // --------------------------------------------------------------------------
  describe('D093-01: Authentication, Authorization & Context Rejection', () => {
    it('demotes to RESULT_UNKNOWN on 401 without auto-resend', async () => {
      fakeProvider.setMode('AUTH_401');

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RESULT_UNKNOWN');
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(0);
    });

    it('demotes to RESULT_UNKNOWN on 403 without auto-resend', async () => {
      fakeProvider.setMode('AUTH_403');

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RESULT_UNKNOWN');
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(0);
    });

    it('blocks with POLICY_BLOCKED when credential lacks required scope', async () => {
      const credNoScope = {
        accessToken: 'fixture_token_no_scope',
        externalAccountId: 'page_business_123',
        grantedScopes: ['public_profile'],
      };

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps({ customCred: credNoScope })
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('POLICY_BLOCKED');
        expect(result.message).toContain('권한이 부여되지 않았습니다');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('returns CONTEXT_REQUIRED when loadApprovedReply is not provided', async () => {
      const deps = makeSendDeps({ loadApprovedReply: undefined });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        deps
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONTEXT_REQUIRED');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('positive control: delivers and promotes to AWAITING_CUSTOMER on valid execution', async () => {
      fakeProvider.setMode('OK');

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stage).toBe('AWAITING_CUSTOMER');
        expect(result.value.providerMessageId).toBeDefined();
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(1);
      expect(fakeProvider.readbackAttempts).toBe(1);

      const transitions = repoControl.getTransitions();
      expect(transitions.some((t) => t.params.nextStage === 'SEND_VERIFIED')).toBe(true);
      expect(transitions.some((t) => t.params.nextStage === 'AWAITING_CUSTOMER')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-02: 429 Rate Limit
  // --------------------------------------------------------------------------
  describe('D093-02: Rate Limit 429', () => {
    it('demotes to RESULT_UNKNOWN and enqueues to outbox without resend loop', async () => {
      fakeProvider.setMode('RATE_LIMIT_429');

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RESULT_UNKNOWN');
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(0);

      // Enqueued to outbox with UNKNOWN
      expect(supabaseControl.upsertedOutbox.length).toBe(1);
      expect(supabaseControl.upsertedOutbox[0].state).toBe('UNKNOWN');
      expect(supabaseControl.upsertedOutbox[0].case_id).toBe(caseFixture.id);
    });

    it('positive control: normal send proceeds when rate limit is absent', async () => {
      fakeProvider.setMode('OK');
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );
      expect(result.ok).toBe(true);
      expect(fakeProvider.sendAttempts).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // D093-03: 5xx Provider Server Errors (500, 502, 503, 504)
  // --------------------------------------------------------------------------
  describe('D093-03: 5xx Provider Server Errors', () => {
    const errorModes = ['SERVER_ERROR_500', 'SERVER_ERROR_502', 'SERVER_ERROR_503', 'SERVER_ERROR_504'] as const;

    for (const mode of errorModes) {
      it(`demotes to RESULT_UNKNOWN on ${mode} and never masks as success`, async () => {
        fakeProvider.setMode(mode);

        const result = await approveAndSendReply(
          defaultActor,
          { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
          makeSendDeps()
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('RESULT_UNKNOWN');
        }
        expect(fakeProvider.sendAttempts).toBe(1);
        expect(fakeProvider.sideEffectsRecorded).toBe(0);
        expect(supabaseControl.upsertedOutbox.length).toBe(1);
      });
    }

    it('positive control: succeeds when provider returns healthy response', async () => {
      fakeProvider.setMode('OK');
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );
      expect(result.ok).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-04: Timeout After Record & Two-Phase Reconciliation
  // --------------------------------------------------------------------------
  describe('D093-04: Timeout After Record & Readback Reconciliation', () => {
    it('recovers timeout after provider write via readback-only with zero duplicate sends', async () => {
      fakeProvider.setMode('TIMEOUT_AFTER_RECORD');

      // Step 1: Initial send times out from caller perspective
      const initialResult = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(initialResult.ok).toBe(false);
      if (!initialResult.ok) {
        expect(initialResult.code).toBe('RESULT_UNKNOWN');
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(1);
      expect(supabaseControl.upsertedOutbox.length).toBe(1);

      // Step 2: Background reconciler runs
      fakeProvider.setMode('OK');
      const operationKey = `recovery:${caseFixture.id}:send:${approvedFixture.sourceMessageId}:${approvedFixture.fingerprint}`;
      const recorded = fakeProvider.getAllRecords()[0];
      expect(recorded).toBeDefined();

      const outboxItem: RecoveryOutboxItem = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        workspace_id: defaultActor.workspaceId,
        case_id: caseFixture.id,
        source_event_key: operationKey,
        kind: 'SEND_DM',
        state: 'UNKNOWN',
        attempt: 1,
        next_attempt_at: new Date(FIXED_DRILL_NOW_MS + 120000).toISOString(),
        created_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        updated_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
      };

      const attemptedSendEvidence: AttemptedSendEvidence = {
        reply: approvedFixture,
        providerMessageId: recorded.id,
        senderId: defaultChannelCredential.externalAccountId,
        requestedAt: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        actor: defaultActor,
      };

      const reconcileResult = await reconcileOutboxItem(outboxItem, {
        repository: repoControl.repository,
        client: supabaseControl.client,
        loadAttemptedSend: async () => attemptedSendEvidence,
        readbackFetcher: async (params) => fakeProvider.reconcileReadback({
          ...params,
          expectedRecipientId: approvedFixture.recipientRef,
          expectedText: approvedFixture.replyText,
          expectedSenderId: defaultChannelCredential.externalAccountId,
          expectedProviderMessageId: recorded.id,
        }),
      });

      expect(reconcileResult.status).toBe('RESOLVED_VERIFIED');
      // Crucial: sendAttempts MUST remain 1 (zero duplicate transport calls!)
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(1);
      expect(fakeProvider.readbackAttempts).toBe(1);

      // Verify transitions used the verified attempted actor, NOT zero UUID
      const transitions = repoControl.getTransitions();
      const verifiedTransition = transitions.find((t) => t.params.nextStage === 'SEND_VERIFIED');
      expect(verifiedTransition).toBeDefined();
      expect(verifiedTransition!.actor.userId).toBe(defaultActor.userId);
      expect(verifiedTransition!.actor.userId).not.toBe('00000000-0000-0000-0000-000000000000');
      expect(supabaseControl.updatedOutbox.some((u) => u.state === 'FINISHED')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-05: Succeeded send, DB commit fails afterwards
  // --------------------------------------------------------------------------
  describe('D093-05: Post-Send DB Persistence Failure', () => {
    it('returns RESULT_UNKNOWN when finishStep fails after provider send and never conceals failure', async () => {
      repoControl.repository.finishStep = vi.fn().mockRejectedValueOnce(
        new Error('DB transaction commit failed: connection reset')
      );

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RESULT_UNKNOWN');
        expect(result.message).toContain('상태 영속화 중 오류');
      }
      expect(fakeProvider.sendAttempts).toBe(1);
      expect(fakeProvider.sideEffectsRecorded).toBe(1);
    });

    it('positive control: succeeds when DB finishStep persists cleanly', async () => {
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );
      expect(result.ok).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-06: Duplicate Lease & Duplicate Inbound Webhook
  // --------------------------------------------------------------------------
  describe('D093-06: Concurrency & Deduplication', () => {
    it('rejects concurrent step lease with VERSION_CONFLICT and zero send attempts', async () => {
      repoControl.setClaimStepResult({
        claimed: false,
        status: 'ALREADY_CLAIMED',
      });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('deduplicates inbound webhook when message is already present', async () => {
      const mockIngestRepo: DmIngestRepository = {
        findThreadByProviderThreadId: vi.fn().mockResolvedValue({
          id: 'thread_123',
          workspace_id: defaultActor.workspaceId,
          channel_connection_id: 'conn_123',
          customer_id: 'cust_drill_123',
          customer_handle: 'cust_handle',
          status: 'NEEDS_REPLY',
          last_message_at: '2026-10-22T09:00:00Z',
        }),
        upsertThread: vi.fn(),
        insertMessageIfAbsent: vi.fn().mockResolvedValue({ inserted: false }),
        listMessages: vi.fn().mockResolvedValue([]),
      };

      const webhookResult = await ingestDmMessage(
        {
          workspaceId: defaultActor.workspaceId,
          channelConnectionId: 'conn_123',
          businessIgId: 'biz_ig_123',
          mid: 'mid_duplicate_event_999',
          fromId: 'cust_drill_123',
          toId: 'biz_ig_123',
          text: '중복 웹훅 테스트 메시지',
          createdAt: '2026-10-22T09:01:00Z',
        },
        mockIngestRepo
      );

      expect(webhookResult.status).toBe('duplicate');
    });

    it('positive control: claims step and executes send when step is unassigned', async () => {
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );
      expect(result.ok).toBe(true);
      expect(fakeProvider.sendAttempts).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // D093-07: Stale Approval Rejection
  // --------------------------------------------------------------------------
  describe('D093-07: Stale Approval & Integrity Failures', () => {
    it('(a) rejects when a newer customer message arrived after approval', async () => {
      supabaseControl.setThreadMessages([
        {
          id: caseFixture.source_inbound_message_id,
          sender_type: 'customer',
          sent_at: '2026-10-22T09:00:00.000Z',
        },
        {
          id: 'newer_msg_id_999',
          sender_type: 'customer',
          sent_at: '2026-10-22T09:59:00.000Z',
        },
      ]);

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
        expect(result.message).toContain('새로운 고객 메시지가 수신되어');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('(b) rejects when draft text was modified after approval', async () => {
      const deps = makeSendDeps({
        loadCurrentDraft: async () => ({ draftText: '수정된 다른 문안' }),
      });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        deps
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('(c) rejects when fingerprint does not match canonical sha256', async () => {
      const badFp = '0'.repeat(64);
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: badFp },
        makeSendDeps()
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('(d) rejects when loadApprovedReply returns mismatched proposal fields', async () => {
      // Mismatched offer totalAmountKrw
      const mismatchedApproved = buildApprovedReply({
        caseId: caseFixture.id,
        workspaceId: defaultActor.workspaceId,
        recipientRef: caseFixture.customer_ref,
        sourceMessageId: caseFixture.source_inbound_message_id,
        offer: {
          serviceId: '88888888-8888-4888-8888-888888888888',
          serviceName: '시그니처 디자인 펌',
          totalAmountKrw: 999999, // Mismatched with proposal 120000
          depositKrw: 30000,
          slotId: '99999999-9999-4999-8999-999999999999',
          slotVersion: 1,
          startsAt: '2026-10-22T14:00:00.000Z',
          endsAt: '2026-10-22T16:00:00.000Z',
          timezone: 'Asia/Seoul',
        },
      });

      const deps = makeSendDeps({
        loadApprovedReply: async () => mismatchedApproved,
      });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: mismatchedApproved.fingerprint },
        deps
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
        expect(result.message).toContain('승인 지문이 제안 내용과 일치하지 않습니다');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('(e) rejects when approved reply has expired validUntil', async () => {
      const expiredApproved = buildApprovedReply({
        caseId: caseFixture.id,
        workspaceId: defaultActor.workspaceId,
        recipientRef: caseFixture.customer_ref,
        sourceMessageId: caseFixture.source_inbound_message_id,
        validUntil: '2026-10-22T09:00:00.000Z', // Before FIXED_DRILL_NOW 10:00:00
      });

      const deps = makeSendDeps({
        loadApprovedReply: async () => expiredApproved,
      });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: expiredApproved.fingerprint },
        deps
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
      }
      expect(fakeProvider.sendAttempts).toBe(0);
    });

    it('(f) transitions to HUMAN_REVIEW with VERSION_CONFLICT when re-fetch after SEND_REQUESTED diverges', async () => {
      let callCount = 0;
      const deps = makeSendDeps({
        loadApprovedReply: vi.fn(async () => {
          callCount += 1;
          if (callCount === 1) {
            return structuredClone(approvedFixture);
          }
          // Second call (after SEND_REQUESTED) returns altered reply
          return {
            ...structuredClone(approvedFixture),
            replyText: '변경된_다른_답변_문안',
          };
        }),
      });

      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        deps
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
        expect(result.message).toContain('답변 정보가 변경되어 전송하지 않았습니다');
      }
      // Zero provider send attempts!
      expect(fakeProvider.sendAttempts).toBe(0);

      // Verify SEND_REQUESTED was recorded, followed by HUMAN_REVIEW transition
      const transitions = repoControl.getTransitions();
      expect(transitions.some((t) => t.params.nextStage === 'SEND_REQUESTED')).toBe(true);
      expect(transitions.some((t) => t.params.nextStage === 'HUMAN_REVIEW' && t.params.stepKind === 'STALE_BEFORE_SEND')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-08: Booking Slot Conflict Contract
  // --------------------------------------------------------------------------
  describe('D093-08: Booking Slot Conflict Contract', () => {
    it('returns VERSION_CONFLICT on slot conflict in booking adapter', async () => {
      repoControl.repository.confirmBooking = vi.fn().mockRejectedValueOnce({
        code: 'VERSION_CONFLICT',
        message: '해당 시간대는 이미 예약이 확정되었습니다.',
      });

      const result = await confirmRecoveryBooking(
        defaultActor,
        {
          caseId: caseFixture.id,
          expectedVersion: caseFixture.version,
          proposalRevision: proposalFixture.revision,
          inboundAcceptanceMessageId: caseFixture.source_inbound_message_id,
          fingerprint: approvedFixture.fingerprint,
        },
        {
          repository: repoControl.repository,
          client: supabaseControl.client,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VERSION_CONFLICT');
        expect(result.message).toContain('예약 슬롯 또는 케이스 상태가 변경되었습니다');
      }
    });
  });

  // --------------------------------------------------------------------------
  // D093-11: Readback Verification Mismatches
  // --------------------------------------------------------------------------
  describe('D093-11: Readback Verification & Mismatches', () => {
    const mismatchReadbackModes = [
      'READBACK_IS_NOT_LIVE',
      'READBACK_MISMATCH_MESSAGE_ID',
      'READBACK_MISMATCH_RECIPIENT',
      'READBACK_MISMATCH_TEXT',
      'READBACK_MISMATCH_SENDER',
      'READBACK_OBSERVED_PAST',
      'READBACK_OBSERVED_FUTURE',
      'READBACK_EXCEPTION',
    ] as const;

    for (const mode of mismatchReadbackModes) {
      it(`refuses promotion to SEND_VERIFIED on ${mode}`, async () => {
        fakeProvider.setMode(mode);

        const result = await approveAndSendReply(
          defaultActor,
          { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
          makeSendDeps()
        );

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('RESULT_UNKNOWN');
        }

        // Provider recorded the message
        expect(fakeProvider.sendAttempts).toBe(1);
        if (mode !== 'READBACK_EXCEPTION') {
          expect(fakeProvider.sideEffectsRecorded).toBe(1);
        }

        // Must NOT transition to SEND_VERIFIED
        const transitions = repoControl.getTransitions();
        expect(transitions.some((t) => t.params.nextStage === 'SEND_VERIFIED')).toBe(false);

        // Case must be transitioned to RESULT_UNKNOWN
        expect(transitions.some((t) => t.params.nextStage === 'RESULT_UNKNOWN' && t.params.stepKind === 'READBACK_UNVERIFIED')).toBe(true);
      });
    }

    it('positive control: promotes to SEND_VERIFIED when readback matches all fields', async () => {
      fakeProvider.setMode('OK');
      const result = await approveAndSendReply(
        defaultActor,
        { caseId: caseFixture.id, expectedVersion: caseFixture.version, fingerprint: approvedFixture.fingerprint },
        makeSendDeps()
      );

      expect(result.ok).toBe(true);
      const transitions = repoControl.getTransitions();
      expect(transitions.some((t) => t.params.nextStage === 'SEND_VERIFIED')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // D093-12: Reconcile Budget Exhaustion
  // --------------------------------------------------------------------------
  describe('D093-12: Reconcile Budget Exhaustion', () => {
    const operationKey = `recovery:${caseFixture.id}:send:${approvedFixture.sourceMessageId}:${approvedFixture.fingerprint}`;

    it('(a) transitions to HUMAN_REVIEW and marks outbox UNKNOWN with attempted.actor when validAttempt is present', async () => {
      repoControl.setCurrentCase({
        ...caseFixture,
        stage: 'RESULT_UNKNOWN',
      });

      const exhaustedItem: RecoveryOutboxItem = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        workspace_id: defaultActor.workspaceId,
        case_id: caseFixture.id,
        source_event_key: operationKey,
        kind: 'SEND_DM',
        state: 'UNKNOWN',
        attempt: 2, // Next attempt = 3 = MAX_RECONCILE_ATTEMPTS
        next_attempt_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        created_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        updated_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
      };

      const attemptedEvidence: AttemptedSendEvidence = {
        reply: approvedFixture,
        providerMessageId: 'msg_exhausted_123',
        senderId: defaultChannelCredential.externalAccountId,
        requestedAt: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        actor: defaultActor,
      };

      const result = await reconcileOutboxItem(exhaustedItem, {
        repository: repoControl.repository,
        client: supabaseControl.client,
        loadAttemptedSend: async () => attemptedEvidence,
        readbackFetcher: async () => ({ verified: false, reason: 'Still unverified' }),
      });

      expect(result.status).toBe('MOVED_TO_HUMAN_REVIEW');
      expect(result.attempt).toBe(3);

      const transitions = repoControl.getTransitions();
      const exhaustedTransition = transitions.find(
        (t) => t.params.nextStage === 'HUMAN_REVIEW' && t.params.stepKind === 'RECONCILE_EXHAUSTED'
      );
      expect(exhaustedTransition).toBeDefined();
      expect(exhaustedTransition!.actor.userId).toBe(defaultActor.userId);
      expect(exhaustedTransition!.actor.userId).not.toBe('00000000-0000-0000-0000-000000000000');

      // Outbox updated to state UNKNOWN
      expect(supabaseControl.updatedOutbox.some((u) => u.state === 'UNKNOWN' && u.attempt === 3)).toBe(true);
    });

    it('(b) throws RECONCILE_MANUAL_EVIDENCE_REQUIRED when evidence is missing upon exhaustion', async () => {
      repoControl.setCurrentCase({
        ...caseFixture,
        stage: 'RESULT_UNKNOWN',
      });

      const exhaustedItem: RecoveryOutboxItem = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        workspace_id: defaultActor.workspaceId,
        case_id: caseFixture.id,
        source_event_key: operationKey,
        kind: 'SEND_DM',
        state: 'UNKNOWN',
        attempt: 2,
        next_attempt_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        created_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
        updated_at: new Date(FIXED_DRILL_NOW_MS).toISOString(),
      };

      await expect(
        reconcileOutboxItem(exhaustedItem, {
          repository: repoControl.repository,
          client: supabaseControl.client,
          loadAttemptedSend: async () => null,
          readbackFetcher: async () => ({ verified: false }),
        })
      ).rejects.toThrow('RECONCILE_MANUAL_EVIDENCE_REQUIRED');

      expect(repoControl.getTransitions().length).toBe(0);
    });
  });
});
