import { describe, expect, it, vi } from 'vitest';
import { createDmReconcileDependencies } from '../dm-reconcile-dependencies';
import { approvedReplyFingerprint } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredential: vi.fn().mockResolvedValue({ accessToken: 'fixture-token', externalAccountId: 'business-1' }),
}));
vi.mock('@/lib/providers/meta-api', () => ({ getInstagramDirectMessageReadback: vi.fn().mockResolvedValue({
  isLive: true, messageId: 'provider-1', text: '승인 원고', senderId: 'business-1', recipientId: 'customer-1',
  observedAt: '2026-10-21T10:10:00Z', timestamp: '2026-10-21T10:01:00Z',
}) }));

function setup() {
  const reply: ApprovedReplyDto = { schemaVersion: 2, workspaceId: 'workspace-1', caseId: 'case-1',
    proposalId: 'proposal-1', revision: 1, recipientRef: 'customer-1', sourceMessageId: 'source-1',
    sourceMessageSequence: 1, replyText: '승인 원고', catalogVersion: 'catalog-1', offer: null,
    facts: [{ factId: 'fact-1', workspaceId: 'workspace-1', version: '1', sourceRef: 'source',
      verifiedAt: '2026-10-20T10:00:00Z', validFrom: '2026-10-20T10:00:00Z', validUntil: null }],
    validUntil: '2026-10-21T10:15:00Z', fingerprint: '' };
  const sealed = { ...reply, fingerprint: approvedReplyFingerprint(reply) };
  const key = `recovery:${reply.caseId}:send:${reply.sourceMessageId}:${sealed.fingerprint}`;
  const item: any = { workspace_id: reply.workspaceId, case_id: reply.caseId, source_event_key: key, kind: 'SEND_DM' };
  const rows: Record<string, any[]> = {
    booking_recovery_cases: [{ id: reply.caseId, workspace_id: reply.workspaceId, source_thread_id: 'thread-1', customer_ref: reply.recipientRef }],
    booking_recovery_steps: [
      { workspace_id: reply.workspaceId, case_id: reply.caseId, kind: 'SEND_DM', idempotency_key: key,
        input_fingerprint: sealed.fingerprint, actor_id: 'owner-1', provider_message_id: 'provider-1' },
      { workspace_id: reply.workspaceId, case_id: reply.caseId, kind: 'SEND_DM_REQUESTED', idempotency_key: `${key}:started`,
        input_fingerprint: sealed.fingerprint, actor_id: 'owner-1', occurred_at: '2026-10-21T10:01:00Z' },
    ],
    booking_recovery_proposals: [{ id: reply.proposalId, workspace_id: reply.workspaceId, case_id: reply.caseId,
      revision: 1, payload_fingerprint: sealed.fingerprint, approved_reply_snapshot: sealed }],
    booking_recovery_approvals: [{ workspace_id: reply.workspaceId, case_id: reply.caseId, step_kind: 'SEND',
      payload_fingerprint: sealed.fingerprint, approved_by: 'owner-1', source_message_id: reply.sourceMessageId,
      approved_at: '2026-10-21T10:00:30Z', expires_at: reply.validUntil }],
    workspace_members: [{ workspace_id: reply.workspaceId, user_id: 'owner-1', role: 'owner', status: 'active' }],
    instagram_dm_threads: [{ id: 'thread-1', workspace_id: reply.workspaceId, channel_connection_id: 'connection-1' }],
  };
  const client: any = { from: vi.fn((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const query: any = { select: vi.fn().mockReturnThis(), eq: vi.fn((key, value) => { filters.push([key, value]); return query; }),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: (rows[table] || []).find(row => filters.every(([key, value]) => row[key] === value)) || null, error: null })) };
    return query;
  }) };
  const repository: any = { getCase: vi.fn().mockResolvedValue(rows.booking_recovery_cases[0]) };
  return { item, rows, client, repository, sealed };
}

describe('original DM operation reconciliation loader', () => {
  it('동일 operation의 원본 snapshot/승인자/시작 시각만 로드', async () => {
    const { client, repository, item, sealed } = setup();
    const deps = createDmReconcileDependencies(repository, client);
    expect(await deps.loadAttemptedSend!(item)).toMatchObject({ reply: sealed, providerMessageId: 'provider-1',
      requestedAt: '2026-10-21T10:01:00Z', senderId: 'business-1', actor: { userId: 'owner-1', role: 'owner' } });
  });

  it.each(['snapshot', 'step', 'approval', 'membership'])('원본 %s 미연결은 legacy fallback 없이 UNKNOWN', async (missing) => {
    const { client, repository, item, rows } = setup();
    if (missing === 'snapshot') delete rows.booking_recovery_proposals[0].approved_reply_snapshot;
    if (missing === 'step') rows.booking_recovery_steps[0].idempotency_key = 'different-operation';
    if (missing === 'approval') rows.booking_recovery_approvals = [];
    if (missing === 'membership') rows.workspace_members = [];
    expect(await createDmReconcileDependencies(repository, client).loadAttemptedSend!(item)).toBeNull();
  });

  it('case의 최신 다른 provider ID가 아니라 원래 step의 ID를 조회', async () => {
    const { client, repository, item } = setup();
    const deps = createDmReconcileDependencies(repository, client);
    const attemptedSend = await deps.loadAttemptedSend!(item);
    const result = await deps.readbackFetcher({ workspaceId: item.workspace_id, caseId: item.case_id,
      sourceEventKey: item.source_event_key, attemptedSend: attemptedSend! });
    const { getInstagramDirectMessageReadback } = await import('@/lib/providers/meta-api');
    expect(getInstagramDirectMessageReadback).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'provider-1' }));
    expect(result).toMatchObject({ verified: true, providerMessageId: 'provider-1', recipientRef: 'customer-1', text: '승인 원고' });
  });
});
