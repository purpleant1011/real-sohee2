import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AvailabilityForm } from '../components/availability-form';
import type { CatalogService } from '../availability';

describe('AvailabilityForm UI Component (Task 4)', () => {
  const mockServices: CatalogService[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: 'ws-1',
      name: '맞춤 커트',
      price: 35000,
      active: true,
      updatedAt: '2026-10-15T00:00:00Z',
      // ANI-1609: the server refuses a service without a catalog duration, so a valid fixture has one.
      durationMinutes: 60,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      workspaceId: 'ws-1',
      name: '단백질 클리닉',
      price: 80000,
      active: true,
      updatedAt: '2026-10-15T00:00:00Z',
      durationMinutes: 120,
    },
  ];

  it('등록된 서비스 정보 기준 가격을 렌더링하고 장부 미확인 시 제출 버튼이 비활성화된다', () => {
    const onSubmit = vi.fn();
    render(<AvailabilityForm services={mockServices} onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/예약 서비스 선택/i)).toBeDefined();
    expect(screen.getAllByText(/35,000원/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/등록된 서비스 정보 기준/i)).toBeDefined();

    const submitBtn = screen.getByRole('button', { name: /예약 가능 시간 확인 및 제안 준비/i });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('KST가 아닌 환경에서도 매장 시간대(+09:00) 기준 ISO 문자열을 생성하여 제출한다', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AvailabilityForm
        services={mockServices}
        workspaceTimezone="Asia/Seoul"
        onSubmit={onSubmit}
      />
    );

    const startsAtInput = screen.getByLabelText(/시작 일시/i);
    const endsAtInput = screen.getByLabelText(/종료 일시/i);
    const depositInput = screen.getByLabelText(/예약금/i);
    const checkbox = screen.getByLabelText(/사장님이 실제 매장 예약표/i);
    const submitBtn = screen.getByRole('button', { name: /예약 가능 시간 확인 및 제안 준비/i });

    fireEvent.change(startsAtInput, { target: { value: '2026-10-20T14:00' } });
    fireEvent.change(endsAtInput, { target: { value: '2026-10-20T15:00' } });
    fireEvent.change(depositInput, { target: { value: '10000' } });
    fireEvent.click(checkbox);

    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    const calledArg = onSubmit.mock.calls[0][0];
    expect(calledArg.serviceId).toBe(mockServices[0].id);
    expect(calledArg.startsAt).toBe('2026-10-20T14:00:00+09:00');
    expect(calledArg.endsAt).toBe('2026-10-20T15:00:00+09:00');
    expect(calledArg.depositKrw).toBe(10000);
    expect(calledArg.timezone).toBe('Asia/Seoul');
    expect(calledArg.acknowledgedLedger).toBe(true);
  });

  it('소수점이나 음수 예약금 입력 시 에러를 표시하고 제출을 차단한다', async () => {
    const onSubmit = vi.fn();
    render(<AvailabilityForm services={mockServices} onSubmit={onSubmit} />);

    const startsAtInput = screen.getByLabelText(/시작 일시/i);
    const endsAtInput = screen.getByLabelText(/종료 일시/i);
    const depositInput = screen.getByLabelText(/예약금/i);
    const checkbox = screen.getByLabelText(/사장님이 실제 매장 예약표/i);

    fireEvent.change(startsAtInput, { target: { value: '2026-10-20T14:00' } });
    fireEvent.change(endsAtInput, { target: { value: '2026-10-20T15:00' } });
    fireEvent.change(depositInput, { target: { value: '1000.5' } }); // Decimal
    fireEvent.click(checkbox);

    fireEvent.submit(screen.getByLabelText(/가용 시간 확인 폼/i));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByRole('alert').textContent).toContain('0원 이상의 정수 금액');
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('빠른 더블 클릭(rapid double click) 시 local in-flight guard로 단 1회만 onSubmit이 호출된다', async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const onSubmit = vi.fn().mockImplementation(() => submitPromise);

    render(<AvailabilityForm services={mockServices} onSubmit={onSubmit} />);

    const startsAtInput = screen.getByLabelText(/시작 일시/i);
    const endsAtInput = screen.getByLabelText(/종료 일시/i);
    const checkbox = screen.getByLabelText(/사장님이 실제 매장 예약표/i);
    const submitBtn = screen.getByRole('button', { name: /예약 가능 시간 확인 및 제안 준비/i });

    fireEvent.change(startsAtInput, { target: { value: '2026-10-20T14:00' } });
    fireEvent.change(endsAtInput, { target: { value: '2026-10-20T15:00' } });
    fireEvent.click(checkbox);

    // Rapid double click
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmit!();
    await waitFor(() => {
      expect((submitBtn as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('선택한 서비스 소요시간보다 슬롯 구간이 짧으면 폼에서 경고를 표시하고 제출을 차단한다', async () => {
    const onSubmit = vi.fn();
    const servicesWithDuration: CatalogService[] = [
      {
        ...mockServices[0],
        durationMinutes: 90, // 90분 소요
      },
    ];

    render(<AvailabilityForm services={servicesWithDuration} onSubmit={onSubmit} />);

    const startsAtInput = screen.getByLabelText(/시작 일시/i);
    const endsAtInput = screen.getByLabelText(/종료 일시/i);
    const checkbox = screen.getByLabelText(/사장님이 실제 매장 예약표/i);

    // 60분 구간 입력
    fireEvent.change(startsAtInput, { target: { value: '2026-10-20T14:00' } });
    fireEvent.change(endsAtInput, { target: { value: '2026-10-20T15:00' } });
    fireEvent.click(checkbox);

    fireEvent.submit(screen.getByLabelText(/가용 시간 확인 폼/i));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByRole('alert').textContent).toContain('서비스 소요시간(90분)보다 짧습니다');
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('서비스 소요시간이 없으면 서버에 보내지 않고 소요시간 설정을 먼저 요청한다', async () => {
    const onSubmit = vi.fn();
    const servicesWithoutDuration: CatalogService[] = [
      {
        ...mockServices[0],
        durationMinutes: null,
      },
    ];

    render(<AvailabilityForm services={servicesWithoutDuration} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/시작 일시/i), { target: { value: '2026-10-20T14:00' } });
    fireEvent.change(screen.getByLabelText(/종료 일시/i), { target: { value: '2026-10-20T15:00' } });
    fireEvent.click(screen.getByLabelText(/사장님이 실제 매장 예약표/i));

    fireEvent.submit(screen.getByLabelText(/가용 시간 확인 폼/i));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('소요시간이 설정되지 않아');
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('외부 장부 미연동 안내 배지가 화면에 표시된다', () => {
    render(<AvailabilityForm services={mockServices} onSubmit={vi.fn()} />);
    expect(screen.getByText(/외부 장부 미연동 · 사장님 수동 확인 필수/i)).toBeDefined();
  });
});
