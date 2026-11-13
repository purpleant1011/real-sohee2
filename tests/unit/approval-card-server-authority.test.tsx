import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalCard } from '@/features/action-graph/event-cards';
import { DecisionCardData } from '@/lib/agent-os/agent-orchestrator';

describe('ANI-963: ApprovalCard Server Authority (Local Optimistic Removal)', () => {
  const baseCard: DecisionCardData & { expectedVersion?: number } = {
    decisionId: 'dec-server-auth-001',
    title: '봄맞이 네이버 플레이스 타임세일 자동 등록 승인',
    expectedVersion: 4,
    diffSummary: '네이버 스마트플레이스 예약 15% 쿠폰 4개 슬롯 발행',
    diff: {
      before: { couponActive: false },
      after: { couponActive: true, discountRate: 15 },
    },
    options: [
      {
        id: 'opt-confirm',
        label: '쿠폰 즉시 활성화 및 채널 배포',
        description: '평일 낮 유휴 슬롯 4개 자동 연결',
        sc: 120,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders initial PENDING state with action buttons and canonical credit unit', () => {
    render(<ApprovalCard card={baseCard} />);

    expect(screen.getByTestId('event-card-approval')).toBeDefined();
    expect(screen.getByText('APPROVAL_REQUIRED')).toBeDefined();
    expect(screen.getByText('CAS v4')).toBeDefined();
    expect(screen.getByRole('button', { name: /승인 및 실행/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /반려/ })).toBeDefined();

    // Verify canonical credit copy instead of legacy "SC"
    expect(screen.getByText(/120 크레딧/)).toBeDefined();
    expect(screen.queryByText(/120 SC/)).toBeNull();
  });

  it('shows PROCESSING state while server approval request is in-flight', async () => {
    let resolvePromise: () => void = () => {};
    const onApprove = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
    });

    render(<ApprovalCard card={baseCard} onApprove={onApprove} />);

    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
    fireEvent.click(approveBtn);

    expect(onApprove).toHaveBeenCalledWith('dec-server-auth-001', 'opt-confirm');

    // In-flight: Must show PROCESSING indicator and NOT show APPROVED yet
    await waitFor(() => {
      expect(screen.getByTestId('approval-status-processing')).toBeDefined();
    });
    expect(screen.getByText(/서버 승인 처리 중/)).toBeDefined();
    expect(screen.queryByTestId('approval-status-approved')).toBeNull();
    expect(screen.queryByText(/승인 완료/)).toBeNull();

    // Resolve server request
    resolvePromise();

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-approved')).toBeDefined();
    });
    expect(screen.getByText(/승인 완료/)).toBeDefined();
  });

  it('does NOT transition to APPROVED on VERSION_CONFLICT error and renders conflict guidance', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('VERSION_CONFLICT: Expected v4 but server was at v5'));

    render(<ApprovalCard card={baseCard} onApprove={onApprove} />);

    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-conflict')).toBeDefined();
    });

    // CRITICAL: Local optimistic 승인 완료가 절대 표시되지 않아야 함
    expect(screen.queryByTestId('approval-status-approved')).toBeNull();
    expect(screen.queryByText(/승인 완료/)).toBeNull();
    expect(screen.getByText(/버전 충돌/)).toBeDefined();
    expect(screen.getByText(/새로고침/)).toBeDefined();
  });

  it('handles structured VERSION_CONFLICT response object from server API', async () => {
    const onApprove = vi.fn().mockResolvedValue({
      success: false,
      status: 'VERSION_CONFLICT',
      error: '다른 운영자가 이미 이 결정을 처리했습니다.',
    });

    render(<ApprovalCard card={baseCard} onApprove={onApprove} />);

    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-conflict')).toBeDefined();
    });

    expect(screen.queryByTestId('approval-status-approved')).toBeNull();
    expect(screen.getByText(/다른 운영자가 이미 이 결정을 처리했습니다/)).toBeDefined();
  });

  it('does NOT transition to APPROVED on EXPIRED error', async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error('EXPIRED: 승인 유효 시간이 초과되었습니다.'));

    render(<ApprovalCard card={baseCard} onApprove={onApprove} />);

    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-expired')).toBeDefined();
    });

    expect(screen.queryByTestId('approval-status-approved')).toBeNull();
    expect(screen.getByText(/승인 기한 만료/)).toBeDefined();
  });

  it('does NOT transition to APPROVED on generic server FAILED error and allows retry', async () => {
    const onApprove = vi
      .fn()
      .mockRejectedValueOnce(new Error('500 Internal Server Error: Gateway timeout'))
      .mockResolvedValueOnce(undefined);

    render(<ApprovalCard card={baseCard} onApprove={onApprove} />);

    const approveBtn = screen.getByRole('button', { name: /승인 및 실행/ });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-failed')).toBeDefined();
    });

    expect(screen.queryByTestId('approval-status-approved')).toBeNull();
    expect(screen.getByText(/승인 처리 실패/)).toBeDefined();
    expect(screen.getByText(/500 Internal Server Error/)).toBeDefined();

    // Retry button click
    const retryBtn = screen.getByRole('button', { name: /다시 시도/ });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('approval-status-approved')).toBeDefined();
    });
  });

  it('strictly reflects external server authority snapshot (ActionRun snapshot)', () => {
    // 1. External snapshot is FAILED
    const { rerender } = render(
      <ApprovalCard card={baseCard} serverStatus="FAILED" errorMessage="서버 샌드박스 정책 위반으로 거부되었습니다." />
    );
    expect(screen.getByTestId('approval-status-failed')).toBeDefined();
    expect(screen.getByText(/서버 샌드박스 정책 위반으로 거부되었습니다/)).toBeDefined();
    expect(screen.queryByTestId('approval-status-approved')).toBeNull();

    // 2. Snapshot updates to VERSION_CONFLICT
    rerender(<ApprovalCard card={baseCard} serverStatus="VERSION_CONFLICT" />);
    expect(screen.getByTestId('approval-status-conflict')).toBeDefined();

    // 3. Snapshot updates to APPROVED
    rerender(<ApprovalCard card={baseCard} serverStatus="APPROVED" />);
    expect(screen.getByTestId('approval-status-approved')).toBeDefined();
  });

  it('never displays arbitrary "실행 완료" before execution evidence is confirmed', () => {
    render(<ApprovalCard card={baseCard} serverStatus="APPROVED" />);

    // Approved should confirm approval, but must NEVER claim premature execution complete
    expect(screen.queryByText(/실행이 즉시 완료되었습니다/)).toBeNull();
    expect(screen.queryByText(/^실행 완료$/)).toBeNull();
  });
});
