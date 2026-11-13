import { describe, expect, it, vi } from 'vitest';
import { projectInboundMessageToRecovery } from '../inbound-projector';

function setup(patches: { case?: Record<string, unknown>; evidence?: Record<string, unknown> | null } = {}) {
  const row = { id: 'case-1', workspace_id: 'workspace-1', source_thread_id: 'thread-1',
    customer_ref: 'customer-1', stage: 'AWAITING_CUSTOMER', version: 3, ...patches.case };
  const proposal = { workspace_id: 'workspace-1', case_id: row.id, payload_fingerprint: 'a'.repeat(64),
    slot_id: 'slot-1', service_name: '서비스', starts_at: '2026-10-22T10:00:00Z' };
  const evidence = patches.evidence === null ? null : { workspace_id: 'workspace-1', case_id: row.id,
    actor_id: 'owner-1', provider_message_id: 'provider-message-1', input_fingerprint: 'a'.repeat(64),
    occurred_at: '2026-10-21T10:00:00Z', evidence_ref: JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId: 'provider-message-1',
      payloadFingerprint: 'a'.repeat(64), senderId: 'business-1', recipientRef: 'customer-1',
      requestedAt: '2026-10-21T09:58:00Z', observedAt: '2026-10-21T10:00:00Z',
    }), ...patches.evidence };
  const outbox = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const client: any = { rpc, from: vi.fn((table: string) => {
    const query: any = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), upsert: outbox,
      maybeSingle: vi.fn().mockResolvedValue({ data: table === 'booking_recovery_cases' ? row
        : table === 'booking_recovery_proposals' ? proposal : evidence, error: null }) };
    return query;
  }) };
  const params = { workspaceId: 'workspace-1', threadId: 'thread-1', message: {
    id: 'message-2', sender_type: 'customer', sender_id: 'customer-1',
    text: '네 그 시간으로 예약해 주세요!', sent_at: '2026-10-21T10:01:00Z',
  } };
  return { client, params, rpc, outbox };
}

describe('verified send acceptance projection boundary', () => {
  it.each([{ workspace_id: 'other-workspace' }, { source_thread_id: 'other-thread' },
    { customer_ref: 'other-customer' }, { stage: 'PROVIDER_ACCEPTED' }])('케이스 범위/상태 불일치 거부: %j', async (patch) => {
    const { client, params, rpc, outbox } = setup({ case: patch });
    await projectInboundMessageToRecovery(client, params);
    expect(rpc).not.toHaveBeenCalled();
    expect(outbox).not.toHaveBeenCalled();
  });

  it.each([null, { evidence_ref: null }, { evidence_ref: '{}' }, { provider_message_id: null }, { input_fingerprint: 'b'.repeat(64) },
    { workspace_id: 'other-workspace' }, { occurred_at: 'invalid' }])('동일 원고의 독립 전송 증거 없으면 승격 금지: %j', async (evidence) => {
    const { client, params, rpc, outbox } = setup({ evidence });
    await projectInboundMessageToRecovery(client, params);
    expect(rpc).not.toHaveBeenCalled();
    expect(outbox).not.toHaveBeenCalled();
  });

  it('전송 검증 전에 도착한 발화는 고객 수락이 아니다', async () => {
    const { client, params, rpc } = setup();
    await projectInboundMessageToRecovery(client, { ...params, message: {
      ...params.message, sent_at: '2026-10-21T09:59:00Z',
    } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('동시 CAS 패배자는 수락 outbox를 추가하지 않는다', async () => {
    const { client, params, rpc, outbox } = setup();
    rpc.mockResolvedValue({ error: { code: '40001' } });
    await projectInboundMessageToRecovery(client, params);
    expect(outbox).not.toHaveBeenCalled();
  });

  it('outbox 쓰기 오류를 성공으로 숨기지 않는다', async () => {
    const { client, params, outbox } = setup();
    outbox.mockResolvedValue({ error: { message: 'db error' } });
    await expect(projectInboundMessageToRecovery(client, params)).rejects.toThrow('OUTBOX_WRITE_FAILED');
  });
});
