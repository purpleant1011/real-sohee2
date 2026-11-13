import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import {
  CalendarImportError,
  parseCalendarPreview,
  type CalendarParseWindow,
  type CalendarPreview,
} from './ics-parser';

/**
 * Worker thread에서 parseCalendarPreview를 실행하여 2초 내 완료 및 DoS/hang 방지 검증
 */
function runParserInWorkerWithTimeout(
  icsText: string,
  window: CalendarParseWindow,
  timeoutMs = 2000
): Promise<{
  status: 'RESOLVED';
  result: CalendarPreview;
} | {
  status: 'REJECTED';
  code?: string;
  message?: string;
}> {
  return new Promise((resolve, reject) => {
    const workerScript = `
      const { parentPort, workerData } = require('node:worker_threads');
      const createJiti = require('jiti');
      const jiti = createJiti(process.cwd() + '/index.js');
      const { parseCalendarPreview } = jiti('./src/features/marketing-connectors/imports/ics-parser.ts');

      (async () => {
        try {
          const res = await parseCalendarPreview(workerData.input);
          parentPort.postMessage({ status: 'RESOLVED', result: res });
        } catch (err) {
          parentPort.postMessage({
            status: 'REJECTED',
            code: err && err.code,
            message: err && err.message,
          });
        }
      })();
    `;

    const worker = new Worker(workerScript, {
      eval: true,
      workerData: {
        input: { icsText, window },
      },
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate().finally(() => {
          reject(
            new Error(
              `Worker execution timed out after ${timeoutMs}ms (DoS / hang detected)`
            )
          );
        });
      }
    }, timeoutMs);

    worker.on('message', (msg) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(msg);
      }
    });

    worker.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        reject(err);
      }
    });
  });
}

describe('ICS Window Safety & Regression Suite (독립 Sonnet 리뷰 결함 재현)', () => {
  const defaultWindow: CalendarParseWindow = {
    startInstant: '2026-11-01T00:00:00.000Z',
    endInstant: '2026-11-30T23:59:59.999Z',
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  };

  describe('(1) 과거 시작 무한 반복 + 미래 윈도우', () => {
    it('DTSTART:20250101T090000Z + RRULE:FREQ=DAILY 무한 반복 시 2026-11 인스턴스를 정확히 반환하거나 LIMIT_EXCEEDED 오류만 허용하며 빈 성공/부분 성공은 금지된다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:infinite-daily-2025@example.com',
        'SUMMARY:매일 스탠드업',
        'DTSTART:20250101T090000Z',
        'DTEND:20250101T100000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      let preview: CalendarPreview | null = null;
      let error: unknown = null;

      try {
        preview = await parseCalendarPreview({
          icsText,
          window: defaultWindow,
        });
      } catch (err) {
        error = err;
      }

      if (error) {
        expect(error).toBeInstanceOf(CalendarImportError);
        expect((error as CalendarImportError).code).toBe('LIMIT_EXCEEDED');
      } else {
        expect(preview).not.toBeNull();
        expect(preview!.occurrences.length).toBe(30);
        expect(
          preview!.occurrences.every(
            (o) => o.kind === 'timed' && o.startsAt.startsWith('2026-11-')
          )
        ).toBe(true);
      }
    });
  });

  describe('(2) 윈도우 안 반복 100개 초과 시 LIMIT_EXCEEDED 및 105 임의 cutoff truncation 금지', () => {
    it('윈도우 내 반복 인스턴스가 100개를 초과하면 LIMIT_EXCEEDED를 던져야 하며 임의 cutoff로 조용한 성공을 반환해서는 안 된다', async () => {
      const vevents: string[] = [];
      for (let i = 1; i <= 4; i++) {
        vevents.push(
          [
            'BEGIN:VEVENT',
            `UID:bulk-daily-${i}@example.com`,
            `SUMMARY:대량 데일리 ${i}`,
            'DTSTART:20261101T090000Z',
            'DTEND:20261101T100000Z',
            'RRULE:FREQ=DAILY',
            'END:VEVENT',
          ].join('\r\n')
        );
      }

      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        ...vevents,
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' })
      );
    });

    it('과거 시작 반복 일정이 105 임의 cutoff로 인해 윈도우 중반에서 조용히 잘려(silent truncation) 부분 데이터만 반환되어서는 안 된다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:cutoff-daily-2026@example.com',
        'SUMMARY:매일 연속 일정',
        'DTSTART:20260801T090000Z',
        'DTEND:20260801T100000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      let preview: CalendarPreview | null = null;
      let error: unknown = null;

      try {
        preview = await parseCalendarPreview({
          icsText,
          window: defaultWindow,
        });
      } catch (err) {
        error = err;
      }

      if (error) {
        expect(error).toBeInstanceOf(CalendarImportError);
        expect((error as CalendarImportError).code).toBe('LIMIT_EXCEEDED');
      } else {
        expect(preview).not.toBeNull();
        expect(preview!.occurrences.length).toBe(30);
      }
    });
  });

  describe('(3) 창 offset +09:00 / 소수초 경계 이벤트의 숫자 시각 비교', () => {
    it('startInstant/endInstant에 non-UTC offset(+09:00)이 주어졌을 때 문자열 사전순 비교가 아닌 숫자 시각(ms) 비교로 정확히 포함해야 한다', async () => {
      const kstWindow: CalendarParseWindow = {
        startInstant: '2026-11-01T09:00:00+09:00',
        endInstant: '2026-11-01T18:00:00+09:00',
        startDate: '2026-11-01',
        endDateExclusive: '2026-11-02',
      };

      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:offset-inside@example.com',
        'SUMMARY:KST 오전 미팅 (포함 대상)',
        'DTSTART:20261101T010000Z',
        'DTEND:20261101T020000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:offset-outside@example.com',
        'SUMMARY:KST 저녁 미팅 (배제 대상)',
        'DTSTART:20261101T090000Z',
        'DTEND:20261101T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: kstWindow,
      });

      expect(preview.occurrences).toHaveLength(1);
      expect(preview.occurrences[0].title).toBe('KST 오전 미팅 (포함 대상)');
    });

    it('소수초(millisecond) 및 경계 일치 이벤트가 숫자 시각 비교로 정확히 판정되어야 한다', async () => {
      const windowExact: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.500Z',
        endInstant: '2026-11-01T01:00:00.500Z',
        startDate: '2026-11-01',
        endDateExclusive: '2026-11-02',
      };

      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:ms-boundary-inside@example.com',
        'SUMMARY:소수초 오버랩 이벤트',
        'DTSTART:20261101T000000Z',
        'DTEND:20261101T000001Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:ms-boundary-outside@example.com',
        'SUMMARY:소수초 범위 밖 이벤트',
        'DTSTART:20261101T010001Z',
        'DTEND:20261101T010002Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: windowExact,
      });

      expect(preview.occurrences).toHaveLength(1);
      expect(preview.occurrences[0].title).toBe('소수초 오버랩 이벤트');
    });
  });

  describe('(4) 오류 메시지 PII 및 비밀 정보 누설 방지', () => {
    it('UID 중복 마스터 오류 시 error.message와 String(error)에 alice@example.com 및 SUMMARY 원문이 포함되지 않아야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:alice@example.com',
        'SUMMARY:극비 프로젝트 기밀 회의',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:alice@example.com',
        'SUMMARY:극비 프로젝트 기밀 회의 중복',
        'DTSTART:20261110T110000Z',
        'DTEND:20261110T120000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        const message = String(err.message);
        const fullString = String(err);
        expect(message).not.toContain('alice@example.com');
        expect(message).not.toContain('극비 프로젝트');
        expect(fullString).not.toContain('alice@example.com');
        expect(fullString).not.toContain('극비 프로젝트');
      }
    });

    it('마스터 없는 예외 오류 시 error.message와 String(error)에 UID 및 SUMMARY 원문이 포함되지 않아야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:secret-agent@example.com',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:비밀 지령 수정 일정',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        const message = String(err.message);
        const fullString = String(err);
        expect(message).not.toContain('secret-agent@example.com');
        expect(message).not.toContain('비밀 지령');
        expect(fullString).not.toContain('secret-agent@example.com');
        expect(fullString).not.toContain('비밀 지령');
      }
    });

    it('정의되지 않은 TZID 오류 시 error.message와 String(error)에 비밀 TZID 및 SUMMARY 원문이 포함되지 않아야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:secret-tz-uid@example.com',
        'SUMMARY:비공개 내부 세미나',
        'DTSTART;TZID=Secret_Internal_TZ_ID:20261110T090000',
        'DTEND;TZID=Secret_Internal_TZ_ID:20261110T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('UNSUPPORTED_TIMEZONE');
        const message = String(err.message);
        const fullString = String(err);
        expect(message).not.toContain('Secret_Internal_TZ_ID');
        expect(message).not.toContain('비공개 내부 세미나');
        expect(fullString).not.toContain('Secret_Internal_TZ_ID');
        expect(fullString).not.toContain('비공개 내부 세미나');
      }
    });
  });

  describe('(5) 비반복 master + RECURRENCE-ID 예외 조용한 무시 금지', () => {
    it('마스터에 RRULE이 없는데 RECURRENCE-ID를 가진 예외 컴포넌트가 존재할 경우 조용히 무시하지 않고 INVALID_ICS 에러를 던져야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:single-with-exception@example.com',
        'SUMMARY:단일 마스터 (반복 없음)',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:single-with-exception@example.com',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:비반복 일정에 딸린 부적절한 예외',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });
  });

  describe('(6) 불가능 RRULE 및 과대 COUNT/INTERVAL 명시 거부', () => {
    it(
      '불가능한 RRULE(FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30)은 타임아웃 없이 명시 거부되어야 한다',
      async () => {
        const icsText = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Regression//EN',
          'BEGIN:VEVENT',
          'UID:impossible-feb30@example.com',
          'SUMMARY:존재하지 않는 2월 30일',
          'DTSTART:20260228T090000Z',
          'DTEND:20260228T100000Z',
          'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');

        await expect(
          parseCalendarPreview({ icsText, window: defaultWindow })
        ).rejects.toThrow(
          expect.objectContaining({
            code: expect.stringMatching(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            ),
          })
        );
      },
      3000
    );

    it(
      '비정상적으로 거대한 INTERVAL은 시간 내에 명시 거부되어야 한다',
      async () => {
        const icsHugeInterval = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Regression//EN',
          'BEGIN:VEVENT',
          'UID:huge-interval@example.com',
          'SUMMARY:거대 인터벌',
          'DTSTART:20261101T090000Z',
          'DTEND:20261101T100000Z',
          'RRULE:FREQ=DAILY;INTERVAL=1000000000',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');

        await expect(
          parseCalendarPreview({ icsText: icsHugeInterval, window: defaultWindow })
        ).rejects.toThrow(
          expect.objectContaining({
            code: expect.stringMatching(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            ),
          })
        );
      },
      3000
    );

    it(
      '비정상적으로 거대한 COUNT는 시간 내에 명시 거부되어야 한다',
      async () => {
        const icsHugeCount = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//Regression//EN',
          'BEGIN:VEVENT',
          'UID:huge-count@example.com',
          'SUMMARY:거대 카운트',
          'DTSTART:20261101T090000Z',
          'DTEND:20261101T100000Z',
          'RRULE:FREQ=DAILY;COUNT=1000000000',
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');

        await expect(
          parseCalendarPreview({ icsText: icsHugeCount, window: defaultWindow })
        ).rejects.toThrow(
          expect.objectContaining({
            code: expect.stringMatching(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            ),
          })
        );
      },
      3000
    );
  });

  describe('(7) 취소 master 정책 (전체 UID 제외)', () => {
    it('마스터 이벤트가 STATUS:CANCELLED인 경우 예외 컴포넌트 유무와 관계없이 해당 UID 전체가 결과에서 제외되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:cancelled-master-with-ex@example.com',
        'SUMMARY:취소된 마스터 회의',
        'STATUS:CANCELLED',
        'DTSTART:20261103T090000Z',
        'DTEND:20261103T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:cancelled-master-with-ex@example.com',
        'RECURRENCE-ID:20261110T090000Z',
        'SUMMARY:예외 컴포넌트',
        'STATUS:CONFIRMED',
        'DTSTART:20261110T140000Z',
        'DTEND:20261110T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(0);
    });
  });

  describe('(8) 이동 예외(shifted exceptions) & 창 밖 이동 & EXDATE/취소 조합', () => {
    it('11/8 인스턴스를 창 밖(12/5)으로 이동한 예외가 있어도 조기 break 없이 11/1, 11/15, 11/22, 11/29가 정상 반환되어야 하며 원래 11/8은 부활하지 않는다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:weekly-shift-out@example.com',
        'SUMMARY:주간 정기 일요 미팅',
        'DTSTART:20261101T090000Z',
        'DTEND:20261101T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=5',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:weekly-shift-out@example.com',
        'RECURRENCE-ID:20261108T090000Z',
        'SUMMARY:12월로 연기된 미팅 (창 밖)',
        'DTSTART:20261205T090000Z',
        'DTEND:20261205T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(4);
      const startDates = preview.occurrences.map((o) => (o.kind === 'timed' ? o.startsAt : o.startDate));
      expect(startDates).toEqual([
        '2026-11-01T09:00:00.000Z',
        '2026-11-15T09:00:00.000Z',
        '2026-11-22T09:00:00.000Z',
        '2026-11-29T09:00:00.000Z',
      ]);
    });

    it('창 밖 과거(10/25) 인스턴스를 창 안(11/04)으로 이동한 예외는 윈도우에 포함되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:shift-in@example.com',
        'SUMMARY:과거 시작 주간 미팅',
        'DTSTART:20261025T090000Z',
        'DTEND:20261025T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:shift-in@example.com',
        'RECURRENCE-ID:20261025T090000Z',
        'SUMMARY:11월로 앞당겨진 특별 미팅',
        'DTSTART:20261104T140000Z',
        'DTEND:20261104T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(3);
      const shifted = preview.occurrences.find(
        (o) => o.kind === 'timed' && o.startsAt === '2026-11-04T14:00:00.000Z'
      );
      expect(shifted).toBeDefined();
      expect(shifted?.title).toBe('11월로 앞당겨진 특별 미팅');
    });

    it('이동 예외 + EXDATE + STATUS:CANCELLED 예외가 복합 적용되었을 때 정확히 필터링되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:complex-shift-cancel@example.com',
        'SUMMARY:복합 주간 일정',
        'DTSTART:20261101T090000Z',
        'DTEND:20261101T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=5',
        'EXDATE:20261115T090000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:complex-shift-cancel@example.com',
        'RECURRENCE-ID:20261108T090000Z',
        'SUMMARY:12월 이동 일정',
        'DTSTART:20261205T090000Z',
        'DTEND:20261205T100000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:complex-shift-cancel@example.com',
        'RECURRENCE-ID:20261122T090000Z',
        'STATUS:CANCELLED',
        'DTSTART:20261122T090000Z',
        'DTEND:20261122T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      expect(preview.occurrences).toHaveLength(2);
      const dates = preview.occurrences.map((o) => (o.kind === 'timed' ? o.startsAt : o.startDate));
      expect(dates).toEqual([
        '2026-11-01T09:00:00.000Z',
        '2026-11-29T09:00:00.000Z',
      ]);
    });
  });

  describe('(9) 비정상 입력 & TypeError 방지 & PII/vendor 미노출', () => {
    it('DTSTART가 누락된 VEVENT는 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되어야 한다', async () => {
      const icsNoDtstart = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:no-dtstart@example.com',
        'SUMMARY:시작 일시 없음',
        'DTEND:20261110T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText: icsNoDtstart, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('no-dtstart@example.com');
      }
    });

    it('잘못된 형식의 DTSTART는 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되어야 한다', async () => {
      const icsCorruptedDtstart = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:corrupted-dtstart@example.com',
        'SUMMARY:손상된 DTSTART',
        'DTSTART:INVALID_CORRUPTED_DATE_VALUE',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText: icsCorruptedDtstart, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('INVALID_CORRUPTED_DATE_VALUE');
      }
    });

    it('잘못된 UNTIL 또는 RECURRENCE-ID는 TypeError 없이 명시 에러로 거부되고 입력 원문이 노출되지 않아야 한다', async () => {
      const icsCorruptedUntil = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:corrupted-until@example.com',
        'SUMMARY:손상된 UNTIL',
        'DTSTART:20261101T090000Z',
        'RRULE:FREQ=DAILY;UNTIL=CORRUPTED_UNTIL_STRING_PAYLOAD',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText: icsCorruptedUntil, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toMatch(/^(INVALID_ICS|UNSUPPORTED_RECURRENCE)$/);
        expect(String(err)).not.toContain('CORRUPTED_UNTIL_STRING_PAYLOAD');
      }
    });
  });

  describe('(10) DoS/Hang 방지 검증 (Worker Threads 2초 내 완료·명시 거부)', () => {
    it(
      '절대 매치되지 않거나 과대한 반복 규칙들은 Worker 내에서 2초 내에 완료 및 명시 거부되어야 한다',
      async () => {
        const testCases = [
          {
            name: 'FREQ=YEARLY;INTERVAL=100;BYMONTH=2;BYMONTHDAY=29',
            rrule: 'FREQ=YEARLY;INTERVAL=100;BYMONTH=2;BYMONTHDAY=29',
          },
          {
            name: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31',
            rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31',
          },
          {
            name: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
            rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
          },
          {
            name: 'FREQ=MONTHLY;INTERVAL=1000',
            rrule: 'FREQ=MONTHLY;INTERVAL=1000',
          },
          {
            name: 'FREQ=YEARLY;INTERVAL=11',
            rrule: 'FREQ=YEARLY;INTERVAL=11',
          },
        ];

        for (const tc of testCases) {
          const icsText = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Regression//EN',
            'BEGIN:VEVENT',
            `UID:worker-dos-${tc.name}@example.com`,
            'SUMMARY:DoS 테스트 일정',
            'DTSTART:20260101T090000Z',
            'DTEND:20260101T100000Z',
            `RRULE:${tc.rrule}`,
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n');

          const response = await runParserInWorkerWithTimeout(
            icsText,
            defaultWindow,
            2000
          );

          expect(response.status).toBe('REJECTED');
          if (response.status === 'REJECTED') {
            expect(response.code).toMatch(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            );
          }
        }
      },
      12000
    );

    it('정상 주간 BYDAY, 월 BYMONTHDAY, 2/29 INTERVAL=1(윤년 매 4년)은 계속 정상 허용된다', async () => {
      // 1) 정상 주간 BYDAY
      const icsWeeklyByDay = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:valid-byday@example.com',
        'SUMMARY:월수금 미팅',
        'DTSTART:20261102T090000Z',
        'DTEND:20261102T100000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prevWeekly = await parseCalendarPreview({
        icsText: icsWeeklyByDay,
        window: defaultWindow,
      });
      expect(prevWeekly.occurrences.length).toBeGreaterThan(0);

      // 2) 정상 월 BYMONTHDAY
      const icsMonthlyByDay = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:valid-monthly@example.com',
        'SUMMARY:매월 15일 미팅',
        'DTSTART:20261115T090000Z',
        'DTEND:20261115T100000Z',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=15',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prevMonthly = await parseCalendarPreview({
        icsText: icsMonthlyByDay,
        window: defaultWindow,
      });
      expect(prevMonthly.occurrences).toHaveLength(1);

      // 3) 윤년 2/29 (INTERVAL=1)
      const feb2028Window: CalendarParseWindow = {
        startInstant: '2028-02-01T00:00:00.000Z',
        endInstant: '2028-02-29T23:59:59.999Z',
        startDate: '2028-02-01',
        endDateExclusive: '2028-03-01',
      };
      const icsLeapYear = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:leap-year@example.com',
        'SUMMARY:윤년 2월 29일 기념',
        'DTSTART:20240229T090000Z',
        'DTEND:20240229T100000Z',
        'RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=29',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prevLeap = await parseCalendarPreview({
        icsText: icsLeapYear,
        window: feb2028Window,
      });
      expect(prevLeap.occurrences).toHaveLength(1);
      expect(prevLeap.occurrences[0].kind === 'timed' && prevLeap.occurrences[0].startsAt).toBe(
        '2028-02-29T09:00:00.000Z'
      );
    });
  });

  describe('(11) 길이 0 인스턴스 창끝 경계 판정 (반복/비반복 inclusive 일치)', () => {
    it('startsAt === endsAt (길이 0) 인스턴스가 윈도우 endInstant와 정확히 일치할 때 반복/비반복 이벤트 둘 다 동일하게 inclusive 포함되어야 한다', async () => {
      const windowEdge: CalendarParseWindow = {
        startInstant: '2026-11-01T00:00:00.000Z',
        endInstant: '2026-11-01T12:00:00.000Z',
        startDate: '2026-11-01',
        endDateExclusive: '2026-11-02',
      };

      const icsSingleZero = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:zero-single@example.com',
        'SUMMARY:비반복 길이 0 창끝 이벤트',
        'DTSTART:20261101T120000Z',
        'DTEND:20261101T120000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const icsRecurringZero = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:zero-recurring@example.com',
        'SUMMARY:반복 길이 0 창끝 이벤트',
        'DTSTART:20261101T120000Z',
        'DTEND:20261101T120000Z',
        'RRULE:FREQ=DAILY;COUNT=1',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const previewSingle = await parseCalendarPreview({
        icsText: icsSingleZero,
        window: windowEdge,
      });

      const previewRecurring = await parseCalendarPreview({
        icsText: icsRecurringZero,
        window: windowEdge,
      });

      expect(previewSingle.occurrences).toHaveLength(1);
      expect(previewSingle.occurrences[0].title).toBe('비반복 길이 0 창끝 이벤트');

      expect(previewRecurring.occurrences).toHaveLength(1);
      expect(previewRecurring.occurrences[0].title).toBe('반복 길이 0 창끝 이벤트');
    });
  });

  // =========================================================================
  // 3차 독립 재리뷰 추가 결함 5종 회귀 테스트
  // =========================================================================

  describe('(12) RECURRENCE-ID orphan / 충돌 / 미래 창안 이동 거부', () => {
    it('DAILY COUNT=3 + EXDATE 2026-11-12 + 동일 RECURRENCE-ID 예외 조합 시 제외 날짜 부활이 금지되고 명시 INVALID_ICS로 거부되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:exdate-conflict@example.com',
        'SUMMARY:카운트 3 매일 미팅',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'EXDATE:20261112T090000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:exdate-conflict@example.com',
        'RECURRENCE-ID:20261112T090000Z',
        'SUMMARY:제외된 날짜를 부활시키려는 예외',
        'DTSTART:20261112T140000Z',
        'DTEND:20261112T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('규칙과 무관한 RECURRENCE-ID orphan 예외는 명시 INVALID_ICS로 거부되어야 한다', async () => {
      // 매주 화요일 일정인데 규칙에 없는 수요일 RECURRENCE-ID
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:orphan-recid@example.com',
        'SUMMARY:화요 미팅',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:orphan-recid@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:규칙상 존재하지 않는 수요일 예외',
        'DTSTART:20261111T140000Z',
        'DTEND:20261111T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('COUNT/UNTIL 이후 RECURRENCE-ID 예외는 명시 INVALID_ICS로 거부되어야 한다', async () => {
      // COUNT=2 (11/10, 11/11)인데 COUNT 범위를 벗어난 11/15 RECURRENCE-ID
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:beyond-count@example.com',
        'SUMMARY:카운트 2 미팅',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=2',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:beyond-count@example.com',
        'RECURRENCE-ID:20261115T090000Z',
        'SUMMARY:카운트 이후의 유령 예외',
        'DTSTART:20261115T140000Z',
        'DTEND:20261115T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });

    it('창 밖 미래 인스턴스를 창 안으로 옮긴 예외는 UNSUPPORTED_RECURRENCE로 명시 거부되어야 한다', async () => {
      // 창은 2026-11. 마스터는 2026-11-25 시작 DAILY.
      // 2026-12-15(창 밖 미래) 인스턴스를 2026-11-28(창 안)으로 이동한 예외
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:shift-future-in@example.com',
        'SUMMARY:데일리 미팅',
        'DTSTART:20261125T090000Z',
        'DTEND:20261125T100000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:shift-future-in@example.com',
        'RECURRENCE-ID:20261215T090000Z',
        'SUMMARY:창 밖 미래 인스턴스를 창 안으로 당긴 예외',
        'DTSTART:20261128T140000Z',
        'DTEND:20261128T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
      );
    });
  });

  describe('(13) RECURRENCE-ID가 UTC(Z)이고 DTSTART가 TZID일 때 올바른 매칭 및 이중 반환 방지', () => {
    it('마스터가 Asia/Seoul TZID이고 예외의 RECURRENCE-ID가 UTC(Z)여도 올바르게 매칭되어 이중 반환 없이 1개로 교체되어야 한다', async () => {
      // Asia/Seoul 09:00:00은 UTC 00:00:00Z
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
        'UID:tz-utc-match@example.com',
        'SUMMARY:원래 정기 미팅',
        'DTSTART;TZID=Asia/Seoul:20261110T090000',
        'DTEND;TZID=Asia/Seoul:20261110T100000',
        'RRULE:FREQ=DAILY;COUNT=2',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:tz-utc-match@example.com',
        'RECURRENCE-ID:20261110T000000Z',
        'SUMMARY:수정된 첫날 미팅 (오후로 변경)',
        'DTSTART;TZID=Asia/Seoul:20261110T140000',
        'DTEND;TZID=Asia/Seoul:20261110T150000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText,
        window: defaultWindow,
      });

      // 11/10 수정된 인스턴스 1개 + 11/11 원래 인스턴스 1개 = 정확히 2개!
      // 매칭 실패로 인해 11/10이 2개(원래+수정) 나와서 총 3개가 되는 이중 반환 버그 방지
      expect(preview.occurrences).toHaveLength(2);

      const modifiedOcc = preview.occurrences.find(
        (o) => o.kind === 'timed' && o.startsAt === '2026-11-10T05:00:00.000Z'
      );
      expect(modifiedOcc).toBeDefined();
      expect(modifiedOcc?.title).toBe('수정된 첫날 미팅 (오후로 변경)');

      const originalFirstOcc = preview.occurrences.find(
        (o) => o.kind === 'timed' && o.startsAt === '2026-11-10T00:00:00.000Z'
      );
      expect(originalFirstOcc).toBeUndefined(); // 원래 인스턴스는 제거되어야 함!
    });
  });

  describe('(14) BYMONTH/BYMONTHDAY 불가능 조합 및 음수 날짜 Worker 검증 / 정상 규칙 허용', () => {
    it(
      '불가능한 BYMONTH/BYMONTHDAY 및 음수 날짜 조합은 Worker 스레드에서 2초 내 명시 거부되어야 한다',
      async () => {
        const invalidRules = [
          {
            name: 'BYMONTH=2,4,6;BYMONTHDAY=31',
            rrule: 'FREQ=YEARLY;BYMONTH=2,4,6;BYMONTHDAY=31',
          },
          {
            name: 'BYMONTH=2;BYMONTHDAY=-30',
            rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-30',
          },
          {
            name: 'BYMONTH=4,6,9,11;BYMONTHDAY=-31',
            rrule: 'FREQ=YEARLY;BYMONTH=4,6,9,11;BYMONTHDAY=-31',
          },
          {
            name: '2/29 YEARLY INTERVAL=2 거부',
            rrule: 'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29',
          },
        ];

        for (const tc of invalidRules) {
          const icsText = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Regression//EN',
            'BEGIN:VEVENT',
            `UID:worker-invalid-rule-${tc.name}@example.com`,
            'SUMMARY:불가능 규칙 테스트',
            'DTSTART:20240101T090000Z',
            'DTEND:20240101T100000Z',
            `RRULE:${tc.rrule}`,
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n');

          const response = await runParserInWorkerWithTimeout(
            icsText,
            defaultWindow,
            2000
          );

          expect(response.status).toBe('REJECTED');
          if (response.status === 'REJECTED') {
            expect(response.code).toMatch(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            );
          }
        }
      },
      10000
    );

    it('MONTHLY BYMONTHDAY=29 및 DAILY/WEEKLY 정상 규칙은 허용된다', async () => {
      // 1) MONTHLY BYMONTHDAY=29
      const icsMonthly29 = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:valid-monthly-29@example.com',
        'SUMMARY:매월 29일 미팅',
        'DTSTART:20261129T090000Z',
        'DTEND:20261129T100000Z',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=29',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev29 = await parseCalendarPreview({
        icsText: icsMonthly29,
        window: defaultWindow,
      });
      expect(prev29.occurrences).toHaveLength(1);

      // 2) DAILY 정상 규칙
      const icsDaily = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:valid-daily-norm@example.com',
        'SUMMARY:평일 데일리',
        'DTSTART:20261102T090000Z',
        'DTEND:20261102T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prevDaily = await parseCalendarPreview({
        icsText: icsDaily,
        window: defaultWindow,
      });
      expect(prevDaily.occurrences).toHaveLength(3);
    });
  });

  describe('(15) DTEND:garbage 파싱 에러 래핑 및 garbage 미노출', () => {
    it('단일 VEVENT의 DTEND:garbage는 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되고 garbage가 노출되지 않아야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:single-dtend-garbage@example.com',
        'SUMMARY:DTEND 손상 단일 이벤트',
        'DTSTART:20261110T090000Z',
        'DTEND:CORRUPTED_GARBAGE_PAYLOAD_SINGLE_999',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('CORRUPTED_GARBAGE_PAYLOAD_SINGLE_999');
      }
    });

    it('예외 VEVENT의 DTEND:garbage는 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되고 garbage가 노출되지 않아야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:exc-dtend-garbage@example.com',
        'SUMMARY:정상 마스터',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:exc-dtend-garbage@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:예외 DTEND 손상',
        'DTSTART:20261111T140000Z',
        'DTEND:CORRUPTED_GARBAGE_PAYLOAD_EXC_888',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('CORRUPTED_GARBAGE_PAYLOAD_EXC_888');
      }
    });
  });

  describe('(16) 1999-01-01 시작 DAILY 무한 + 현재 창 => LIMIT_EXCEEDED 고정', () => {
    it('1999-01-01 시작 DAILY 무한 반복 일정은 10000 step 상한에 의해 LIMIT_EXCEEDED 오류로 명시 거부되어야 한다', async () => {
      // 1999-01-01부터 2026-11-01까지는 약 10,165일 -> 10,000 steps 초과
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:infinite-daily-1999@example.com',
        'SUMMARY:1999년부터 이어진 매일 스탠드업',
        'DTSTART:19990101T090000Z',
        'DTEND:19990101T100000Z',
        'RRULE:FREQ=DAILY',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'LIMIT_EXCEEDED' })
      );
    });
  });

  // =========================================================================
  // 4차 독립 재리뷰 추가 결함 5종 회귀 테스트
  // =========================================================================

  describe('(17) Worker 2초 제한 하에 무응답 위험 규칙 전부 명시 거부 / 도달 가능 규칙 허용', () => {
    it(
      '도달 불가능하거나 무한 순회 위험이 있는 규칙들은 Worker 스레드 2초 내에 명시 거부되어야 한다',
      async () => {
        const unreachableRules = [
          // 1) DTSTART 월요일(2026-01-05) + DAILY INTERVAL=7;BYDAY=TU (항상 월요일만 건너뛰는데 화요일 요구)
          {
            dtstart: '20260105T100000Z',
            rrule: 'FREQ=DAILY;INTERVAL=7;BYDAY=TU',
          },
          // 2) DTSTART 화요일(2026-01-06) + DAILY INTERVAL=14;BYDAY=MO (항상 화요일만 건너뛰는데 월요일 요구)
          {
            dtstart: '20260106T100000Z',
            rrule: 'FREQ=DAILY;INTERVAL=14;BYDAY=MO',
          },
          // 3) DTSTART 월요일(2026-01-05) + DAILY INTERVAL=21;BYDAY=SU (항상 월요일만 건너뛰는데 일요일 요구)
          {
            dtstart: '20260105T100000Z',
            rrule: 'FREQ=DAILY;INTERVAL=21;BYDAY=SU',
          },
          // 4) 2월 시작인데 MONTHLY INTERVAL=12;BYMONTH=2;BYMONTHDAY=31 (2월 31일 요구)
          {
            dtstart: '20260201T100000Z',
            rrule: 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=2;BYMONTHDAY=31',
          },
          // 5) YEARLY INTERVAL=3;BYMONTH=2;BYMONTHDAY=29 (3년 간격은 윤년 4년 주기와 영원히 어긋남)
          {
            dtstart: '20240229T100000Z',
            rrule: 'FREQ=YEARLY;INTERVAL=3;BYMONTH=2;BYMONTHDAY=29',
          },
        ];

        for (let i = 0; i < unreachableRules.length; i++) {
          const tc = unreachableRules[i];
          const icsText = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Regression//EN',
            'BEGIN:VEVENT',
            `UID:worker-unreachable-${i}@example.com`,
            'SUMMARY:도달 불가 규칙 테스트',
            `DTSTART:${tc.dtstart}`,
            `DTEND:${tc.dtstart}`,
            `RRULE:${tc.rrule}`,
            'END:VEVENT',
            'END:VCALENDAR',
          ].join('\r\n');

          const response = await runParserInWorkerWithTimeout(
            icsText,
            defaultWindow,
            2000
          );

          expect(response.status).toBe('REJECTED');
          if (response.status === 'REJECTED') {
            expect(response.code).toMatch(
              /^(UNSUPPORTED_RECURRENCE|LIMIT_EXCEEDED|INVALID_ICS)$/
            );
          }
        }
      },
      12000
    );

    it('도달 가능한 정상 규칙들은 허용되고 올바른 인스턴스를 반환한다', async () => {
      // 1) DTSTART 월요일(2026-11-02) + DAILY;INTERVAL=7;BYDAY=MO (월요일 시작 7일 간격 월요일 매칭)
      const icsDaily7Mo = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:reachable-daily-7-mo@example.com',
        'SUMMARY:월요일 주간 일정',
        'DTSTART:20261102T100000Z',
        'DTEND:20261102T110000Z',
        'RRULE:FREQ=DAILY;INTERVAL=7;BYDAY=MO',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev1 = await parseCalendarPreview({
        icsText: icsDaily7Mo,
        window: defaultWindow,
      });
      // 11/02, 11/09, 11/16, 11/23, 11/30 (5회)
      expect(prev1.occurrences).toHaveLength(5);

      // 2) WEEKLY 평일 BYDAY (MO,TU,WE,TH,FR)
      const icsWeekdays = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:reachable-weekdays@example.com',
        'SUMMARY:평일 데일리',
        'DTSTART:20261102T100000Z',
        'DTEND:20261102T110000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;COUNT=5',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev2 = await parseCalendarPreview({
        icsText: icsWeekdays,
        window: defaultWindow,
      });
      expect(prev2.occurrences).toHaveLength(5);

      // 3) MONTHLY;BYMONTHDAY=1,15,-1
      const icsMonthlyMulti = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:reachable-monthly-multi@example.com',
        'SUMMARY:매월 1일, 15일, 말일',
        'DTSTART:20261101T100000Z',
        'DTEND:20261101T110000Z',
        'RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15,-1',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev3 = await parseCalendarPreview({
        icsText: icsMonthlyMulti,
        window: defaultWindow,
      });
      // 11/01, 11/15, 11/30 (3회)
      expect(prev3.occurrences).toHaveLength(3);

      // 4) MONTHLY;BYMONTH=2;BYMONTHDAY=29 (윤년 2028년 2월 창)
      const feb2028Window: CalendarParseWindow = {
        startInstant: '2028-02-01T00:00:00.000Z',
        endInstant: '2028-02-29T23:59:59.999Z',
        startDate: '2028-02-01',
        endDateExclusive: '2028-03-01',
      };
      const icsMonthlyFeb29 = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:reachable-monthly-feb29@example.com',
        'SUMMARY:2월 29일 월간',
        'DTSTART:20280229T100000Z',
        'DTEND:20280229T110000Z',
        'RRULE:FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev4 = await parseCalendarPreview({
        icsText: icsMonthlyFeb29,
        window: feb2028Window,
      });
      expect(prev4.occurrences).toHaveLength(1);

      // 5) YEARLY;BYMONTH=2;BYMONTHDAY=29 INTERVAL=1
      const icsYearlyFeb29 = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:reachable-yearly-feb29@example.com',
        'SUMMARY:윤년 2월 29일 연간',
        'DTSTART:20240229T100000Z',
        'DTEND:20240229T110000Z',
        'RRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=29',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const prev5 = await parseCalendarPreview({
        icsText: icsYearlyFeb29,
        window: feb2028Window,
      });
      expect(prev5.occurrences).toHaveLength(1);
    });
  });

  describe('(18) 마스터 TZID와 다른 제3의 TZID를 가진 RECURRENCE-ID 예외 거부', () => {
    it('마스터 TZID(America/New_York)와 다른 TZID(Asia/Seoul)를 가진 RECURRENCE-ID 예외는 조용히 무시되지 않고 UNSUPPORTED_RECURRENCE 오류로 거부되어야 한다', async () => {
      // America/New_York 2026-11-10 09:00:00은 UTC 14:00:00Z
      // Asia/Seoul 2026-11-10 23:00:00은 UTC 14:00:00Z
      // 같은 순간을 가리키지만 서로 다른 VTIMEZONE을 사용하는 교차 TZID 예외
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VTIMEZONE',
        'TZID:America/New_York',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:-0500',
        'TZOFFSETTO:-0500',
        'TZNAME:EST',
        'END:STANDARD',
        'END:VTIMEZONE',
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
        'UID:cross-tzid-ex@example.com',
        'SUMMARY:뉴욕 마스터 미팅',
        'DTSTART;TZID=America/New_York:20261110T090000',
        'DTEND;TZID=America/New_York:20261110T100000',
        'RRULE:FREQ=DAILY;COUNT=2',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:cross-tzid-ex@example.com',
        'RECURRENCE-ID;TZID=Asia/Seoul:20261110T230000',
        'SUMMARY:서울 타임존으로 작성된 예외',
        'STATUS:CANCELLED',
        'DTSTART;TZID=Asia/Seoul:20261110T230000',
        'DTEND;TZID=Asia/Seoul:20261111T000000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
      );
    });

    it('동일한 TZID, UTC(Z), 또는 종일(date) 형식의 RECURRENCE-ID 예외는 정상 적용된다', async () => {
      const icsSameTz = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VTIMEZONE',
        'TZID:America/New_York',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:-0500',
        'TZOFFSETTO:-0500',
        'TZNAME:EST',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:same-tzid-ex@example.com',
        'SUMMARY:뉴욕 마스터 미팅',
        'DTSTART;TZID=America/New_York:20261110T090000',
        'DTEND;TZID=America/New_York:20261110T100000',
        'RRULE:FREQ=DAILY;COUNT=2',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:same-tzid-ex@example.com',
        'RECURRENCE-ID;TZID=America/New_York:20261110T090000',
        'SUMMARY:뉴욕 취소 예외',
        'STATUS:CANCELLED',
        'DTSTART;TZID=America/New_York:20261110T090000',
        'DTEND;TZID=America/New_York:20261110T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      const preview = await parseCalendarPreview({
        icsText: icsSameTz,
        window: defaultWindow,
      });
      // 11/10 취소되어 11/11 1개만 남음
      expect(preview.occurrences).toHaveLength(1);
    });
  });

  describe('(19) 같은 RECURRENCE-ID 예외 2개 중복 시 INVALID_ICS', () => {
    it('동일한 UID 내에서 동일한 RECURRENCE-ID를 가진 예외 컴포넌트가 2개 이상 존재하면 INVALID_ICS 에러로 명시 거부되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:duplicate-recid-ex@example.com',
        'SUMMARY:정상 마스터',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:duplicate-recid-ex@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:수정본 1',
        'DTSTART:20261111T140000Z',
        'DTEND:20261111T150000Z',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:duplicate-recid-ex@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:수정본 2 (중복 예외)',
        'DTSTART:20261111T160000Z',
        'DTEND:20261111T170000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'INVALID_ICS' })
      );
    });
  });

  describe('(20) RANGE=THISANDFUTURE 예외 UNSUPPORTED_RECURRENCE 거부', () => {
    it('RANGE=THISANDFUTURE 파라미터를 가진 RECURRENCE-ID 예외는 UNSUPPORTED_RECURRENCE 에러로 명시 거부되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:thisandfuture-ex@example.com',
        'SUMMARY:정상 마스터',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=5',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:thisandfuture-ex@example.com',
        'RECURRENCE-ID;RANGE=THISANDFUTURE:20261112T090000Z',
        'SUMMARY:미래 전체 변경 예외',
        'DTSTART:20261112T140000Z',
        'DTEND:20261112T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await expect(
        parseCalendarPreview({ icsText, window: defaultWindow })
      ).rejects.toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
      );
    });
  });

  describe('(21) 예외 VEVENT의 잘못된 DTSTART/DTEND/DURATION 값 파싱 래핑', () => {
    it('예외 VEVENT의 DTSTART가 손상된 경우 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되고 원문이 미노출되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:exc-corrupted-dtstart@example.com',
        'SUMMARY:정상 마스터',
        'DTSTART:20261110T090000Z',
        'DTEND:20261110T100000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:exc-corrupted-dtstart@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:손상된 DTSTART 예외',
        'DTSTART:INVALID_CORRUPTED_EXC_DTSTART_VAL',
        'DTEND:20261111T150000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('INVALID_CORRUPTED_EXC_DTSTART_VAL');
      }
    });

    it('예외 VEVENT의 DURATION이 손상된 경우 TypeError 없이 CalendarImportError(INVALID_ICS)로 거부되고 원문이 미노출되어야 한다', async () => {
      const icsText = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Regression//EN',
        'BEGIN:VEVENT',
        'UID:exc-corrupted-duration@example.com',
        'SUMMARY:정상 마스터',
        'DTSTART:20261110T090000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:exc-corrupted-duration@example.com',
        'RECURRENCE-ID:20261111T090000Z',
        'SUMMARY:손상된 DURATION 예외',
        'DTSTART:20261111T140000Z',
        'DURATION:CORRUPTED_DURATION_PAYLOAD_XYZ',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      try {
        await parseCalendarPreview({ icsText, window: defaultWindow });
        expect.unreachable('에러가 발생해야 함');
      } catch (err: any) {
        expect(err).toBeInstanceOf(CalendarImportError);
        expect(err.code).toBe('INVALID_ICS');
        expect(String(err)).not.toContain('CORRUPTED_DURATION_PAYLOAD_XYZ');
      }
    });
  });
});

