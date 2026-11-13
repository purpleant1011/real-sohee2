import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateWVAO, resolveVerifiedOutcome, type ExtendedOutcomeReceipt } from '../outcome-contract-engine';

const receipt: ExtendedOutcomeReceipt = {
  workspaceId: 'workspace-1',
  receiptId: 'receipt-1',
  goalId: 'goal-booking',
  automationRunId: 'run-1',
  metricType: 'BOOKING_COUNT',
  deltaAchieved: 3,
  evidenceSourceId: 'confirmed-booking-readback',
  verifiedAt: '2026-10-28T10:00:00.000Z',
  costInAgentEnergy: 10,
  factKind: 'MEASURED',
};

afterEach(() => vi.useRealTimers());

describe('성과 근거 집계 경계', () => {
  it('실측 가시성도 최종 사업 성과로 승격하지 않는다', () => {
    expect(resolveVerifiedOutcome({ ...receipt, metricType: 'BRAND_AWARENESS_ENGAGEMENT' }))
      .toMatchObject({ isVerified: true, acceptedForNorthStar: false, metricDelta: 0 });
  });

  it('근거 ID가 없으면 검증된 성과로 인정하지 않는다', () => {
    expect(resolveVerifiedOutcome({ ...receipt, evidenceSourceId: ' ' }))
      .toMatchObject({ isVerified: false, acceptedForNorthStar: false, metricDelta: 0 });
  });

  it('유한하지 않은 성과는 집계하지 않는다', () => {
    expect(resolveVerifiedOutcome({ ...receipt, deltaAchieved: Number.NaN }))
      .toMatchObject({ isVerified: false, acceptedForNorthStar: false, metricDelta: 0 });
  });

  it('집계 기간 밖과 미래 및 잘못된 시각의 영수증을 제외한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    const result = calculateWVAO('workspace-1', [
      receipt,
      { ...receipt, receiptId: 'old', verifiedAt: '2026-10-20T10:00:00.000Z' },
      { ...receipt, receiptId: 'future', verifiedAt: '2026-10-29T10:00:00.000Z' },
      { ...receipt, receiptId: 'invalid', verifiedAt: 'invalid' },
    ]);
    expect(result.weeklyVerifiedOutcomesCount).toBe(3);
    expect(result.totalEnergySpent).toBe(10);
  });

  it('유효하지 않은 관측 기간을 전체 기간 집계로 해석하지 않는다', () => {
    for (const days of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateWVAO('workspace-1', [receipt], days)).toThrow(RangeError);
    }
  });

  it('지정한 관측 기간을 적용한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00.000Z'));
    expect(calculateWVAO('workspace-1', [
      { ...receipt, verifiedAt: '2026-10-26T10:00:00.000Z' },
    ], 1)).toMatchObject({ weeklyVerifiedOutcomesCount: null, observationStatus: 'NOT_OBSERVED', measuredReceiptsCount: 0 });
  });

  it('다른 작업공간의 영수증은 성과와 비용에서 모두 제외한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    const result = calculateWVAO('workspace-1', [
      { ...receipt, workspaceId: 'workspace-2' },
      { ...receipt, receiptId: 'local' },
    ]);
    expect(result.weeklyVerifiedOutcomesCount).toBe(3);
    expect(result.totalEnergySpent).toBe(10);
    expect(result.measuredReceiptsCount).toBe(1);
  });

  it('작업공간 없는 영수증을 현재 가게의 실측으로 추정하지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    const unscoped = { ...receipt, receiptId: 'unscoped' };
    Reflect.deleteProperty(unscoped, 'workspaceId');
    const result = calculateWVAO('workspace-1', [unscoped, receipt]);
    expect(result.weeklyVerifiedOutcomesCount).toBe(3);
    expect(result.totalEnergySpent).toBe(10);
  });

  it('다른 작업공간의 같은 ID가 현재 가게 영수증을 가리지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    expect(calculateWVAO('workspace-1', [
      { ...receipt, workspaceId: 'workspace-2', deltaAchieved: 99 }, receipt,
    ]).weeklyVerifiedOutcomesCount).toBe(3);
  });

  it('관측 영수증이 없으면 성과 0건 대신 미관측을 반환한다', () => {
    expect(calculateWVAO('workspace-1', [])).toMatchObject({
      weeklyVerifiedOutcomesCount: null, observationStatus: 'NOT_OBSERVED', falseSuccessRate: null,
    });
  });

  it('추정치만 있으면 실측 0건으로 승격하지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    expect(calculateWVAO('workspace-1', [{ ...receipt, factKind: 'ESTIMATED' }]))
      .toMatchObject({ weeklyVerifiedOutcomesCount: null, observationStatus: 'NOT_OBSERVED' });
  });

  it('근거 있는 0건은 미관측과 구별한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    expect(calculateWVAO('workspace-1', [{ ...receipt, deltaAchieved: 0 }]))
      .toMatchObject({ weeklyVerifiedOutcomesCount: 0, observationStatus: 'VERIFIED_ZERO' });
  });

  it('실측 성과가 있어도 성공 오판율이 검증됐다고 표시하지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    expect(calculateWVAO('workspace-1', [receipt]))
      .toMatchObject({ weeklyVerifiedOutcomesCount: 3, observationStatus: 'OBSERVED', falseSuccessRate: null });
  });

  it('동일 영수증 재전달로 성과와 비용을 중복 계산하지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(receipt.verifiedAt));
    const result = calculateWVAO('workspace-1', [receipt, receipt]);
    expect(result.weeklyVerifiedOutcomesCount).toBe(3);
    expect(result.totalEnergySpent).toBe(10);
    expect(result.measuredReceiptsCount).toBe(1);
  });
});
