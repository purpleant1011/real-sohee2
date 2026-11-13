import { describe, it, expect } from 'vitest';
import { FakeChannelProvider } from './fake-provider';

describe('FakeChannelProvider Helper Unit Test (Isolated from production recovery)', () => {
  const wsId = '11111111-1111-4111-8111-111111111111';
  const caseId = '33333333-3333-4333-8333-333333333333';
  const sourceKey = `recovery:${caseId}:send:msg_001:fp_001`;

  it('negative test: rejects reconcile readback when provider store only has a record for another recipient', async () => {
    const provider = new FakeChannelProvider('OK');
    await provider.sendDm({
      pageId: 'page_123',
      recipientId: 'other_customer_999',
      accessToken: 'fixture_token',
      text: '다른 고객 대상 메시지',
    });

    const result = await provider.reconcileReadback({
      workspaceId: wsId,
      caseId,
      sourceEventKey: sourceKey,
      expectedRecipientId: 'cust_drill_123',
      expectedText: '테스트 복구 제안 답변입니다.',
      expectedSenderId: 'page_123',
    });

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Provider records do not match');
  });

  it('negative test: rejects reconcile readback when text does not match', async () => {
    const provider = new FakeChannelProvider('OK');
    await provider.sendDm({
      pageId: 'page_123',
      recipientId: 'cust_drill_123',
      accessToken: 'fixture_token',
      text: '원본 메시지 문안',
    });

    const result = await provider.reconcileReadback({
      workspaceId: wsId,
      caseId,
      sourceEventKey: sourceKey,
      expectedRecipientId: 'cust_drill_123',
      expectedText: '다른 문안 요청',
      expectedSenderId: 'page_123',
    });

    expect(result.verified).toBe(false);
  });

  it('negative test: rejects reconcile readback when mandatory parameters are missing', async () => {
    const provider = new FakeChannelProvider('OK');
    await provider.sendDm({
      pageId: 'page_123',
      recipientId: 'cust_drill_123',
      accessToken: 'fixture_token',
      text: '테스트 문안',
    });

    const result = await provider.reconcileReadback({
      workspaceId: wsId,
      caseId,
      sourceEventKey: sourceKey,
      expectedRecipientId: '',
      expectedText: '테스트 문안',
      expectedSenderId: 'page_123',
    });

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('missing mandatory expected recipient');
  });

  it('negative test: rejects reconcile readback when sourceEventKey does not match case', async () => {
    const provider = new FakeChannelProvider('OK');
    await provider.sendDm({
      pageId: 'page_123',
      recipientId: 'cust_drill_123',
      accessToken: 'fixture_token',
      text: '테스트 문안',
    });

    const result = await provider.reconcileReadback({
      workspaceId: wsId,
      caseId,
      sourceEventKey: 'recovery:other_case_999:send:msg:fp',
      expectedRecipientId: 'cust_drill_123',
      expectedText: '테스트 문안',
      expectedSenderId: 'page_123',
    });

    expect(result.verified).toBe(false);
    expect(result.reason).toContain('Source event key does not match target case');
  });

  it('positive control: successfully verifies and matches when all fields match recorded message', async () => {
    const provider = new FakeChannelProvider('OK');
    const sendRes = await provider.sendDm({
      pageId: 'page_123',
      recipientId: 'cust_drill_123',
      accessToken: 'fixture_token',
      text: '정상 전송 문안',
    });

    const result = await provider.reconcileReadback({
      workspaceId: wsId,
      caseId,
      sourceEventKey: sourceKey,
      expectedRecipientId: 'cust_drill_123',
      expectedText: '정상 전송 문안',
      expectedSenderId: 'page_123',
      expectedProviderMessageId: sendRes.providerMessageId,
    });

    expect(result.verified).toBe(true);
    expect(result.providerMessageId).toBe(sendRes.providerMessageId);
    expect(result.recipientRef).toBe('cust_drill_123');
    expect(result.text).toBe('정상 전송 문안');
    expect(result.senderId).toBe('page_123');
  });
});
