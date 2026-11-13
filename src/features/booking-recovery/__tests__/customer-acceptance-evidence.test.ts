import { describe, expect, it, vi } from 'vitest';
import { loadCustomerAcceptanceEvidence, verifyCustomerAcceptanceEvidence } from '../customer-acceptance-evidence';

const now = '2026-10-21T10:10:00.000Z';
const fingerprint = 'a'.repeat(64);
const proof = {
  schemaVersion: 1, channel: 'instagram', providerMessageId: 'provider-sent',
  payloadFingerprint: fingerprint, senderId: 'business-account', recipientRef: 'customer-1',
  requestedAt: '2026-10-21T10:00:00.000Z', observedAt: '2026-10-21T10:01:00.000Z',
};
const input = {
  workspaceId: 'workspace-1', caseId: 'case-1', fingerprint,
  customerRef: 'customer-1', senderId: 'business-account', latestCustomerMessageId: 'acceptance-1',
  message: { id: 'acceptance-1', senderId: 'customer-1', senderType: 'customer', sentAt: '2026-10-21T10:02:00.000Z' },
  step: {
    workspace_id: 'workspace-1', case_id: 'case-1', kind: 'SEND_DM_VERIFIED', status: 'COMPLETED',
    input_fingerprint: fingerprint, provider_message_id: 'provider-sent', actor_id: 'owner-1',
    occurred_at: '2026-10-21T10:01:01.000Z', evidence_ref: JSON.stringify(proof),
  }, now,
};

describe('ANI-1608 independent delivery evidence boundary', () => {
  it.each(['instagram_dm_threads', 'channel_connections', 'booking_recovery_steps', 'instagram_dm_messages'])(
    '현재 근거 조회 %s의 실패와 빈 결과는 모두 fail-closed', async (failedTable) => {
      for (const error of [null, { message: 'query failed' }]) {
        const rows: Record<string, unknown> = {
          instagram_dm_threads: { channel_connection_id: 'channel-1' },
          channel_connections: { external_account_id: input.senderId },
          booking_recovery_steps: input.step,
          instagram_dm_messages: { id: input.message.id },
        };
        const filters: ReturnType<typeof vi.fn>[] = [];
        const client = { from: vi.fn((table: string) => {
          const eq = vi.fn().mockReturnThis();
          filters.push(eq);
          return {
            select: vi.fn().mockReturnThis(), eq, in: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: table === failedTable ? null : rows[table], error: table === failedTable ? error : null }),
          };
        }) };
        expect(await loadCustomerAcceptanceEvidence(client as any, { ...input, threadId: 'thread-1' }))
          .toMatchObject({ ok: false, code: error ? 'INTERNAL_ERROR' : 'CONTEXT_REQUIRED' });
        for (const eq of filters) expect(eq).toHaveBeenCalledWith('workspace_id', input.workspaceId);
      }
    });
  it.each(['SEND_DM_VERIFIED', 'RECONCILE_VERIFIED'])('동일 원고·provider·고객의 %s 영수증 이후 발화만 허용한다', kind => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, step: { ...input.step, kind } }))
      .toEqual({ ok: true, value: { observedAt: proof.observedAt } });
  });

  it.each([null, '', 'legacy-ref', '{}', '{malformed'])('JSON 영수증 없는 기존 verified 행은 거부한다 (%j)', evidence_ref => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, step: { ...input.step, evidence_ref } }).ok).toBe(false);
  });

  it.each([
    { payloadFingerprint: 'b'.repeat(64) }, { providerMessageId: 'other-provider-message' },
    { recipientRef: 'other-customer' }, { senderId: 'other-business' }, { channel: 'threads' },
    { schemaVersion: 2 }, { requestedAt: '2026-10-21T10:03:00.000Z' },
    { observedAt: '2026-10-21T10:11:00.000Z' },
  ])('영수증의 대상·버전·시각 불일치를 거부한다 (%j)', mismatch => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, step: {
      ...input.step, evidence_ref: JSON.stringify({ ...proof, ...mismatch }),
    } }).ok).toBe(false);
  });

  it.each([
    { workspace_id: 'workspace-2' }, { case_id: 'case-2' }, { kind: 'PROVIDER_ACCEPTED' },
    { status: 'CLAIMED' }, { input_fingerprint: 'b'.repeat(64) }, { provider_message_id: 'other' },
    { actor_id: '' }, { occurred_at: 'invalid' }, { occurred_at: '2026-10-21T10:11:00.000Z' },
    { occurred_at: '2026-10-21T09:59:00.000Z' },
  ])('원장 행의 테넌트·업무·완료·증거 불일치를 거부한다 (%j)', mismatch => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, step: { ...input.step, ...mismatch } }).ok).toBe(false);
  });

  it.each([
    { senderId: 'other-customer' }, { senderType: 'business' },
    { sentAt: proof.observedAt }, { sentAt: '2026-10-21T09:59:00.000Z' },
    { sentAt: '2026-10-21T10:11:00.000Z' }, { sentAt: 'invalid' },
  ])('관측 이전·미래·다른 고객 발화는 거부한다 (%j)', mismatch => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, message: { ...input.message, ...mismatch } }).ok).toBe(false);
  });

  it('수락 이후 고객 새 발화가 있거나 조회 결과가 없으면 과거 수락을 재사용하지 않는다', () => {
    for (const latestCustomerMessageId of ['later-customer-message', null]) {
      expect(verifyCustomerAcceptanceEvidence({ ...input, latestCustomerMessageId }).ok).toBe(false);
    }
  });

  it('사업장 송신 계정과 기준 시각이 없거나 잘못되면 거부한다', () => {
    expect(verifyCustomerAcceptanceEvidence({ ...input, senderId: '' }).ok).toBe(false);
    expect(verifyCustomerAcceptanceEvidence({ ...input, now: 'invalid' }).ok).toBe(false);
  });
});
