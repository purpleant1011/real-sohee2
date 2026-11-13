import { describe, expect, it } from 'vitest';
import { classifyAcceptance, type ProposalContext } from '../inbound-projector';

const proposal: ProposalContext = {
  customerRef: 'customer-1', sentAt: '2026-10-22T10:00:00Z', serviceName: '서비스',
  timezone: 'Asia/Seoul',
  slots: [{ id: 'slot-14', label: '10월23일14시', startsAt: '2026-10-23T14:00:00+09:00' }],
};
function classify(text: string, context: ProposalContext = proposal) {
  return classifyAcceptance({ proposal: context, message: {
    id: 'acceptance-1', customerRef: 'customer-1', senderType: 'customer', text,
    sentAt: '2026-10-22T11:00:00Z',
  } });
}

describe('customer acceptance is bound to the offered local date/time', () => {
  it('W3 G093-07 원본 fixture를 W4 구현에 재생하면 다른 15시 요청은 검토 필요', () => {
    expect(classifyAcceptance({ message: {
      id: 'fixture-message', customerRef: 'fixture-customer', senderType: 'customer',
      text: '15시로 예약할게요', sentAt: '2026-10-22T10:01:00+09:00',
    }, proposal: {
      customerRef: 'fixture-customer', sentAt: '2026-10-22T10:00:00+09:00', serviceName: 'fixture-service',
      slots: [{ id: 'fixture-slot-14', label: '10월 23일 14시', startsAt: '2026-10-23T14:00:00+09:00' }],
    } }).kind).toBe('needs_review');
  });
  it.each([
    '15시로 예약할게요', '10월24일14시로 예약할게요', '24일로 예약해 주세요',
    '2027년10월23일14시로 예약할게요', '토요일14시로 예약할게요',
    '14시30분으로 예약해 주세요', '오전2시로 예약해 주세요',
    '내일14시로 예약해 주세요', '다음주금요일14시로 예약해 주세요',
    '14시 말고15시로 예약할게요', '14시 또는15시로 예약해 주세요',
    '오후15시로 예약해 주세요', '3pm으로 예약해 주세요', '세 시로 예약해 주세요',
    'UTC14시로 예약해 주세요', '2시로 예약해 주세요',
  ])('다른 조건·모호한 날짜/시각은 단일 슬롯이어도 검토 필요: %s', (text) => {
    expect(classify(text)).toMatchObject({ kind: 'needs_review' });
  });

  it.each(['염색으로 예약할게요', '서비스 바꿔서 예약해 주세요',
    '2명으로 예약해 주세요', '14시에 두 명 예약해 주세요',
    '친구랑 같이 예약해 주세요', '네 그 시간으로 예약해 주세요. 인원은 2명입니다'])('서비스·인원 조건을 임의로 동일 수락으로 바꾸지 않음: %s', (text) => {
    expect(classify(text, { ...proposal, serviceName: '커트' })).toMatchObject({ kind: 'needs_review' });
  });

  it.each(['네 그 시간으로 예약해 주세요!', '금요일14시로 예약할게요',
    '10월23일14시로 예약할게요', '2026년10월23일오후2시로 예약해 주세요',
    '23일14:00으로 예약해 주세요'])('제안의 명확한 동일 조건은 수락: %s', (text) => {
    expect(classify(text)).toMatchObject({ kind: 'accepted', slotId: 'slot-14' });
  });

  it('동일 시각 두 날짜 중 날짜를 말하지 않으면 추측하지 않음', () => {
    expect(classify('14시로 예약할게요', { ...proposal, slots: [
      ...proposal.slots, { id: 'slot-next', label: '10월24일14시', startsAt: '2026-10-24T14:00:00+09:00' },
    ] })).toMatchObject({ kind: 'needs_review' });
  });

  it.each(['그 시간으로 예약해 주세요', '14시로 예약할게요'])('해석 불가한 후보가 섞이면 나머지 슬롯으로 추측하지 않음: %s', (text) => {
    expect(classify(text, { ...proposal, slots: [ ...proposal.slots,
      { id: 'unknown-slot', label: '다른 제안', startsAt: 'unknown' },
    ] })).toMatchObject({ kind: 'needs_review' });
  });

  it('UTC 저장값도 매장 시간대에 맞춰 비교', () => {
    const utcStored = { ...proposal, slots: [{ ...proposal.slots[0], startsAt: '2026-10-23T05:00:00Z' }] };
    expect(classify('14시로 예약할게요', utcStored)).toMatchObject({ kind: 'accepted', slotId: 'slot-14' });
    expect(classify('15시로 예약할게요', utcStored)).toMatchObject({ kind: 'needs_review' });
  });

  it('분 단위도 제안과 정확히 일치해야 수락', () => {
    const halfHour = { ...proposal, slots: [{ ...proposal.slots[0], startsAt: '2026-10-23T14:30:00+09:00' }] };
    expect(classify('오후2시반으로 예약할게요', halfHour)).toMatchObject({ kind: 'accepted', slotId: 'slot-14' });
    expect(classify('14시로 예약할게요', halfHour)).toMatchObject({ kind: 'needs_review' });
  });

  it('명시된 매장 시간대가 UTC라면 KST를 강제하지 않음', () => {
    expect(classify('05:00으로 예약해 주세요', { ...proposal, timezone: 'UTC' }))
      .toMatchObject({ kind: 'accepted', slotId: 'slot-14' });
    expect(classify('14시로 예약할게요', { ...proposal, timezone: 'UTC' }))
      .toMatchObject({ kind: 'needs_review' });
  });

  it('슬롯의 라벨이 틀려도 실제 startsAt이 최종 기준', () => {
    expect(classify('15시로 예약할게요', { ...proposal,
      slots: [{ ...proposal.slots[0], label: '10월23일15시' }] })).toMatchObject({ kind: 'needs_review' });
  });

  it.each(['invalid-zone', ''])('확인할 수 없는 매장 시간대는 검토 필요: %s', (timezone) => {
    expect(classify('그 시간으로 예약해 주세요', { ...proposal, timezone })).toMatchObject({ kind: 'needs_review' });
  });

  it('명시 시간대 없는 startsAt은 로컬 머신 시간으로 해석하지 않음', () => {
    expect(classify('14시로 예약할게요', { ...proposal,
      slots: [{ ...proposal.slots[0], startsAt: '2026-10-23T14:00:00' }] })).toMatchObject({ kind: 'needs_review' });
  });
});
