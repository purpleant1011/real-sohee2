import { describe, it, expect } from 'vitest';
import { AdminEvidenceCenterService } from '../evidence-center-service';

describe('ANI-818: Admin Evidence Center Operations Service', () => {
  it('registers mismatch, lists open items, and logs reconcile with operator audit and Linear reference', () => {
    const service = new AdminEvidenceCenterService();

    const item = service.registerMismatch({
      workspaceId: 'ws-gangnam',
      actionRunId: 'act-run-001',
      channel: 'instagram',
      mismatchKind: 'READBACK_PAYLOAD_MISMATCH',
      providerDeepLink: 'https://instagram.com/p/C99xyz',
      readbackPayloadHash: 'hash-actual-123',
      expectedHash: 'hash-expected-999',
      payloadDiffSummary: 'Caption emoji altered by meta api sanitizer',
    });

    expect(item.id).toBeDefined();
    expect(item.status).toBe('OPEN');

    const openItems = service.listItems('OPEN');
    expect(openItems).toHaveLength(1);

    // Operator intervenes to reconcile
    const log = service.executeReconcile(
      item.id,
      'admin_super_user',
      'Confirmed cosmetic emoji difference. Approved canonical parity.',
      'ANI-818-EVIDENCE-01'
    );

    expect(log.action).toBe('RECONCILE');
    expect(log.linearEvidenceRef).toBe('ANI-818-EVIDENCE-01');
    expect(service.listItems('OPEN')).toHaveLength(0);
    expect(service.listItems('RECONCILED')).toHaveLength(1);
  });

  it('handles rollback with audit trail when duplicate execution risk is detected', () => {
    const service = new AdminEvidenceCenterService();

    const item = service.registerMismatch({
      workspaceId: 'ws-gangnam',
      actionRunId: 'act-run-dup',
      channel: 'naver',
      mismatchKind: 'DUPLICATE_EXECUTION_RISK',
      providerDeepLink: 'https://smartplace.naver.com/manage/posts',
      payloadDiffSummary: 'Duplicate post attempted under timeout condition',
    });

    const log = service.executeRollback(
      item.id,
      'admin_ops',
      'Aborted duplicate run and refunded 200 credits',
      'ANI-818-ROLLBACK-02'
    );

    expect(log.action).toBe('ROLLBACK');
    expect(service.listItems('ROLLED_BACK')).toHaveLength(1);
  });
});
