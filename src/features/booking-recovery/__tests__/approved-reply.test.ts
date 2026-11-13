import { describe, expect, it } from 'vitest';
import { approvedReplyFingerprint, validateApprovedReply } from '../approval-binding';
import type { ApprovedReplyDto } from '../approved-reply';

const now = new Date('2026-10-21T10:00:00Z');
export function approvedReplyFixture(): ApprovedReplyDto {
  const reply: ApprovedReplyDto = {
    schemaVersion: 2, proposalId: 'proposal-1', revision: 1,
    workspaceId: 'workspace-1', caseId: 'case-1', recipientRef: 'recipient-1',
    sourceMessageId: 'message-1', sourceMessageSequence: 1,
    replyText: '서비스 가격은 40,000원입니다.', catalogVersion: 'catalog-1',
    facts: [{ factId: 'fact-1', workspaceId: 'workspace-1', version: '1', sourceRef: 'source-1',
      verifiedAt: '2026-10-20T10:00:00Z', validFrom: '2026-10-20T10:00:00Z', validUntil: null }],
    offer: { serviceId: 'service-1', serviceName: '서비스', totalAmountKrw: 40000,
      depositKrw: 0, slotId: 'slot-1', slotVersion: 1,
      startsAt: '2026-10-22T10:00:00Z', endsAt: '2026-10-22T11:00:00Z', timezone: 'Asia/Seoul' },
    validUntil: '2026-10-21T10:15:00Z', fingerprint: '',
  };
  return { ...reply, fingerprint: approvedReplyFingerprint(reply) };
}

describe('v2 exact approved reply', () => {
  it.each([
    ['source id', { sourceMessageId: 'message-2' }],
    ['source sequence', { sourceMessageSequence: 2 }],
    ['recipient', { recipientRef: 'recipient-2' }],
    ['workspace', { workspaceId: 'workspace-2' }],
    ['proposal', { proposalId: 'proposal-2' }],
    ['revision', { revision: 2 }],
    ['catalog', { catalogVersion: 'catalog-2' }],
    ['text', { replyText: '다른 원고' }],
  ])('%s 변경은 과거 승인으로 발송 불가', (_label, patch) => {
    const reply = approvedReplyFixture();
    expect(validateApprovedReply({ ...reply, ...patch }, reply.fingerprint, now)).toBe(false);
  });

  it.each([
    { totalAmountKrw: 50000 }, { depositKrw: 10000 }, { slotVersion: 2 },
    { slotId: 'slot-2' }, { startsAt: '2026-10-22T12:00:00Z' },
  ])('가격·슬롯 변경은 과거 승인으로 발송 불가: %j', (patch) => {
    const reply = approvedReplyFixture();
    expect(validateApprovedReply({ ...reply, offer: { ...reply.offer!, ...patch } }, reply.fingerprint, now)).toBe(false);
  });

  it('동일 원고와 유효 Fact만 승인 검증 통과', () => {
    const reply = approvedReplyFixture();
    expect(validateApprovedReply(reply, reply.fingerprint, now)).toBe(true);
  });

  it.each([
    { workspaceId: 'workspace-2' }, { version: '2' }, { validUntil: '2026-10-21T09:59:00Z' },
    { validFrom: '2026-10-22T10:00:00Z' }, { verifiedAt: '' },
  ])('다른 사업장·변경·만료·미확인 Fact 거부: %j', (patch) => {
    const reply = approvedReplyFixture();
    const changed = { ...reply, facts: [{ ...reply.facts[0], ...patch }] };
    expect(validateApprovedReply(changed, reply.fingerprint, now)).toBe(false);
  });

  it('자기 지문이 일치해도 만료되거나 확인 Fact가 없으면 거부', () => {
    const reply = approvedReplyFixture();
    const noFacts = { ...reply, facts: [] };
    expect(validateApprovedReply(noFacts, approvedReplyFingerprint(noFacts), now)).toBe(false);
    expect(validateApprovedReply(reply, reply.fingerprint, new Date(reply.validUntil))).toBe(false);
  });

  it('공식 전송 한도 UTF-8 1000바이트 초과는 잘라 보내지 않고 거부', () => {
    const reply = { ...approvedReplyFixture(), replyText: '가'.repeat(334) };
    const sealed = { ...reply, fingerprint: approvedReplyFingerprint(reply) };
    expect(validateApprovedReply(sealed, sealed.fingerprint, now)).toBe(false);
  });

  it('Fact 정렬만 다른 동일 집합은 동일 지문', () => {
    const reply = approvedReplyFixture();
    const other = { ...reply.facts[0], factId: 'fact-2' };
    expect(approvedReplyFingerprint({ ...reply, facts: [other, reply.facts[0]] }))
      .toBe(approvedReplyFingerprint({ ...reply, facts: [reply.facts[0], other] }));
  });
});
