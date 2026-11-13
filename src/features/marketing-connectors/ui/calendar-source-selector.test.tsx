import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CalendarSourceSelector,
  type CalendarSource,
} from './calendar-source-selector';

const mockCalendars: CalendarSource[] = [
  {
    id: 'owner@example.com',
    summary: '대표 캘린더 (개인/공식)',
    primary: true,
    timeZone: 'Asia/Seoul',
  },
  {
    id: 'store_events@group.calendar.google.com',
    summary: '매장 프로모션 및 이벤트',
    primary: false,
    timeZone: 'Asia/Seoul',
  },
  {
    id: 'reservations@group.calendar.google.com',
    summary: '고객 예약 일정',
    primary: false,
    timeZone: 'Asia/Seoul',
  },
];

describe('CalendarSourceSelector Component', () => {
  const workspaceId = '3f9b2d84-18e3-4c91-a582-7dcfa3c81204';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state when fetching calendars from API', async () => {
    vi.spyOn(global, 'fetch').mockImplementationOnce(() => new Promise(() => {}));

    render(<CalendarSourceSelector workspaceId={workspaceId} />);
    expect(screen.getByText(/캘린더 목록을 불러오는 중입니다/i)).toBeInTheDocument();
  });

  it('renders error state when fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: '인증 오류' }), { status: 401 })
    );

    render(<CalendarSourceSelector workspaceId={workspaceId} />);

    await waitFor(() => {
      expect(screen.getByText(/캘린더 목록을 불러오지 못했습니다/i)).toBeInTheDocument();
    });
  });

  it('renders calendar list with initialCalendars without auto-selecting primary calendar', () => {
    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
      />
    );

    expect(screen.getByText('대표 캘린더 (개인/공식)')).toBeInTheDocument();
    expect(screen.getByText('매장 프로모션 및 이벤트')).toBeInTheDocument();
    expect(screen.getByText('고객 예약 일정')).toBeInTheDocument();

    // Verify primary badge is rendered
    expect(screen.getByText('기본 캘린더')).toBeInTheDocument();

    // Verify NO checkboxes are auto-selected (explicit choice principle)
    const checkboxes = screen.getAllByRole('checkbox', { name: /선택/ });
    checkboxes.forEach((cb) => {
      expect(cb).not.toBeChecked();
    });

    // Save button must be disabled when nothing is selected
    const saveButton = screen.getByRole('button', { name: /캘린더 저장|선택 완료/i });
    expect(saveButton).toBeDisabled();
  });

  it('allows user to select calendars and updates selection count', () => {
    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
      />
    );

    const storeCheckbox = screen.getByRole('checkbox', {
      name: /매장 프로모션 및 이벤트 선택/i,
    });
    fireEvent.click(storeCheckbox);

    expect(storeCheckbox).toBeChecked();
    expect(screen.getByText(/1개 선택됨/i)).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /캘린더 저장|선택 완료/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('allows selecting multiple calendars', () => {
    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
      />
    );

    const cb1 = screen.getByRole('checkbox', {
      name: /대표 캘린더 \(개인\/공식\) 선택/i,
    });
    const cb2 = screen.getByRole('checkbox', {
      name: /매장 프로모션 및 이벤트 선택/i,
    });

    fireEvent.click(cb1);
    fireEvent.click(cb2);

    expect(cb1).toBeChecked();
    expect(cb2).toBeChecked();
    expect(screen.getByText(/2개 선택됨/i)).toBeInTheDocument();
  });

  it('shows AI processing and marketing schedule consent notice and checkbox', () => {
    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
      />
    );

    expect(
      screen.getByText(/선택한 캘린더의 일정을 소희 AI 마케팅 분석 및 제안에 활용하는 것에 동의합니다/i)
    ).toBeInTheDocument();

    // Privacy notice
    expect(
      screen.getByText(/민감한 정보는 절대 수집하지 않습니다/i)
    ).toBeInTheDocument();
  });

  it('calls onSave with selected calendar IDs and consent approval when submitted', async () => {
    const handleSave = vi.fn().mockResolvedValue(undefined);

    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
        onSave={handleSave}
      />
    );

    const cb = screen.getByRole('checkbox', {
      name: /매장 프로모션 및 이벤트 선택/i,
    });
    fireEvent.click(cb);

    const saveButton = screen.getByRole('button', { name: /캘린더 저장|선택 완료/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(
        ['store_events@group.calendar.google.com'],
        true
      );
    });
  });

  it('disables save button if AI processing consent is unchecked', () => {
    render(
      <CalendarSourceSelector
        workspaceId={workspaceId}
        initialCalendars={mockCalendars}
      />
    );

    const cb = screen.getByRole('checkbox', {
      name: /매장 프로모션 및 이벤트 선택/i,
    });
    fireEvent.click(cb);

    const consentCheckbox = screen.getByRole('checkbox', {
      name: /동의/i,
    });
    expect(consentCheckbox).toBeChecked();

    fireEvent.click(consentCheckbox);
    expect(consentCheckbox).not.toBeChecked();

    const saveButton = screen.getByRole('button', { name: /캘린더 저장|선택 완료/i });
    expect(saveButton).toBeDisabled();
  });
});
