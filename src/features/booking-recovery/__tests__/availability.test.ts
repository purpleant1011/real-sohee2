import { describe, it, expect, vi } from 'vitest';
import {
  verifyOffer,
  type CatalogService,
  type OwnerConfirmedSlot,
} from '../availability';

describe('Booking Recovery Availability & Offer Verification (Task 4)', () => {
  const now = '2026-10-16T10:00:00.000Z';

  const validService: CatalogService = {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    name: '시그니처 커트',
    price: 35000,
    active: true,
    updatedAt: '2026-10-15T00:00:00.000Z',
    durationMinutes: 60,
  };

  const validSlot: OwnerConfirmedSlot = {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    serviceId: '11111111-1111-4111-8111-111111111111',
    depositKrw: 10000,
    catalogVersion: '2026-10-15T00:00:00.000Z',
    startsAt: '2026-10-16T14:00:00.000Z',
    endsAt: '2026-10-16T15:00:00.000Z',
    timezone: 'Asia/Seoul',
    confirmedBy: '44444444-4444-4444-8444-444444444444',
    confirmedAt: '2026-10-16T09:50:00.000Z',
    validUntil: '2026-10-16T10:15:00.000Z', // 15 min TTL
    version: 1,
    status: 'AVAILABLE',
  };

  it('서비스 소요시간(durationMinutes)이 없거나 유효하지 않으면 사장님 확인을 요청한다', () => {
    // durationMinutes null
    const resNull = verifyOffer({
      service: { ...validService, durationMinutes: null },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(resNull.ok).toBe(false);
    if (resNull.ok) throw new Error('Expected failure');
    expect(resNull.code).toBe('CONTEXT_REQUIRED');
    expect(resNull.message).toContain('소요시간');

    // durationMinutes undefined
    const resUndefined = verifyOffer({
      service: { ...validService, durationMinutes: undefined },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(resUndefined.ok).toBe(false);
    if (resUndefined.ok) throw new Error('Expected failure');
    expect(resUndefined.code).toBe('CONTEXT_REQUIRED');

    // durationMinutes 0 이하
    const resZero = verifyOffer({
      service: { ...validService, durationMinutes: 0 },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(resZero.ok).toBe(false);
    if (resZero.ok) throw new Error('Expected failure');
    expect(resZero.code).toBe('CONTEXT_REQUIRED');

    const resNegative = verifyOffer({
      service: { ...validService, durationMinutes: -30 },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(resNegative.ok).toBe(false);
    if (resNegative.ok) throw new Error('Expected failure');
    expect(resNegative.code).toBe('CONTEXT_REQUIRED');
  });

  it('슬롯 시간 구간이 서비스 소요시간보다 짧으면 차단한다', () => {
    // 60분 슬롯에 90분 서비스
    const resShort = verifyOffer({
      service: { ...validService, durationMinutes: 90 },
      slot: validSlot, // 14:00~15:00 (60분)
      depositKrw: 0,
      now,
    });
    expect(resShort.ok).toBe(false);
    if (resShort.ok) throw new Error('Expected failure');
    expect(resShort.code).toBe('SLOT_CONFLICT');
    expect(resShort.message).toContain('소요시간');
  });

  it('서비스 소요시간이 설정되어 있고 슬롯 시간 구간이 충분하면 통과하고 VerifiedOffer에 durationMinutes를 포함한다', () => {
    const res = verifyOffer({
      service: { ...validService, durationMinutes: 45 },
      slot: validSlot, // 60분
      depositKrw: 10000,
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok');
    expect(res.value.durationMinutes).toBe(45);
  });

  it.each(['', '   '])('서비스 이름이 비어 있으면 확인을 요청한다 (%j)', (name) => {
    expect(verifyOffer({ service: { ...validService, name }, slot: validSlot, depositKrw: 0, now }).ok).toBe(false);
  });

  it('카탈로그 버전이 없거나 슬롯 확인 당시 버전과 다르면 차단한다', () => {
    expect(verifyOffer({ service: { ...validService, updatedAt: '' }, slot: validSlot, depositKrw: 0, now }).ok).toBe(false);
    expect(verifyOffer({ service: validService, slot: { ...validSlot, catalogVersion: 'old' }, depositKrw: 0, now }).ok).toBe(false);
  });

  it('사장님 확인 시각이 미래이거나 15분 이상 지났으면 유효기간 값과 무관하게 재확인을 요청한다', () => {
    for (const confirmedAt of ['2026-10-16T10:01:00.000Z', '2026-10-13T10:00:00.000Z']) {
      expect(verifyOffer({ service: validService, slot: { ...validSlot, confirmedAt }, depositKrw: 0, now }).ok).toBe(false);
    }
  });

  it('유효한 카탈로그 서비스와 사장님이 확인한 슬롯이 주어지면 VerifiedOffer를 생성한다', () => {
    const result = verifyOffer({
      service: validService,
      slot: validSlot,
      depositKrw: 10000,
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.value.serviceId).toBe(validService.id);
    expect(result.value.serviceName).toBe(validService.name);
    expect(result.value.priceKrw).toBe(35000);
    expect(result.value.depositKrw).toBe(10000);
    expect(result.value.startsAt).toBe(validSlot.startsAt);
    expect(result.value.endsAt).toBe(validSlot.endsAt);
    expect(result.value.slotVersion).toBe(1);
    expect(result.value.catalogVersion).toBe(validService.updatedAt);
  });

  it('카탈로그에 가격이 없거나 비활성화(inactive)된 서비스는 차단한다', () => {
    // Price null
    const res1 = verifyOffer({
      service: { ...validService, price: null },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(res1.ok).toBe(false);
    if (res1.ok) throw new Error('Expected failure');
    expect(res1.code).toBe('CONTEXT_REQUIRED');

    // Inactive service
    const res2 = verifyOffer({
      service: { ...validService, active: false },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(res2.ok).toBe(false);
    if (res2.ok) throw new Error('Expected failure');
    expect(res2.code).toBe('CONTEXT_REQUIRED');
  });

  it('확인된 무료 서비스(price: 0)는 0원을 보존하고 통과시킨다', () => {
    const res = verifyOffer({
      service: { ...validService, price: 0 },
      slot: validSlot,
      depositKrw: 0,
      now,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected ok');
    expect(res.value.priceKrw).toBe(0);
    expect(res.value.depositKrw).toBe(0);
  });

  it('예약금이 총 가격을 초과하거나 음수이면 차단한다', () => {
    const resExcess = verifyOffer({
      service: validService,
      slot: validSlot,
      depositKrw: 40000, // exceeds 35000
      now,
    });
    expect(resExcess.ok).toBe(false);
    if (resExcess.ok) throw new Error('Expected failure');
    expect(resExcess.code).toBe('CONTEXT_REQUIRED');

    const resNegative = verifyOffer({
      service: validService,
      slot: validSlot,
      depositKrw: -5000,
      now,
    });
    expect(resNegative.ok).toBe(false);
    if (resNegative.ok) throw new Error('Expected failure');
    expect(resNegative.code).toBe('CONTEXT_REQUIRED');
  });

  it('사장님 확인 슬롯이 없거나(null) status가 AVAILABLE이 아니면 차단한다', () => {
    const resNoSlot = verifyOffer({
      service: validService,
      slot: null,
      depositKrw: 10000,
      now,
    });
    expect(resNoSlot.ok).toBe(false);
    if (resNoSlot.ok) throw new Error('Expected failure');
    expect(resNoSlot.code).toBe('CONTEXT_REQUIRED');

    const resBooked = verifyOffer({
      service: validService,
      slot: { ...validSlot, status: 'BOOKED' },
      depositKrw: 10000,
      now,
    });
    expect(resBooked.ok).toBe(false);
    if (resBooked.ok) throw new Error('Expected failure');
    expect(resBooked.code).toBe('SLOT_CONFLICT');
  });

  it('슬롯의 serviceId가 선택된 카탈로그 서비스와 불일치하면 차단한다', () => {
    const resMismatch = verifyOffer({
      service: validService,
      slot: { ...validSlot, serviceId: '99999999-9999-4999-8999-999999999999' },
      depositKrw: 10000,
      now,
    });
    expect(resMismatch.ok).toBe(false);
    if (resMismatch.ok) throw new Error('Expected failure');
    expect(resMismatch.code).toBe('CONTEXT_REQUIRED');
  });

  it('이미 지난 슬롯(startsAt <= now)이거나 validUntil 만료 슬롯은 차단한다', () => {
    // startsAt in the past
    const resPast = verifyOffer({
      service: validService,
      slot: {
        ...validSlot,
        startsAt: '2026-10-16T09:00:00.000Z',
        endsAt: '2026-10-16T10:00:00.000Z',
      },
      depositKrw: 0,
      now,
    });
    expect(resPast.ok).toBe(false);
    if (resPast.ok) throw new Error('Expected failure');
    expect(resPast.code).toBe('SLOT_CONFLICT');

    // validUntil expired
    const resExpired = verifyOffer({
      service: validService,
      slot: { ...validSlot, validUntil: '2026-10-16T09:59:00.000Z' },
      depositKrw: 0,
      now,
    });
    expect(resExpired.ok).toBe(false);
    if (resExpired.ok) throw new Error('Expected failure');
    expect(resExpired.code).toBe('SLOT_CONFLICT');
  });

  it('슬롯의 종료 시간이 시작 시간보다 앞서거나 같으면 차단한다', () => {
    const resInvalidDuration = verifyOffer({
      service: validService,
      slot: {
        ...validSlot,
        startsAt: '2026-10-16T15:00:00.000Z',
        endsAt: '2026-10-16T14:00:00.000Z',
      },
      depositKrw: 0,
      now,
    });
    expect(resInvalidDuration.ok).toBe(false);
    if (resInvalidDuration.ok) throw new Error('Expected failure');
    expect(resInvalidDuration.code).toBe('CONTEXT_REQUIRED');
  });

  it('서비스와 슬롯의 작업공간(workspaceId)이 불일치하면 FORBIDDEN으로 차단한다', () => {
    const resTenantMismatch = verifyOffer({
      service: validService,
      slot: {
        ...validSlot,
        workspaceId: '99999999-9999-4999-8999-999999999999',
      },
      depositKrw: 10000,
      now,
    });
    expect(resTenantMismatch.ok).toBe(false);
    if (resTenantMismatch.ok) throw new Error('Expected failure');
    expect(resTenantMismatch.code).toBe('FORBIDDEN');
  });

  it('유효하지 않은 IANA 시간대이거나 NaN 날짜 문자열인 경우 fail-closed 차단한다', () => {
    // Invalid timezone
    const resTz = verifyOffer({
      service: validService,
      slot: { ...validSlot, timezone: 'Not/A_Real_Timezone' },
      depositKrw: 10000,
      now,
    });
    expect(resTz.ok).toBe(false);
    if (resTz.ok) throw new Error('Expected failure');
    expect(resTz.code).toBe('CONTEXT_REQUIRED');

    // NaN startsAt
    const resNaN = verifyOffer({
      service: validService,
      slot: { ...validSlot, startsAt: 'invalid-date-string' },
      depositKrw: 10000,
      now,
    });
    expect(resNaN.ok).toBe(false);
    if (resNaN.ok) throw new Error('Expected failure');
    expect(resNaN.code).toBe('CONTEXT_REQUIRED');
  });

  describe('createOwnerConfirmedSlot duration check', () => {
    it('카탈로그 서비스의 durationMinutes가 없으면 슬롯 생성을 거부한다', async () => {
      const { createOwnerConfirmedSlot } = await import('../availability');
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: validService.id,
              workspace_id: validService.workspaceId,
              name: validService.name,
              price: validService.price,
              active: true,
              updated_at: '2026-10-15T00:00:00Z',
              duration_minutes: null,
            },
            error: null,
          }),
        }),
      } as any;

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
      try {
      await expect(
        createOwnerConfirmedSlot(
          mockClient,
          { workspaceId: validService.workspaceId, userId: 'usr-1', role: 'owner' },
          {
            serviceId: validService.id,
            startsAt: '2026-10-25T14:00:00+09:00',
            endsAt: '2026-10-25T15:00:00+09:00',
            depositKrw: 10000,
            timezone: 'Asia/Seoul',
            acknowledgedLedger: true,
          }
        )
      ).rejects.toThrow(/서비스 소요시간/);
      } finally { vi.useRealTimers(); }
    });
  });
});
