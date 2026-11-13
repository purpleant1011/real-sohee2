import ICAL from 'ical.js';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarImportError,
  parseCalendarPreview,
  type CalendarParseWindow,
} from './ics-parser';

describe('parseCalendarPreview', () => {
  const defaultWindow: CalendarParseWindow = {
    startInstant: '2026-11-01T00:00:00.000Z',
    endInstant: '2026-11-30T23:59:59.999Z',
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  };

  describe('단일 일정 및 기본 파싱', () => {
    it('UTC 단일 일정을 정확히 UTC ISO로 파싱하고 허용 필드만 반환한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:evt-utc-1@example.com',
        'SUMMARY:상담 예약',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'ORGANIZER;CN=Owner:mailto:owner@example.com',
        'ATTENDEE;CN=Customer:mailto:client@example.com',
        'DESCRIPTION:개인 비밀 정보 및 메모',
        'LOCATION:서울시 강남구 역삼동',
        'ATTACH:https://malicious.example.com/exploit.ics',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(preview.occurrences).toHaveLength(1);

      const occ = preview.occurrences[0];
      expect(occ.title).toBe('상담 예약');
      expect(occ.recurring).toBe(false);
      expect(occ.id).toMatch(/^[0-9a-f]{64}$/);

      if (occ.kind === 'timed') {
        expect(occ.startsAt).toBe('2026-11-10T09:00:00.000Z');
        expect(occ.endsAt).toBe('2026-11-10T10:00:00.000Z');
      } else {
        expect.fail('timed 일정이어야 함');
      }

      // 허용 필드 외의 개인정보 및 민감 정보가 DTO에 없음을 확인
      const keys = Object.keys(occ).sort();
      expect(keys).toEqual(['endsAt', 'id', 'kind', 'recurring', 'startsAt', 'title']);
    });

    it('종일(all-day) 일정의 배타적 DTEND를 date-only 형식으로 정확히 파싱한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:evt-allday-1@example.com',
        'SUMMARY:매장 정기 휴무',
        'DTSTART;VALUE=DATE:20261115',
        'DTEND;VALUE=DATE:20261117',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(1);
      const occ = preview.occurrences[0];
      expect(occ.title).toBe('매장 정기 휴무');
      expect(occ.recurring).toBe(false);

      if (occ.kind === 'all_day') {
        expect(occ.startDate).toBe('2026-11-15');
        expect(occ.endDateExclusive).toBe('2026-11-17');
      } else {
        expect.fail('all_day 일정이어야 함');
      }
    });

    it('CRLF와 긴 라인 폴딩(folding)된 SUMMARY를 정확히 합쳐서 복원한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:folded-1@example.com',
        'SUMMARY:가나다라마바사아자차카타파하',
        '  긴 제목의 두번째 라인과 추가 텍스트',
        'DTSTART:20261112T010000Z',
        'DTEND:20261112T020000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(1);
      expect(preview.occurrences[0].title).toBe('가나다라마바사아자차카타파하 긴 제목의 두번째 라인과 추가 텍스트');
    });

    it('파일 내부 VTIMEZONE(Asia/Seoul)을 올바르게 해석하여 UTC ISO로 변환한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Apple Inc.//Mac OS X 10.15//EN',
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Seoul',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0900',
        'TZOFFSETTO:+0900',
        'TZNAME:KST',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:tz-seoul-1@example.com',
        'SUMMARY:오후 미팅',
        'DTSTART;TZID=Asia/Seoul:20261110T140000',
        'DTEND;TZID=Asia/Seoul:20261110T153000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(1);
      const occ = preview.occurrences[0];
      if (occ.kind === 'timed') {
        // Asia/Seoul 14:00은 UTC 05:00
        expect(occ.startsAt).toBe('2026-11-10T05:00:00.000Z');
        expect(occ.endsAt).toBe('2026-11-10T06:30:00.000Z');
      } else {
        expect.fail('timed 일정이어야 함');
      }
    });

    it('오프셋 및 소수초가 명시된 윈도우에서도 밀리초 숫자 비교로 정확히 필터링한다', async () => {
      const customWindow: CalendarParseWindow = {
        startInstant: '2026-11-10T18:00:00.000+09:00', // UTC 09:00:00.000Z
        endInstant: '2026-11-10T20:00:00.500+09:00',   // UTC 11:00:00.500Z
        startDate: '2026-11-10',
        endDateExclusive: '2026-11-11',
      };

      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:offset-win-1',
        'SUMMARY:범위 내 일정',
        'DTSTART:20261110T093000Z',
        'DTEND:20261110T103000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:offset-win-2',
        'SUMMARY:범위 외 일정',
        'DTSTART:20261110T120000Z',
        'DTEND:20261110T130000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: customWindow,
      });

      expect(preview.occurrences).toHaveLength(1);
      expect(preview.occurrences[0].title).toBe('범위 내 일정');
    });

    it('길이가 0인 인스턴스가 윈도우 창끝에 걸칠 때 inclusive 규칙으로 정상 포함된다', async () => {
      const zeroDurationIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:zero-duration-1',
        'SUMMARY:창끝 정각 알림',
        'DTSTART:20261130T235959Z',
        'DTEND:20261130T235959Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const windowWithExactEnd: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.000Z',
        endInstant: '2026-11-30T23:59:59.000Z',
        startDate: '2026-11-01',
        endDateExclusive: '2026-12-01',
      };

      const preview = await parseCalendarPreview({
        icsText: zeroDurationIcs,
        window: windowWithExactEnd,
      });

      expect(preview.occurrences).toHaveLength(1);
      expect(preview.occurrences[0].title).toBe('창끝 정각 알림');
    });
  });

  describe('보안 및 윈도우 유효성 검사', () => {
    it('31일을 초과하는 윈도우 요청 시 INVALID_WINDOW 에러를 발생시킨다', async () => {
      const invalidWindow: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.000Z',
        endInstant: '2026-12-10T00:00:00.000Z', // 39일
        startDate: '2026-11-01',
        endDateExclusive: '2026-12-10',
      };

      const icsText = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR';
      await expect(
        parseCalendarPreview({ icsText, window: invalidWindow })
      ).rejects.toThrowError(CalendarImportError);

      try {
        await parseCalendarPreview({ icsText, window: invalidWindow });
      } catch (err) {
        expect((err as CalendarImportError).code).toBe('INVALID_WINDOW');
      }
    });

    it('DTSTART가 없는 VEVENT는 INVALID_ICS 에러를 발생시킨다', async () => {
      const noDtstartIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:missing-dtstart-1',
        'SUMMARY:DTSTART 누락',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: noDtstartIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('잘못된 UNTIL 날짜 형식은 vendor 원문 노출 없이 INVALID_ICS 에러로 변환된다', async () => {
      const badUntilIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:bad-until-1',
        'SUMMARY:잘못된 UNTIL',
        'DTSTART:20261110T090000Z',
        'RRULE:FREQ=DAILY;UNTIL=MALFORMED_DATE_XYZ',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText: badUntilIcs, window: defaultWindow });
        expect.fail('에러가 발생해야 함');
      } catch (err) {
        const importErr = err as CalendarImportError;
        expect(importErr.code).toBe('INVALID_ICS');
        expect(importErr.message).not.toContain('MALFORMED_DATE_XYZ');
      }
    });

    it('파일에 정의되지 않은 외부 TZID나 floating time은 UNSUPPORTED_TIMEZONE 에러를 발생시키며 원문을 노출하지 않는다', async () => {
      const icsWithoutTz = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:missing-tz@example.com',
        'SUMMARY:알 수 없는 타임존',
        'DTSTART;TZID=America/Los_Angeles:20261110T090000',
        'DTEND;TZID=America/Los_Angeles:20261110T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText: icsWithoutTz, window: defaultWindow });
        expect.fail('에러가 발생해야 함');
      } catch (err) {
        const importErr = err as CalendarImportError;
        expect(importErr.code).toBe('UNSUPPORTED_TIMEZONE');
        // 에러 메시지에 원문 TZID나 SUMMARY가 포함되지 않음을 검증
        expect(importErr.message).not.toContain('America/Los_Angeles');
        expect(importErr.message).not.toContain('missing-tz');
      }
    });

    it('빈 UID 또는 동일 UID 복수 master는 INVALID_ICS 에러를 발생시킨다', async () => {
      const emptyUidIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'SUMMARY:UID 없음',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: emptyUidIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );

      const dupMasterIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:dup-1',
        'SUMMARY:마스터 1',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:dup-1',
        'SUMMARY:마스터 2 (중복)',
        'DTSTART:20261110T110000Z',
        'DTEND:20261110T120000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: dupMasterIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('비반복 master에 RECURRENCE-ID 예외가 지정되면 명시적 INVALID_ICS 에러를 던진다', async () => {
      const nonRecurringWithExcIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:non-rec-1',
        'SUMMARY:단일 마스터',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:non-rec-1',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:비반복에 달린 예외',
        'DTSTART:20261110T110000Z',
        'DTEND:20261110T120000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: nonRecurringWithExcIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('1MiB 초과 입력 시 TOO_LARGE 에러를 발생시킨다', async () => {
      const largeIcs = 'BEGIN:VCALENDAR\r\n' + 'X-PADDING:'.padEnd(1024 * 1024 + 10, 'A') + '\r\nEND:VCALENDAR';
      await expect(
        parseCalendarPreview({ icsText: largeIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'TOO_LARGE' })
      );
    });

    it('단일 논리 라인이 8192자를 초과하면 LIMIT_EXCEEDED 에러를 발생시킨다', async () => {
      const longLineIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:longline-1',
        'SUMMARY:' + 'A'.repeat(8193),
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: longLineIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' })
      );
    });

    it('고비용 RRULE (SECONDLY, MINUTELY, HOURLY)은 UNSUPPORTED_RECURRENCE 에러로 명시 거부한다', async () => {
      const minutelyIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:minutely-1',
        'SUMMARY:분 단위 폭주',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T090100Z',
        'RRULE:FREQ=MINUTELY;INTERVAL=1',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText: minutelyIcs, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
      );
    });
  });

  describe('반복 일정, 예외 및 취소 처리', () => {
    it('주간(weekly) 반복 일정을 윈도우 내에서만 정확히 전개한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:weekly-1@example.com',
        'SUMMARY:매주 화요일 미팅',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      // 11/03, 11/10, 11/17, 11/24 (4개)
      expect(preview.occurrences).toHaveLength(4);
      expect(preview.occurrences.every((o) => o.recurring)).toBe(true);
      expect(preview.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-03T09:00:00.000Z',
        '2026-11-10T09:00:00.000Z',
        '2026-11-17T09:00:00.000Z',
        '2026-11-24T09:00:00.000Z',
      ]);
    });

    it('WEEKLY 11월 창에서 11/08 인스턴스를 12/05(창 밖)로 이동해도 11/15, 11/22, 11/29가 정상 반환된다', async () => {
      const moveOutOfWindowIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:weekly-move-out-1',
        'SUMMARY:주간 정기 회의',
        'DTSTART:20261101T090000Z',
        'DTEND:20261101T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=5', // 11/01, 11/08, 11/15, 11/22, 11/29
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly-move-out-1',
        'RECURRENCE-ID:20261108T090000Z',
        'SUMMARY:12월로 미뤄진 회의',
        'DTSTART:20261205T090000Z', // 창 밖으로 이동
        'DTEND:20261205T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText: moveOutOfWindowIcs,
        window: defaultWindow,
      });

      // 11/01, 11/15, 11/22, 11/29 (총 4개 정상 수집, 11/08->12/05는 창 밖이므로 제외)
      expect(preview.occurrences).toHaveLength(4);
      expect(preview.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-01T09:00:00.000Z',
        '2026-11-15T09:00:00.000Z',
        '2026-11-22T09:00:00.000Z',
        '2026-11-29T09:00:00.000Z',
      ]);
    });

    it('창 종료 이후(12/10) 인스턴스를 창 안(11/15)으로 앞당긴 미래 예외는 검증 불가능하므로 UNSUPPORTED_RECURRENCE를 던진다', async () => {
      const moveIntoWindowIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:weekly-move-in-1',
        'SUMMARY:격주 회의',
        'DTSTART:20261126T090000Z',
        'DTEND:20261126T100000Z',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3', // 11/26, 12/10, 12/24
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly-move-in-1',
        'RECURRENCE-ID:20261210T090000Z',
        'SUMMARY:11월로 당겨진 회의',
        'DTSTART:20261115T090000Z', // 창 안으로 이동
        'DTEND:20261115T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({
          icsText: moveIntoWindowIcs,
          window: defaultWindow,
        })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
      );
    });

    it('EXDATE로 제외된 날짜에 RECURRENCE-ID 예외가 지정되면 INVALID_ICS를 던진다', async () => {
      const exdateConflictIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:exdate-conflict-1',
        'SUMMARY:주간 미팅',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'EXDATE:20261110T090000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:exdate-conflict-1',
        'RECURRENCE-ID:20261110T090000Z', // EXDATE와 동일한 날짜
        'SUMMARY:제외된 날짜의 예외',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({
          icsText: exdateConflictIcs,
          window: defaultWindow,
        })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('규칙에 매칭되지 않는 orphan RECURRENCE-ID 예외는 INVALID_ICS를 던진다', async () => {
      const orphanExcIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:orphan-exc-1',
        'SUMMARY:주간 미팅 (화요일)',
        'DTSTART:20261103T090000Z', // 화요일
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:orphan-exc-1',
        'RECURRENCE-ID:20261105T090000Z', // 목요일 (규칙상 없는 날짜)
        'SUMMARY:규칙에 없는 날짜의 예외',
        'DTSTART:20261105T140000Z',
        'DTEND:20261105T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({
          icsText: orphanExcIcs,
          window: defaultWindow,
        })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('COUNT 이후의 RECURRENCE-ID 예외는 INVALID_ICS를 던진다', async () => {
      const pastCountExcIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:past-count-1',
        'SUMMARY:2회 미팅',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=2', // 11/03, 11/10
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:past-count-1',
        'RECURRENCE-ID:20261117T090000Z', // 3회차 (COUNT 초과)
        'SUMMARY:COUNT 초과 예외',
        'DTSTART:20261117T140000Z',
        'DTEND:20261117T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({
          icsText: pastCountExcIcs,
          window: defaultWindow,
        })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('TZID DTSTART와 UTC RECURRENCE-ID가 정규화되어 정확히 매칭되고 이중 반환되지 않는다', async () => {
      const tzidMatchIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTIMEZONE',
        'TZID:Asia/Seoul',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0900',
        'TZOFFSETTO:+0900',
        'TZNAME:KST',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:tzid-utc-match-1',
        'SUMMARY:정기 미팅',
        'DTSTART;TZID=Asia/Seoul:20261103T180000', // UTC 09:00:00Z
        'DTEND;TZID=Asia/Seoul:20261103T190000',
        'RRULE:FREQ=WEEKLY;COUNT=2', // 11/03, 11/10
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:tzid-utc-match-1',
        'RECURRENCE-ID:20261110T090000Z', // UTC로 지정된 2회차 (Seoul 18:00)
        'SUMMARY:정기 미팅 (시간변경)',
        'DTSTART;TZID=Asia/Seoul:20261110T200000', // UTC 11:00:00Z
        'DTEND;TZID=Asia/Seoul:20261110T210000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText: tzidMatchIcs,
        window: defaultWindow,
      });

      // 11/03 09:00Z (마스터), 11/10 11:00Z (예외 반영) -> 총 2개 (이중 반환 없이 예외 우선)
      expect(preview.occurrences).toHaveLength(2);
      expect(preview.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-03T09:00:00.000Z',
        '2026-11-10T11:00:00.000Z',
      ]);
    });

    it('DTEND가 손상된 단일 VEVENT는 vendor 원문 전파 없이 INVALID_ICS 에러를 던진다', async () => {
      const corruptDtendIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:corrupted-dtend-1',
        'SUMMARY:손상된 DTEND',
        'DTSTART:20261110T090000Z',
        'DTEND:GARBAGE_INVALID_TIMESTAMP',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({
          icsText: corruptDtendIcs,
          window: defaultWindow,
        });
        expect.fail('에러가 발생해야 함');
      } catch (err) {
        const importErr = err as CalendarImportError;
        expect(importErr.code).toBe('INVALID_ICS');
        expect(importErr.message).not.toContain('GARBAGE');
      }
    });

    it('1999년부터 시작하는 DAILY 무한반복은 10000 step 파일 합계 상한을 초과하여 LIMIT_EXCEEDED를 던진다', async () => {
      const ancientDailyIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:daily-since-1999',
        'SUMMARY:1999년부터 매일',
        'DTSTART:19990101T080000Z',
        'DTEND:19990101T090000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({
          icsText: ancientDailyIcs,
          window: defaultWindow,
        })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' })
      );
    });

    it('DTSTART가 과거(2025년)인 DAILY 무한반복도 10000 step 안에서 2026년 11월 30개 인스턴스를 정확히 반환하고 창 종료 시 즉시 중단한다', async () => {
      const pastDailyIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:daily-since-2025',
        'SUMMARY:매일 영업 준비',
        'DTSTART:20250101T080000Z',
        'DTEND:20250101T090000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText: pastDailyIcs,
        window: defaultWindow,
      });

      // 2026년 11월 1일 ~ 30일 (총 30개)
      expect(preview.occurrences).toHaveLength(30);
      expect(preview.occurrences[0].kind === 'timed' && preview.occurrences[0].startsAt).toBe(
        '2026-11-01T08:00:00.000Z'
      );
      expect(
        preview.occurrences[29].kind === 'timed' && preview.occurrences[29].startsAt
      ).toBe('2026-11-30T08:00:00.000Z');
    });

    it('EXDATE로 지정된 특정 반복 인스턴스는 결과에서 제외된다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:weekly-exdate-1@example.com',
        'SUMMARY:화요 미팅',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'EXDATE:20261110T090000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      // 11/10 제외 -> 11/03, 11/17, 11/24
      expect(preview.occurrences).toHaveLength(3);
      expect(preview.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-03T09:00:00.000Z',
        '2026-11-17T09:00:00.000Z',
        '2026-11-24T09:00:00.000Z',
      ]);
    });

    it('RECURRENCE-ID로 시간이 변경된 예외(exception) 일정을 올바르게 반영한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:weekly-mod-1@example.com',
        'SUMMARY:정기 미팅',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly-mod-1@example.com',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:정기 미팅 (시간변경)',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(3);
      const modOcc = preview.occurrences.find(
        (o) => o.kind === 'timed' && o.startsAt === '2026-11-10T14:00:00.000Z'
      );
      expect(modOcc).toBeDefined();
      expect(modOcc?.title).toBe('정기 미팅 (시간변경)');
    });

    it('master가 CANCELLED인 경우 해당 UID의 모든 예외를 포함하여 전체가 제외된다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:cancelled-master-1',
        'SUMMARY:취소된 정기 미팅',
        'STATUS:CANCELLED',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:cancelled-master-1',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:취소된 마스터의 수정 예외',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      // 마스터가 취소되었으므로 예외를 포함한 모든 인스턴스 제외 (0개)
      expect(preview.occurrences).toHaveLength(0);
    });

    it('개별 예외만 STATUS:CANCELLED인 경우 해당 인스턴스만 제외된다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:weekly-cancel-1@example.com',
        'SUMMARY:주간 회의',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly-cancel-1@example.com',
        'RECURRENCE-ID:20261110T090000Z',
        'STATUS:CANCELLED',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      // weekly-cancel 중 11/10 제외 -> 11/03, 11/17 (2개만)
      expect(preview.occurrences).toHaveLength(2);
      expect(preview.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-03T09:00:00.000Z',
        '2026-11-17T09:00:00.000Z',
      ]);
    });
  });

  describe('파일별 전역 오염 격리', () => {
    it('동일한 TZID가 서로 다른 offset을 가질 때 연속 파싱에서 이전 파일의 정의가 오염되지 않는다', async () => {
      // 파일 1: CustomTZ = +0200
      const ics1 = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTIMEZONE',
        'TZID:CustomTZ',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0200',
        'TZOFFSETTO:+0200',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:custom-1',
        'SUMMARY:파일1',
        'DTSTART;TZID=CustomTZ:20261110T120000',
        'DTEND;TZID=CustomTZ:20261110T130000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      // 파일 2: 동일 이름 CustomTZ이지만 +0800
      const ics2 = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VTIMEZONE',
        'TZID:CustomTZ',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0800',
        'TZOFFSETTO:+0800',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:custom-2',
        'SUMMARY:파일2',
        'DTSTART;TZID=CustomTZ:20261110T120000',
        'DTEND;TZID=CustomTZ:20261110T130000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview1 = await parseCalendarPreview({ icsText: ics1, window: defaultWindow });
      const preview2 = await parseCalendarPreview({ icsText: ics2, window: defaultWindow });

      const occ1 = preview1.occurrences[0];
      const occ2 = preview2.occurrences[0];

      // 파일 1: 12:00 +02:00 -> 10:00:00Z
      expect(occ1.kind === 'timed' && occ1.startsAt).toBe('2026-11-10T10:00:00.000Z');
      // 파일 2: 12:00 +08:00 -> 04:00:00Z
      expect(occ2.kind === 'timed' && occ2.startsAt).toBe('2026-11-10T04:00:00.000Z');
    });
  });

  describe('라운드 4: 사전 종료성 오라클 (Worker 2초 내 거부 증명)', () => {
    type WorkerOutcome =
      | { status: 'RESOLVED'; count: number; starts: string[] }
      | { status: 'REJECTED'; code?: string; message?: string };

    function runInWorker(
      icsText: string,
      window: CalendarParseWindow,
      timeoutMs = 2000
    ): Promise<WorkerOutcome> {
      return new Promise((resolve, reject) => {
        const script = `
          const { parentPort, workerData } = require('node:worker_threads');
          const createJiti = require('jiti');
          const jiti = createJiti(process.cwd() + '/index.js');
          const { parseCalendarPreview } = jiti('./src/features/marketing-connectors/imports/ics-parser.ts');
          (async () => {
            try {
              const res = await parseCalendarPreview(workerData.input);
              parentPort.postMessage({
                status: 'RESOLVED',
                count: res.occurrences.length,
                starts: res.occurrences.map((o) => o.startsAt || o.startDate),
              });
            } catch (err) {
              parentPort.postMessage({ status: 'REJECTED', code: err && err.code, message: err && err.message });
            }
          })();
        `;
        const worker = new Worker(script, { eval: true, workerData: { input: { icsText, window } } });
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          void worker.terminate().finally(() => reject(new Error(`HANG: worker exceeded ${timeoutMs}ms`)));
        }, timeoutMs);
        worker.on('message', (msg: WorkerOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void worker.terminate();
          resolve(msg);
        });
        worker.on('error', (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    function singleRule(rrule: string, dtstart: string): string {
      return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:oracle-worker',
        'SUMMARY:종료성',
        `DTSTART:${dtstart}`,
        'DTEND:' + dtstart.replace('090000', '100000'),
        `RRULE:${rrule}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    }

    // 2026-11-09 월요일 / 2026-11-10 화요일
    const hangingCases: Array<[string, string, string]> = [
      ['DAILY INTERVAL=7 BYDAY=TU, DTSTART 월요일', 'FREQ=DAILY;INTERVAL=7;BYDAY=TU', '20261109T090000Z'],
      ['DAILY INTERVAL=14 BYDAY=MO, DTSTART 화요일', 'FREQ=DAILY;INTERVAL=14;BYDAY=MO', '20261110T090000Z'],
      ['DAILY INTERVAL=14 BYDAY=TU,TH, DTSTART 월요일', 'FREQ=DAILY;INTERVAL=14;BYDAY=TU,TH', '20261109T090000Z'],
      ['MONTHLY INTERVAL=12 BYMONTH=2 BYMONTHDAY=31, 시작 2월', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=2;BYMONTHDAY=31', '20260201T090000Z'],
      ['MONTHLY INTERVAL=12 BYMONTH=3, 시작 2월', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=3', '20260201T090000Z'],
      ['MONTHLY INTERVAL=6 BYMONTH=3,9, 시작 1월', 'FREQ=MONTHLY;INTERVAL=6;BYMONTH=3,9', '20260115T090000Z'],
      ['MONTHLY INTERVAL=24 BYMONTH=6, 시작 1월', 'FREQ=MONTHLY;INTERVAL=24;BYMONTH=6', '20260115T090000Z'],
      ['YEARLY INTERVAL=2 2/29, 시작 홀수 해', 'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29', '20250101T090000Z'],
      ['YEARLY INTERVAL=4 2/29, 시작 2026', 'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29', '20260101T090000Z'],
    ];

    it.each(hangingCases)(
      '정지 위험 규칙은 Worker 에서 2초 안에 UNSUPPORTED_RECURRENCE 로 거부된다: %s',
      async (_name, rrule, dtstart) => {
        const out = await runInWorker(singleRule(rrule, dtstart), defaultWindow, 2000);
        expect(out.status).toBe('REJECTED');
        if (out.status === 'REJECTED') {
          expect(out.code).toBe('UNSUPPORTED_RECURRENCE');
          expect(out.message ?? '').not.toContain('oracle-worker');
        }
      },
      6000
    );

    it('도달 가능한 규칙은 그대로 통과하며 올바른 인스턴스를 돌려준다', async () => {
      // DAILY INTERVAL=7 BYDAY=MO, DTSTART 월요일 -> 11/09, 11/16, 11/23, 11/30
      const weekly = await parseCalendarPreview({
        icsText: singleRule('FREQ=DAILY;INTERVAL=7;BYDAY=MO', '20261109T090000Z'),
        window: defaultWindow,
      });
      expect(weekly.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-09T09:00:00.000Z',
        '2026-11-16T09:00:00.000Z',
        '2026-11-23T09:00:00.000Z',
        '2026-11-30T09:00:00.000Z',
      ]);

      // MONTHLY BYMONTH=2 BYMONTHDAY=29 (달력상 유효) -> 2028-02-29 한 번
      const feb2028: CalendarParseWindow = {
        startInstant: '2028-02-01T00:00:00.000Z',
        endInstant: '2028-02-29T23:59:59.999Z',
        startDate: '2028-02-01',
        endDateExclusive: '2028-03-01',
      };
      const leap = await parseCalendarPreview({
        icsText: singleRule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29', '20260201T090000Z'),
        window: feb2028,
      });
      expect(leap.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2028-02-29T09:00:00.000Z',
      ]);

      // MONTHLY BYMONTHDAY=1,15 / -1
      const monthly = await parseCalendarPreview({
        icsText: singleRule('FREQ=MONTHLY;BYMONTHDAY=1,15,-1', '20261101T090000Z'),
        window: defaultWindow,
      });
      expect(monthly.occurrences.map((o) => o.kind === 'timed' && o.startsAt)).toEqual([
        '2026-11-01T09:00:00.000Z',
        '2026-11-15T09:00:00.000Z',
        '2026-11-30T09:00:00.000Z',
      ]);
    });
  });

  describe('라운드 4: 예외 매칭 키 일치 / 중복 / RANGE / vendor 접근자 변환', () => {
    const TZ_NY = [
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
    const TZ_SEOUL = [
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Seoul',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:KST',
      'END:STANDARD',
      'END:VTIMEZONE',
    ];

    function withException(opts: {
      masterStart: string;
      masterEnd: string;
      recurrenceId: string;
      excStart: string;
      excEnd: string;
      status?: string;
      extraException?: string[];
    }): string {
      return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        ...TZ_NY,
        ...TZ_SEOUL,
        'BEGIN:VEVENT',
        'UID:sensitive-uid-xyz',
        'SUMMARY:SENSITIVE-SUMMARY',
        opts.masterStart,
        opts.masterEnd,
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:sensitive-uid-xyz',
        opts.recurrenceId,
        opts.excStart,
        opts.excEnd,
        ...(opts.status ? [`STATUS:${opts.status}`] : []),
        'END:VEVENT',
        ...(opts.extraException ?? []),
        'END:VCALENDAR',
      ].join('\r\n');
    }

    async function expectRejected(icsText: string, code: string): Promise<void> {
      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.fail('에러가 발생해야 함');
      } catch (err) {
        expect(err).toBeInstanceOf(CalendarImportError);
        const e = err as CalendarImportError;
        expect(e.code).toBe(code);
        expect(e.message).not.toContain('sensitive-uid-xyz');
        expect(e.message).not.toContain('SENSITIVE');
        expect(e.message).not.toContain('America/New_York');
        expect(e.message).not.toContain('Asia/Seoul');
      }
    }

    const nyMaster = {
      masterStart: 'DTSTART;TZID=America/New_York:20261103T090000',
      masterEnd: 'DTEND;TZID=America/New_York:20261103T100000',
    };

    it('NY 마스터 + Seoul TZID RECURRENCE-ID(같은 순간)는 vendor 가 매칭하지 못하므로 UNSUPPORTED_RECURRENCE 로 거부한다', async () => {
      // 11/03 09:00 NY(-05:00) == 14:00Z == 23:00 Seoul
      await expectRejected(
        withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=Asia/Seoul:20261103T230000',
          excStart: 'DTSTART;TZID=Asia/Seoul:20261103T230000',
          excEnd: 'DTEND;TZID=Asia/Seoul:20261104T000000',
          status: 'CANCELLED',
        }),
        'UNSUPPORTED_RECURRENCE'
      );
    });

    it('벽시계 문자열만 같은 다른 TZID(NY 마스터 vs Seoul id 09:00)도 우연 매칭 없이 거부한다', async () => {
      await expectRejected(
        withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=Asia/Seoul:20261103T090000',
          excStart: 'DTSTART;TZID=Asia/Seoul:20261103T090000',
          excEnd: 'DTEND;TZID=Asia/Seoul:20261103T100000',
        }),
        'UNSUPPORTED_RECURRENCE'
      );
    });

    it('UTC 마스터 + TZID RECURRENCE-ID 는 거부한다', async () => {
      await expectRejected(
        withException({
          masterStart: 'DTSTART:20261103T140000Z',
          masterEnd: 'DTEND:20261103T150000Z',
          recurrenceId: 'RECURRENCE-ID;TZID=Asia/Seoul:20261103T230000',
          excStart: 'DTSTART;TZID=Asia/Seoul:20261103T230000',
          excEnd: 'DTEND;TZID=Asia/Seoul:20261104T000000',
          status: 'CANCELLED',
        }),
        'UNSUPPORTED_RECURRENCE'
      );
    });

    it('종일(date) 마스터 + date-time RECURRENCE-ID 는 거부한다', async () => {
      await expectRejected(
        withException({
          masterStart: 'DTSTART;VALUE=DATE:20261103',
          masterEnd: 'DTEND;VALUE=DATE:20261104',
          recurrenceId: 'RECURRENCE-ID:20261103T000000Z',
          excStart: 'DTSTART:20261103T000000Z',
          excEnd: 'DTEND:20261103T010000Z',
        }),
        'UNSUPPORTED_RECURRENCE'
      );
    });

    it('안전한 표현 조합(동일 TZID, UTC id, 종일 date↔date)은 계속 허용된다', async () => {
      const sameTz = await parseCalendarPreview({
        icsText: withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=America/New_York:20261110T090000',
          excStart: 'DTSTART;TZID=America/New_York:20261110T090000',
          excEnd: 'DTEND;TZID=America/New_York:20261110T100000',
          status: 'CANCELLED',
        }),
        window: defaultWindow,
      });
      expect(sameTz.occurrences).toHaveLength(2); // 11/03, 11/17

      const utcId = await parseCalendarPreview({
        icsText: withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID:20261110T140000Z',
          excStart: 'DTSTART:20261110T140000Z',
          excEnd: 'DTEND:20261110T150000Z',
          status: 'CANCELLED',
        }),
        window: defaultWindow,
      });
      expect(utcId.occurrences).toHaveLength(2);

      const allDay = await parseCalendarPreview({
        icsText: withException({
          masterStart: 'DTSTART;VALUE=DATE:20261103',
          masterEnd: 'DTEND;VALUE=DATE:20261104',
          recurrenceId: 'RECURRENCE-ID;VALUE=DATE:20261110',
          excStart: 'DTSTART;VALUE=DATE:20261110',
          excEnd: 'DTEND;VALUE=DATE:20261111',
          status: 'CANCELLED',
        }),
        window: defaultWindow,
      });
      expect(allDay.occurrences).toHaveLength(2);
    });

    it('같은 RECURRENCE-ID 예외가 2개면 vendor 덮어쓰기로 하나가 소실되지 않도록 INVALID_ICS 로 거부한다', async () => {
      await expectRejected(
        withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=America/New_York:20261110T090000',
          excStart: 'DTSTART;TZID=America/New_York:20261110T130000',
          excEnd: 'DTEND;TZID=America/New_York:20261110T140000',
          extraException: [
            'BEGIN:VEVENT',
            'UID:sensitive-uid-xyz',
            'RECURRENCE-ID;TZID=America/New_York:20261110T090000',
            'DTSTART;TZID=America/New_York:20261110T150000',
            'DTEND;TZID=America/New_York:20261110T160000',
            'END:VEVENT',
          ],
        }),
        'INVALID_ICS'
      );
    });

    it('표기만 다른 같은 순간 중복 예외(TZID 와 UTC)도 INVALID_ICS 로 거부한다', async () => {
      await expectRejected(
        withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=America/New_York:20261110T090000',
          excStart: 'DTSTART;TZID=America/New_York:20261110T130000',
          excEnd: 'DTEND;TZID=America/New_York:20261110T140000',
          extraException: [
            'BEGIN:VEVENT',
            'UID:sensitive-uid-xyz',
            'RECURRENCE-ID:20261110T140000Z',
            'DTSTART:20261110T200000Z',
            'DTEND:20261110T210000Z',
            'END:VEVENT',
          ],
        }),
        'INVALID_ICS'
      );
    });

    it('RANGE=THISANDFUTURE 예외는 UNSUPPORTED_RECURRENCE 로 명시 거부한다', async () => {
      await expectRejected(
        withException({
          ...nyMaster,
          recurrenceId: 'RECURRENCE-ID;TZID=America/New_York;RANGE=THISANDFUTURE:20261110T090000',
          excStart: 'DTSTART;TZID=America/New_York:20261110T100000',
          excEnd: 'DTEND;TZID=America/New_York:20261110T110000',
        }),
        'UNSUPPORTED_RECURRENCE'
      );
    });

    it('다른 UID 의 RECURRENCE-ID 예외가 같은 순간의 다른 UID 인스턴스에 적용되지 않는다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:series-a',
        'SUMMARY:A',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series-b',
        'SUMMARY:B',
        'DTSTART:20261111T090000Z',
        'DTEND:20261111T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=2',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:series-b',
        'RECURRENCE-ID:20261111T090000Z',
        'STATUS:CANCELLED',
        'DTSTART:20261111T090000Z',
        'DTEND:20261111T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({ icsText, window: defaultWindow });
      const titles = preview.occurrences.map((o) => `${o.title}@${o.kind === 'timed' ? o.startsAt : ''}`);
      expect(titles).toEqual([
        'A@2026-11-10T09:00:00.000Z',
        'A@2026-11-11T09:00:00.000Z',
        'A@2026-11-12T09:00:00.000Z',
        'B@2026-11-18T09:00:00.000Z',
      ]);
    });

    it('vendor 접근자(summary 등)가 던지는 원문 오류는 고정 메시지 CalendarImportError 로 변환된다', async () => {
      const original = ICAL.Component.prototype.getFirstPropertyValue;
      const spy = vi
        .spyOn(ICAL.Component.prototype, 'getFirstPropertyValue')
        .mockImplementation(function (this: ICAL.Component, name?: string) {
          if (name === 'summary') {
            throw new Error('VENDOR-LEAK sensitive-uid-xyz SENSITIVE-SUMMARY');
          }
          return original.call(this, name);
        });
      try {
        await parseCalendarPreview({
          icsText: [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'BEGIN:VEVENT',
            'UID:sensitive-uid-xyz',
            'SUMMARY:SENSITIVE-SUMMARY',
            'DTSTART:20261110T090000Z',
            'DTEND:20261110T100000Z',
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n'),
          window: defaultWindow,
        });
        expect.fail('에러가 발생해야 함');
      } catch (err) {
        expect(err).toBeInstanceOf(CalendarImportError);
        const e = err as CalendarImportError;
        expect(e.code).toBe('INVALID_ICS');
        expect(e.message).not.toContain('VENDOR-LEAK');
        expect(e.message).not.toContain('sensitive-uid-xyz');
      } finally {
        spy.mockRestore();
      }
    });
  });
});
