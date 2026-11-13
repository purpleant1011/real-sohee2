import { describe, it, expect } from 'vitest';
import {
  recoveryCommandSchema,
  recoveryActorSchema,
  recoveryCaseIdSchema,
  bookingIdSchema,
  recoveryViewSchema,
  type RecoveryCommand,
} from '../contracts';

describe('Booking Recovery Contracts & Strict Schemas (Task 2)', () => {
  it('클라이언트가 body에 승인자 ID(actorId)나 역할을 임의 주입할 수 없다 (strict 거부)', () => {
    const invalidPayload = {
      kind: 'approve_send',
      expectedVersion: 1,
      fingerprint: 'a'.repeat(64),
      actorId: 'another-owner', // Forbidden injection
    };
    const parsed = recoveryCommandSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
  });

  it('클라이언트가 body에 workspaceId나 userId를 주입할 수 없다', () => {
    const invalidPayload = {
      kind: 'prepare_reply',
      expectedVersion: 1,
      workspaceId: 'ws-fake',
      userId: 'user-fake',
    };
    const parsed = recoveryCommandSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
  });

  it('expectedVersion은 양의 정수(1 이상)여야 하며 0, 음수, 소수는 거부된다', () => {
    for (const invalidVer of [0, -1, 1.5, NaN, '1']) {
      const parsed = recoveryCommandSchema.safeParse({
        kind: 'prepare_reply',
        expectedVersion: invalidVer,
      });
      expect(parsed.success).toBe(false);
    }

    const valid = recoveryCommandSchema.safeParse({
      kind: 'prepare_reply',
      expectedVersion: 1,
    });
    expect(valid.success).toBe(true);
  });

  it('fingerprint는 64자리 sha256 hex 문자열이어야 한다', () => {
    const valid = recoveryCommandSchema.safeParse({
      kind: 'approve_send',
      expectedVersion: 2,
      fingerprint: 'abcdef0123456789'.repeat(4),
    });
    expect(valid.success).toBe(true);

    const invalidShort = recoveryCommandSchema.safeParse({
      kind: 'approve_send',
      expectedVersion: 2,
      fingerprint: 'abc',
    });
    expect(invalidShort.success).toBe(false);

    const invalidNonHex = recoveryCommandSchema.safeParse({
      kind: 'approve_send',
      expectedVersion: 2,
      fingerprint: 'z'.repeat(64),
    });
    expect(invalidNonHex.success).toBe(false);
  });

  it('DB caseId는 UUID여야 하고, bookingId는 bk_ 접두사를 유지해야 한다', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    expect(recoveryCaseIdSchema.safeParse(validUuid).success).toBe(true);
    expect(recoveryCaseIdSchema.safeParse('not-a-uuid').success).toBe(false);

    const validBk = 'bk_123e4567-e89b-12d3-a456-426614174000';
    expect(bookingIdSchema.safeParse(validBk).success).toBe(true);
    expect(bookingIdSchema.safeParse('res_123').success).toBe(false);
  });

  it('서버 RecoveryActor는 workspaceId(UUID), userId(UUID), role(owner | manager)만 허용한다', () => {
    const validUuid1 = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '223e4567-e89b-12d3-a456-426614174001';

    const validOwner = recoveryActorSchema.safeParse({
      workspaceId: validUuid1,
      userId: validUuid2,
      role: 'owner',
    });
    expect(validOwner.success).toBe(true);

    const nonUuidWorkspace = recoveryActorSchema.safeParse({
      workspaceId: 'ws-non-uuid',
      userId: validUuid2,
      role: 'owner',
    });
    expect(nonUuidWorkspace.success).toBe(false);

    const invalidRole = recoveryActorSchema.safeParse({
      workspaceId: validUuid1,
      userId: validUuid2,
      role: 'viewer',
    });
    expect(invalidRole.success).toBe(false);
  });

  it('confirm_acceptance 명령은 inboundMessageId와 slotId가 DB UUID여야 한다', () => {
    const validUuid1 = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '223e4567-e89b-12d3-a456-426614174001';

    const valid = recoveryCommandSchema.safeParse({
      kind: 'confirm_acceptance',
      expectedVersion: 1,
      inboundMessageId: validUuid1,
      slotId: validUuid2,
    });
    expect(valid.success).toBe(true);

    const nonUuid = recoveryCommandSchema.safeParse({
      kind: 'confirm_acceptance',
      expectedVersion: 1,
      inboundMessageId: 'msg-not-uuid',
      slotId: validUuid2,
    });
    expect(nonUuid.success).toBe(false);
  });

  it('RecoveryView 스키마는 UUID 식별자들과 revenue NOT_OBSERVED 및 null이어야 한다', () => {
    const validUuid1 = '123e4567-e89b-12d3-a456-426614174000';
    const validUuid2 = '223e4567-e89b-12d3-a456-426614174001';
    const validUuid3 = '323e4567-e89b-12d3-a456-426614174002';
    const validUuid4 = '423e4567-e89b-12d3-a456-426614174003';

    const validView = {
      caseId: validUuid1,
      missionId: validUuid2,
      version: 1,
      stage: 'DISCOVERED' as const,
      statusLabel: '문의 감지',
      sourceThreadId: validUuid3,
      sourceInboundMessageId: validUuid4,
      observedAt: '2026-10-16T00:00:00Z',
      reply: null,
      booking: null,
      nextAction: 'prepare_reply' as const,
      revenue: { status: 'NOT_OBSERVED' as const, amountKrw: null },
    };

    const parsed = recoveryViewSchema.safeParse(validView);
    expect(parsed.success).toBe(true);

    // revenue에 임의 매출을 넣으려고 하면 실패
    const invalidRevenue = {
      ...validView,
      revenue: { status: 'OBSERVED', amountKrw: 50000 },
    };
    expect(recoveryViewSchema.safeParse(invalidRevenue).success).toBe(false);
  });
});
