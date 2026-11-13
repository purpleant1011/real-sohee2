import { describe, it, expect, vi } from 'vitest';
import { reconcileOutboxItem } from '../reconcile';
import { approvedReplyFingerprint } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';
import type { RecoveryOutboxItem } from '../repository';

function setup() {
  const reply: ApprovedReplyDto = { schemaVersion: 2, proposalId: 'proposal-1', revision: 1,
    workspaceId: 'workspace-1', caseId: 'case-1', recipientRef: 'customer-1', sourceMessageId: 'source-1',
    sourceMessageSequence: 1, replyText: '확인된 답변', catalogVersion: 'catalog-1', offer: null,
    facts: [{ factId: 'fact-1', workspaceId: 'workspace-1', version: '1', sourceRef: 'source',
      verifiedAt: '2026-10-16T10:00:00Z', validFrom: '2026-10-16T10:00:00Z', validUntil: null }],
    validUntil: '2026-10-16T10:15:00Z', fingerprint: '' };
  const sealed = { ...reply, fingerprint: approvedReplyFingerprint(reply) };
  const item: RecoveryOutboxItem = { id: 'outbox-1', workspace_id: reply.workspaceId,
    case_id: reply.caseId, source_event_key: `recovery:${reply.caseId}:send:${reply.sourceMessageId}:${sealed.fingerprint}`,
    kind: 'SEND_DM', state: 'UNKNOWN', attempt: 1,
    next_attempt_at: '2026-10-16T10:00:00Z', created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z' };
  const caseItem = { id: reply.caseId, workspace_id: reply.workspaceId, stage: 'RESULT_UNKNOWN', version: 4 };
  const repository: any = { getCase: vi.fn().mockResolvedValue(caseItem),
    transitionCase: vi.fn().mockImplementation(async (_actor, params) => ({
      ...caseItem, stage: params.nextStage, version: params.expectedVersion + 1,
    })) };
  const query: any = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  const client: any = { from: vi.fn().mockReturnValue(query) };
  const readback = { verified: true, providerMessageId: 'message-1', text: reply.replyText,
    recipientRef: reply.recipientRef, senderId: 'business-1', observedAt: '2026-10-16T10:20:00Z' };
  const deps = { repository, client, readbackFetcher: vi.fn().mockResolvedValue(readback),
    loadAttemptedSend: vi.fn().mockResolvedValue({ reply: sealed, providerMessageId: 'message-1',
      senderId: 'business-1', requestedAt: '2026-10-16T10:01:00Z',
      actor: { workspaceId: reply.workspaceId, userId: 'owner-1', role: 'owner' } }) };
  return { item, deps, query, readback, sealed };
}

describe('read-only send reconciliation', () => {
  it('원래 승인과 독립 증거가 맞으면 만료 후에도 정해진 상태 경로로 대사한다', async () => {
    const { item, deps, sealed } = setup();
    const result = await reconcileOutboxItem(item, deps);
    expect(result.status).toBe('RESOLVED_VERIFIED');
    expect(deps.repository.transitionCase.mock.calls.map((call: any) => call[1].nextStage))
      .toEqual(['NEEDS_RECONCILIATION', 'SEND_VERIFIED', 'AWAITING_CUSTOMER']);
    for (const call of deps.repository.transitionCase.mock.calls) {
      expect(call[1].fingerprint).toBe(sealed.fingerprint);
      if (call[1].nextStage !== 'SEND_VERIFIED') expect(call[1].stepKind).not.toBe('RECONCILE_VERIFIED');
      expect(call[1].fingerprint).not.toBe('0'.repeat(64));
      if (call[1].nextStage === 'SEND_VERIFIED') {
        expect(JSON.parse(call[1].evidenceRef)).toMatchObject({
          schemaVersion: 1, providerMessageId: 'message-1', payloadFingerprint: sealed.fingerprint,
          recipientRef: 'customer-1', senderId: 'business-1',
        });
      }
    }
  });

  it.each([{ providerMessageId: undefined }, { providerMessageId: 'other-message' },
    { text: '다른 원고' }, { recipientRef: 'other-customer' }, { senderId: 'other-business' },
    { observedAt: '' }])('verified boolean만으로는 확정 금지: %j', async (patch) => {
    const { item, deps, readback } = setup();
    deps.readbackFetcher.mockResolvedValue({ ...readback, ...patch });
    expect((await reconcileOutboxItem(item, deps)).status).toBe('RETRY_SCHEDULED');
    expect(deps.repository.transitionCase).not.toHaveBeenCalled();
  });

  it('원본 전송 스냅샷이 없으면 검증됨 승격 금지', async () => {
    const { item, deps } = setup();
    deps.loadAttemptedSend.mockResolvedValue(null);
    expect((await reconcileOutboxItem(item, deps)).status).toBe('RETRY_SCHEDULED');
    expect(deps.readbackFetcher).not.toHaveBeenCalled();
  });

  it('다른 사업장 case는 readback 전 거부', async () => {
    const { item, deps } = setup();
    deps.repository.getCase.mockResolvedValue({ id: item.case_id, workspace_id: 'other-workspace', stage: 'RESULT_UNKNOWN' });
    await expect(reconcileOutboxItem(item, deps)).rejects.toThrow();
    expect(deps.readbackFetcher).not.toHaveBeenCalled();
  });

  it('원장 갱신 실패는 RESOLVED_VERIFIED로 은폐하지 않는다', async () => {
    const { item, deps, query } = setup();
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: 'db failed' } }).then(resolve);
    await expect(reconcileOutboxItem(item, deps)).rejects.toThrow();
  });

  it('재조회 예산 소진은 사람 확인으로 이관하며 발송 함수 자체가 없다', async () => {
    const { item, deps } = setup();
    deps.readbackFetcher.mockRejectedValue(new Error('timeout'));
    expect((await reconcileOutboxItem({ ...item, attempt: 2 }, deps)).status).toBe('MOVED_TO_HUMAN_REVIEW');
    expect(deps.repository.transitionCase).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nextStage: 'HUMAN_REVIEW' }));
    expect(Object.keys(deps)).not.toContain('sendProviderDm');
  });
});
