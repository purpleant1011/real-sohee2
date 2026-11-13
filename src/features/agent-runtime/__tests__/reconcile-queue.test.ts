import { describe, it, expect } from 'vitest';
import { ResultUnknownReconcileQueue } from '../reconcile-queue';

describe('ANI-816: RESULT_UNKNOWN Reconcile Queue', () => {
  it('enqueues RESULT_UNKNOWN and enforces idempotency key uniqueness (zero duplicates)', () => {
    const queue = new ResultUnknownReconcileQueue();

    const item1 = queue.enqueue({
      actionRunId: 'run-001',
      workspaceId: 'ws-123',
      idempotencyKey: 'idem-key-abc',
      channel: 'instagram',
      expectedPayload: { caption: '안녕하세요' },
      reservedCredits: 200,
    });

    expect(item1.status).toBe('QUEUED');
    expect(item1.idempotencyKey).toBe('idem-key-abc');

    // Duplicate enqueue attempt with the same idempotency key must return the existing item
    const item2 = queue.enqueue({
      actionRunId: 'run-002',
      workspaceId: 'ws-123',
      idempotencyKey: 'idem-key-abc',
      channel: 'instagram',
      expectedPayload: { caption: '안녕하세요' },
      reservedCredits: 200,
    });

    expect(item2.id).toBe(item1.id);
    expect(queue.listPendingItems('ws-123').length).toBe(1);
  });

  it('promotes to RESOLVED_VERIFIED and settles credits when provider lookup succeeds', async () => {
    const queue = new ResultUnknownReconcileQueue();
    const item = queue.enqueue({
      actionRunId: 'run-001',
      workspaceId: 'ws-123',
      idempotencyKey: 'idem-success',
      channel: 'naver',
      expectedPayload: { title: '가게 소개' },
      reservedCredits: 300,
    });

    const res = await queue.reconcileItem(item.id, async (idemKey) => {
      expect(idemKey).toBe('idem-success');
      return {
        isObjectFound: true,
        authoritativeId: 'naver-blog-post-555',
        liveUrl: 'https://blog.naver.com/my-shop/555',
      };
    });

    expect(res.outcome).toBe('PROMOTED_TO_VERIFIED');
    expect(res.settledCredits).toBe(300);
    expect(res.refundedCredits).toBe(0);
    expect(res.item.status).toBe('RESOLVED_VERIFIED');
    expect(res.item.resolutionCertificate?.authoritativeId).toBe('naver-blog-post-555');
  });

  it('exhausts attempts and refunds reserved credits when provider lookup repeatedly fails', async () => {
    const queue = new ResultUnknownReconcileQueue();
    const item = queue.enqueue({
      actionRunId: 'run-fail',
      workspaceId: 'ws-123',
      idempotencyKey: 'idem-fail',
      channel: 'threads',
      expectedPayload: { text: '스레드 글' },
      reservedCredits: 150,
      maxAttempts: 2,
    });

    // Attempt 1: Not found yet
    const res1 = await queue.reconcileItem(item.id, async () => ({ isObjectFound: false }));
    expect(res1.outcome).toBe('STILL_PENDING');
    expect(res1.item.status).toBe('QUEUED');
    expect(res1.item.attempts).toBe(1);

    // Attempt 2: Still not found -> Reaches maxAttempts -> Fails and refunds
    const res2 = await queue.reconcileItem(item.id, async () => ({ isObjectFound: false }));
    expect(res2.outcome).toBe('REFUNDED_CREDITS');
    expect(res2.settledCredits).toBe(0);
    expect(res2.refundedCredits).toBe(150);
    expect(res2.item.status).toBe('RESOLVED_FAILED');
    expect(res2.item.errorReason).toContain('exhausted 2 attempts');
  });
});
