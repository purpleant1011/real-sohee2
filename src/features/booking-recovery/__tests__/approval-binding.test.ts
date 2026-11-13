import { describe, it, expect } from 'vitest';
import {
  approvalFingerprint,
  verifyApprovalFingerprint,
  bookingApprovalFingerprint,
  verifyBookingApprovalFingerprint,
} from '../approval-binding';

describe('Booking Recovery Approval Binding (Task 2)', () => {
  const baseSend = {
    workspaceId: 'ws-a',
    caseId: 'case-b',
    recipientRef: 'user-c',
    sourceInboundMessageId: 'm1',
    replyText: '목요일 16시 어떠세요?',
    catalogVersion: 'v1',
    slotVersion: 1,
  };

  it('원본 고객 메시지가 바뀌면 같은 답변도 재승인한다 (지문 불일치)', () => {
    const fp1 = approvalFingerprint(baseSend);
    const fp2 = approvalFingerprint({
      ...baseSend,
      sourceInboundMessageId: 'm2',
    });
    expect(fp1).not.toBe(fp2);
    expect(fp1).toHaveLength(64);
    expect(fp2).toHaveLength(64);
  });

  it('슬롯 버전이나 카탈로그 버전이 바뀌면 지문이 변경된다', () => {
    const fpBase = approvalFingerprint(baseSend);
    const fpSlotChanged = approvalFingerprint({ ...baseSend, slotVersion: 2 });
    const fpCatalogChanged = approvalFingerprint({ ...baseSend, catalogVersion: 'v2' });

    expect(fpBase).not.toBe(fpSlotChanged);
    expect(fpBase).not.toBe(fpCatalogChanged);
  });

  it('수신자나 워크스페이스가 다르면 지문이 변경된다', () => {
    const fpBase = approvalFingerprint(baseSend);
    const fpRecipientChanged = approvalFingerprint({ ...baseSend, recipientRef: 'user-other' });
    const fpWorkspaceChanged = approvalFingerprint({ ...baseSend, workspaceId: 'ws-b' });

    expect(fpBase).not.toBe(fpRecipientChanged);
    expect(fpBase).not.toBe(fpWorkspaceChanged);
  });

  it('객체의 키 순서가 바뀌어도 canonical tuple 기준이므로 동일한 지문을 유지한다', () => {
    const fp1 = approvalFingerprint({
      workspaceId: 'ws-a',
      caseId: 'case-b',
      recipientRef: 'user-c',
      sourceInboundMessageId: 'm1',
      replyText: '목요일 16시 어떠세요?',
      catalogVersion: 'v1',
      slotVersion: 1,
    });

    const fp2 = approvalFingerprint({
      slotVersion: 1,
      catalogVersion: 'v1',
      replyText: '목요일 16시 어떠세요?',
      sourceInboundMessageId: 'm1',
      recipientRef: 'user-c',
      caseId: 'case-b',
      workspaceId: 'ws-a',
    });

    expect(fp1).toBe(fp2);
  });

  it('동일한 입력에 대해 타임스탬프/난수 없이 항상 결정론적인 SHA-256 hex를 반환한다', () => {
    const fp1 = approvalFingerprint(baseSend);
    const fp2 = approvalFingerprint(baseSend);
    expect(fp1).toBe(fp2);
    expect(/^[a-f0-9]{64}$/.test(fp1)).toBe(true);
  });

  describe('bookingApprovalFingerprint', () => {
    const baseBooking = {
      workspaceId: 'ws-a',
      caseId: 'case-b',
      slotId: 'slot-1',
      serviceId: 'srv-1',
      totalAmountKrw: 80000,
      depositKrw: 20000,
      customerRef: 'cust-1',
      acceptedMessageId: 'm-accept-1',
      proposalRevision: 1,
      catalogVersion: 'cat-v1',
      slotVersion: 3,
    };

    it('예약 세부사항(금액, 슬롯, 서비스)이 결속된 SHA-256 지문을 생성한다', () => {
      const fp = bookingApprovalFingerprint(baseBooking);
      expect(fp).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(fp)).toBe(true);

      const fpPriceChanged = bookingApprovalFingerprint({ ...baseBooking, totalAmountKrw: 90000 });
      expect(fp).not.toBe(fpPriceChanged);

      const fpSlotChanged = bookingApprovalFingerprint({ ...baseBooking, slotId: 'slot-2' });
      expect(fp).not.toBe(fpSlotChanged);
    });
  });

  describe('Constant-Time Fingerprint Verification & Unicode Defense', () => {
    it('올바른 지문은 true, 불일치 지문은 false를 반환한다', () => {
      const fp = approvalFingerprint(baseSend);
      expect(verifyApprovalFingerprint(baseSend, fp)).toBe(true);
      expect(verifyApprovalFingerprint(baseSend, '0'.repeat(64))).toBe(false);
    });

    it('멀티바이트 유니코드 64글자 입력 시 timingSafeEqual이 throw하지 않고 안전하게 false를 반환한다', () => {
      const unicode64 = '가'.repeat(64); // 64 chars, but 192 UTF-8 bytes
      expect(unicode64.length).toBe(64);

      expect(() => verifyApprovalFingerprint(baseSend, unicode64)).not.toThrow();
      expect(verifyApprovalFingerprint(baseSend, unicode64)).toBe(false);

      const bookingBase = {
        workspaceId: 'ws-a',
        caseId: 'case-b',
        slotId: 'slot-1',
        serviceId: 'srv-1',
        totalAmountKrw: 80000,
        depositKrw: 20000,
        customerRef: 'cust-1',
        acceptedMessageId: 'm-accept-1',
        proposalRevision: 1,
        catalogVersion: 'cat-v1',
        slotVersion: 3,
      };
      expect(() => verifyBookingApprovalFingerprint(bookingBase, unicode64)).not.toThrow();
      expect(verifyBookingApprovalFingerprint(bookingBase, unicode64)).toBe(false);
    });

    it('길이가 64자가 아니거나 비-hex 문자열은 false를 반환한다', () => {
      expect(verifyApprovalFingerprint(baseSend, '')).toBe(false);
      expect(verifyApprovalFingerprint(baseSend, 'abc')).toBe(false);
      expect(verifyApprovalFingerprint(baseSend, 'z'.repeat(64))).toBe(false);
    });
  });
});
