import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryCard } from '../components/recovery-card';
import { RecoveryView } from '../contracts';

describe('RecoveryCard Component (Task 10)', () => {
  const baseView: RecoveryView = {
    caseId: '11111111-1111-4111-8111-111111111111',
    missionId: '22222222-2222-4222-8222-222222222222',
    version: 1,
    stage: 'DRAFT_READY',
    statusLabel: '답변 초안 준비 완료',
    sourceThreadId: '33333333-3333-4333-8333-333333333333',
    sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-10-16T10:00:00.000Z',
    reply: {
      text: '고객님 14시에 예약 가능합니다.',
      fingerprint: 'a'.repeat(64),
    },
    offer: {
      slotId: '77777777-7777-4777-8777-777777777777',
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '맞춤 펌 시술',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T16:00:00Z',
      timezone: 'Asia/Seoul',
      totalAmountKrw: 120000,
      depositKrw: 30000,
      validUntil: '2026-10-16T12:00:00Z',
      proposalRevision: 1,
    },
    acceptance: null,
    approval: {
      kind: 'send',
      fingerprint: 'a'.repeat(64),
    },
    proposal: {
      revision: 1,
      serviceId: '66666666-6666-4666-8666-666666666666',
      serviceName: '맞춤 펌 시술',
      totalAmountKrw: 120000,
      depositKrw: 30000,
      slotId: '77777777-7777-4777-8777-777777777777',
      startsAt: '2026-10-17T14:00:00Z',
      endsAt: '2026-10-17T16:00:00Z',
    },
    booking: null,
    nextAction: 'approve_send',
    revenue: {
      status: 'NOT_OBSERVED',
      amountKrw: null,
    },
  };

  it('불확실 전송(RESULT_UNKNOWN)은 성공 버튼으로 바꾸지 않고 확인 필요 안내를 표시한다', () => {
    const unknownView: RecoveryView = {
      ...baseView,
      stage: 'RESULT_UNKNOWN',
      statusLabel: '전송 결과 확인 필요',
      nextAction: 'review',
      approval: null,
    };

    render(<RecoveryCard view={unknownView} onCommand={vi.fn()} />);

    expect(screen.getByText('전송 결과 확인 필요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /예약 확정/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /답변 전송 승인/i })).not.toBeInTheDocument();
  });

  it('승인 전 문안, 서비스명, 가격, 예약금, 시간을 올바르게 렌더링한다', () => {
    render(<RecoveryCard view={baseView} onCommand={vi.fn()} />);

    expect(screen.getByText('맞춤 펌 시술')).toBeInTheDocument();
    expect(screen.getByText(/120,000원/)).toBeInTheDocument();
    expect(screen.getByText(/30,000원/)).toBeInTheDocument();
    expect(screen.getByText('고객님 14시에 예약 가능합니다.')).toBeInTheDocument();
  });

  it('사용자에게 raw UUID나 SHA-256 지문, 영문 state를 노출하지 않는다', () => {
    const { container } = render(<RecoveryCard view={baseView} onCommand={vi.fn()} />);

    const textContent = container.textContent || '';
    expect(textContent).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(textContent).not.toContain('a'.repeat(64));
    expect(textContent).not.toContain('DRAFT_READY');
    expect(textContent).not.toContain('AWAITING_SEND_APPROVAL');
  });

  it('승인 버튼 클릭 시 렌더링 당시의 fingerprint와 version을 서버로 전송한다', async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<RecoveryCard view={baseView} onCommand={onCommand} />);

    const approveButton = screen.getByRole('button', { name: '답변 전송 승인' });
    expect(approveButton).toBeInTheDocument();

    fireEvent.click(approveButton);

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith({
      kind: 'approve_send',
      expectedVersion: baseView.version,
      fingerprint: baseView.approval!.fingerprint,
    });
  });

  it('버튼 클릭 중(in-flight)에는 중복 클릭을 차단하고 로딩 상태를 표시한다', async () => {
    let resolveCommand: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolveCommand = resolve;
    });
    const onCommand = vi.fn().mockReturnValue(pendingPromise);

    render(<RecoveryCard view={baseView} onCommand={onCommand} />);

    const approveButton = screen.getByRole('button', { name: '답변 전송 승인' });
    fireEvent.click(approveButton);

    // in-flight 중 비활성화
    expect(approveButton).toBeDisabled();

    // 두 번째 클릭 시도 무시
    fireEvent.click(approveButton);
    expect(onCommand).toHaveBeenCalledTimes(1);

    // 완료 후
    resolveCommand();
  });

  it('고객 수락 상태에서 최종 예약 확정 승인 버튼을 올바르게 렌더링하고 전송한다', async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const bookingView: RecoveryView = {
      ...baseView,
      stage: 'CUSTOMER_ACCEPTED',
      statusLabel: '고객 예약 수락',
      nextAction: 'approve_booking',
      acceptance: {
        inboundMessageId: '88888888-8888-4888-8888-888888888888',
        receivedAt: '2026-10-16T11:00:00Z',
      },
      approval: {
        kind: 'booking',
        fingerprint: 'b'.repeat(64),
      },
    };

    render(<RecoveryCard view={bookingView} onCommand={onCommand} />);

    const confirmButton = screen.getByRole('button', { name: '예약 확정 승인' });
    expect(confirmButton).toBeInTheDocument();

    fireEvent.click(confirmButton);

    expect(onCommand).toHaveBeenCalledWith({
      kind: 'approve_booking',
      expectedVersion: bookingView.version,
      fingerprint: 'b'.repeat(64),
    });
  });

  it('15분 TTL 만료 또는 장부 재확인 필요 시 장부 재확인 버튼을 렌더링하고 reattest_schedule 명령을 전송한다', async () => {
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const reattestView: RecoveryView = {
      ...baseView,
      stage: 'CUSTOMER_ACCEPTED',
      statusLabel: '고객 예약 수락',
      nextAction: 'reattest_schedule',
      acceptance: {
        inboundMessageId: '88888888-8888-4888-8888-888888888888',
        receivedAt: '2026-10-16T11:00:00Z',
      },
      approval: null,
    };

    render(<RecoveryCard view={reattestView} onCommand={onCommand} />);

    const reattestButton = screen.getByRole('button', { name: '장부 재확인하기' });
    expect(reattestButton).toBeInTheDocument();

    fireEvent.click(reattestButton);

    expect(onCommand).toHaveBeenCalledWith({
      kind: 'reattest_schedule',
      expectedVersion: reattestView.version,
      slotId: reattestView.offer!.slotId,
    });
  });

  it('예약이 취소된 경우 취소 상태를 사용자에게 명확히 안내한다', async () => {
    const cancelledView: RecoveryView = {
      ...baseView,
      stage: 'BOOKING_CONFIRMED',
      statusLabel: '예약 확정 완료',
      nextAction: null,
      booking: {
        id: 'bk_cancelled_123',
        confirmedAt: '2026-10-16T12:00:00Z',
        status: 'CANCELLED',
      },
    };

    render(<RecoveryCard view={cancelledView} />);
    expect(screen.getByText('예약 취소됨')).toBeInTheDocument();
  });
});
