// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { IcsImportModal } from './ics-import-modal';
import type { CalendarParseWindow } from '../ics-parser';

const mockWindow: CalendarParseWindow = {
  startInstant: '2026-11-01T00:00:00.000Z',
  endInstant: '2026-11-30T23:59:59.999Z',
  startDate: '2026-11-01',
  endDateExclusive: '2026-12-01',
};

const validIcsContent = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Apple Inc.//macOS 15.0//EN',
  'CALSCALE:GREGORIAN',
  'BEGIN:VEVENT',
  'UID:event-1@apple.com',
  'SUMMARY:가을 신메뉴 출시 회의',
  'DTSTART:20261110T090000Z',
  'DTEND:20261110T100000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-2@apple.com',
  'SUMMARY:정기 워크숍 (종일)',
  'DTSTART;VALUE=DATE:20261115',
  'DTEND;VALUE=DATE:20261116',
  'RRULE:FREQ=WEEKLY;COUNT=2',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('IcsImportModal (Apple ICS 파일 가져오기 및 파싱 미리보기 UI)', () => {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('렌더링 및 모달 기본 동작', () => {
    it('open이 false일 때 다이얼로그가 표시되지 않는다', () => {
      render(
        <IcsImportModal
          open={false}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('open이 true일 때 모달 다이얼로그와 파일 선택 드롭존을 렌더링한다', () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('애플 캘린더 일정 파일(.ics) 가져오기')).toBeInTheDocument();
      expect(screen.getByLabelText(/애플 캘린더 일정 파일 선택/i)).toBeInTheDocument();
      expect(screen.getByText(/파일을 끌어다 놓거나/i)).toBeInTheDocument();
    });

    it('취소 버튼 클릭 시 onOpenChange(false)가 호출된다', () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const cancelButton = screen.getByRole('button', { name: '취소' });
      fireEvent.click(cancelButton);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  describe('파일 선택 및 유효성 검사 (크기 / 확장자 제한)', () => {
    it('.ics 확장자가 아닌 파일 업로드 시 한국어 안내를 노출한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const invalidFile = new File(['hello'], 'document.pdf', { type: 'application/pdf' });

      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      await waitFor(() => {
        expect(
          screen.getByText('.ics 확장자의 캘린더 파일만 업로드할 수 있습니다.')
        ).toBeInTheDocument();
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('500KB를 초과하는 파일 선택 시 파일 크기 초과 안내를 표시한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const largeContent = new Uint8Array(501 * 1024);
      const largeFile = new File([largeContent], 'huge-calendar.ics', {
        type: 'text/calendar',
      });

      fireEvent.change(fileInput, { target: { files: [largeFile] } });

      await waitFor(() => {
        expect(
          screen.getByText('파일 크기가 너무 큽니다. 500KB 이하의 일정 파일(.ics)만 가져올 수 있습니다.')
        ).toBeInTheDocument();
      });
    });
  });

  describe('정상 ICS 파싱 및 미리보기 목록 UX', () => {
    it('유효한 ICS 파일을 업로드하면 파싱 후 이벤트 목록 요약 및 개수를 표시한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });

      // 총 개수 표시 확인 (단일 1개 + 주간 반복 2개 = 총 3개)
      expect(screen.getByText(/총 3개의 일정/i)).toBeInTheDocument();
      expect(screen.getAllByText('정기 워크숍 (종일)')).toHaveLength(2);

      // 종일 일정 뱃지 및 반복 뱃지 확인
      expect(screen.getAllByText('종일')).toHaveLength(2);
      expect(screen.getAllByText('반복')).toHaveLength(2);

      // 기본적으로 전체 일정이 선택되어 있음
      const allCheckbox = screen.getByRole('checkbox', { name: '전체 일정 선택' });
      expect(allCheckbox).toBeChecked();

      const eventList = screen.getByRole('list', { name: '일정 미리보기 목록' });
      const itemCheckboxes = within(eventList).getAllByRole('checkbox');
      expect(itemCheckboxes).toHaveLength(3);
      itemCheckboxes.forEach((cb) => expect(cb).toBeChecked());

      // 가져오기 버튼 활성화 상태
      const confirmButton = screen.getByRole('button', { name: /가져오기/i });
      expect(confirmButton).not.toBeDisabled();
      expect(confirmButton).toHaveTextContent('3개 일정 가져오기');
    });

    it('드래그 앤 드롭으로 파일을 드롭했을 때도 동일하게 파싱된다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const dropzone = screen.getByTestId('ics-dropzone');
      const icsFile = new File([validIcsContent], 'dropped.ics', { type: 'text/calendar' });

      fireEvent.dragOver(dropzone);
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [icsFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });
    });

    it('전체 선택 해제 및 개별 일정 체크박스 토글이 정상 동작한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });

      const allCheckbox = screen.getByRole('checkbox', { name: '전체 일정 선택' });
      const confirmButton = screen.getByRole('button', { name: /가져오기/i });

      // 전체 해제
      fireEvent.click(allCheckbox);
      expect(allCheckbox).not.toBeChecked();

      const eventList = screen.getByRole('list', { name: '일정 미리보기 목록' });
      const itemCheckboxes = within(eventList).getAllByRole('checkbox');
      itemCheckboxes.forEach((cb) => expect(cb).not.toBeChecked());

      // 0개 선택 시 가져오기 버튼 비활성화
      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveTextContent('일정을 선택하세요');

      // 1개만 다시 선택
      fireEvent.click(itemCheckboxes[0]);
      expect(itemCheckboxes[0]).toBeChecked();
      expect(confirmButton).not.toBeDisabled();
      expect(confirmButton).toHaveTextContent('1개 일정 가져오기');

      // 다시 전체 선택 클릭
      fireEvent.click(allCheckbox);
      itemCheckboxes.forEach((cb) => expect(cb).toBeChecked());
      expect(confirmButton).toHaveTextContent('3개 일정 가져오기');
    });

    it('원하는 일정을 선택하고 가져오기 버튼을 클릭하면 onConfirm이 호출된다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });

      // 전체 해제 후 첫 번째 일정만 선택
      const allCheckbox = screen.getByRole('checkbox', { name: '전체 일정 선택' });
      fireEvent.click(allCheckbox);

      const eventList = screen.getByRole('list', { name: '일정 미리보기 목록' });
      const itemCheckboxes = within(eventList).getAllByRole('checkbox');
      fireEvent.click(itemCheckboxes[0]);

      const confirmButton = screen.getByRole('button', { name: /1개 일정 가져오기/i });
      fireEvent.click(confirmButton);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      const [selectedOccurrences, sourceHash] = onConfirm.mock.calls[0];
      expect(selectedOccurrences).toHaveLength(1);
      expect(selectedOccurrences[0].title).toBe('가을 신메뉴 출시 회의');
      expect(sourceHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('드롭존에서 Enter 또는 Space 키 입력 시 파일 선택창이 열린다', () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const dropzone = screen.getByTestId('ics-dropzone');
      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const clickSpy = vi.spyOn(fileInput, 'click');

      fireEvent.keyDown(dropzone, { key: 'Enter' });
      expect(clickSpy).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(dropzone, { key: ' ' });
      expect(clickSpy).toHaveBeenCalledTimes(2);
    });

    it('일정 항목(row) 자체를 클릭해도 체크박스 선택이 토글된다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });

      const eventList = screen.getByRole('list', { name: '일정 미리보기 목록' });
      const itemCheckboxes = within(eventList).getAllByRole('checkbox');
      const listItems = within(eventList).getAllByRole('listitem');

      expect(itemCheckboxes[0]).toBeChecked();

      // row 클릭 -> 선택 해제
      fireEvent.click(listItems[0]);
      expect(itemCheckboxes[0]).not.toBeChecked();

      // 다시 row 클릭 -> 다시 선택
      fireEvent.click(listItems[0]);
      expect(itemCheckboxes[0]).toBeChecked();
    });

    it('window prop이 전달되지 않아도 기본 윈도우로 파싱을 성공적으로 수행한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      // 파싱이 정상적으로 수행되어 결과 화면이 나타나는지 확인
      await waitFor(() => {
        expect(screen.getByText(/총 \d+개의 일정/i)).toBeInTheDocument();
      });
    });

    it('다른 파일 선택 버튼을 누르면 파일 업로드 화면으로 돌아간다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([validIcsContent], 'calendar.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText('가을 신메뉴 출시 회의')).toBeInTheDocument();
      });

      const reselectButton = screen.getByRole('button', { name: /다른 파일 선택/i });
      fireEvent.click(reselectButton);

      expect(screen.getByText(/파일을 끌어다 놓거나/i)).toBeInTheDocument();
      expect(screen.queryByText('가을 신메뉴 출시 회의')).not.toBeInTheDocument();
    });
  });

  describe('파싱 실패 및 비정상 파일 처리', () => {
    it('손상된 ICS 파일 업로드 시 올바른 한국어 에러 메시지를 표시한다', async () => {
      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const corruptedFile = new File(['CORRUPTED CALENDAR NOT ICS'], 'broken.ics', {
        type: 'text/calendar',
      });

      fireEvent.change(fileInput, { target: { files: [corruptedFile] } });

      await waitFor(() => {
        expect(
          screen.getByText('올바른 iCalendar(.ics) 파일 형식이 아닙니다.')
        ).toBeInTheDocument();
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('미지원 반복 규칙이 포함된 파일 업로드 시 친절한 안내 메시지를 표시한다', async () => {
      const unsupportedRruleIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:hourly-evt@test.com',
        'SUMMARY:매시간 알림',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=HOURLY;INTERVAL=1',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([unsupportedRruleIcs], 'hourly.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(
          screen.getByText('지원되지 않는 반복 일정 규칙이 포함되어 있습니다. (일/주/월/년 반복만 지원)')
        ).toBeInTheDocument();
      });
    });

    it('미지원 시간대(floating 등)가 포함된 파일 업로드 시 친절한 안내 메시지를 표시한다', async () => {
      const unsupportedTzIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:floating-evt@test.com',
        'SUMMARY:시간대 없는 일정',
        'DTSTART:20261110T090000',
        'DTEND:20261110T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([unsupportedTzIcs], 'floating.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(
          screen.getByText('지원되지 않거나 명시되지 않은 시간대 정보가 포함되어 있습니다.')
        ).toBeInTheDocument();
      });
    });

    it('조회 기간 내 일정이 0개일 때 빈 상태 안내를 제공한다', async () => {
      const outsideWindowIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:past-evt@test.com',
        'SUMMARY:과거 완료된 행사',
        'DTSTART:20250101T090000Z',
        'DTEND:20250101T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      render(
        <IcsImportModal
          open={true}
          onOpenChange={onOpenChange}
          window={mockWindow}
          onConfirm={onConfirm}
        />
      );

      const fileInput = screen.getByLabelText(/애플 캘린더 일정 파일 선택/i);
      const icsFile = new File([outsideWindowIcs], 'past.ics', { type: 'text/calendar' });

      fireEvent.change(fileInput, { target: { files: [icsFile] } });

      await waitFor(() => {
        expect(screen.getByText(/가져올 수 있는 일정이 없습니다/i)).toBeInTheDocument();
      });
      const confirmButton = screen.getByRole('button', { name: /일정을 선택하세요|가져오기/i });
      expect(confirmButton).toBeDisabled();
    });
  });
});
