import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import {
  assertSupportedRecurrence,
  CalendarImportError,
  expandEventOccurrences,
  type StepTracker,
  type WindowBoundary,
} from './ics-recurrence';

describe('assertSupportedRecurrence', () => {
  function checkRrule(rruleStr: string, dtstart = '20261110T090000Z'): void {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-rrule',
      `DTSTART:${dtstart}`,
      `RRULE:${rruleStr}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
    const vevent = comp.getFirstSubcomponent('vevent')!;
    assertSupportedRecurrence(vevent);
  }

  it('지원하는 FREQ(DAILY, WEEKLY, MONTHLY, YEARLY)는 통과한다', () => {
    expect(() => checkRrule('FREQ=WEEKLY;INTERVAL=1')).not.toThrow();
    expect(() => checkRrule('FREQ=DAILY;COUNT=5')).not.toThrow();
    expect(() => checkRrule('FREQ=MONTHLY;BYDAY=1TU')).not.toThrow();
    expect(() => checkRrule('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=10')).not.toThrow();
  });

  it('고빈도 FREQ(SECONDLY, MINUTELY, HOURLY)는 UNSUPPORTED_RECURRENCE를 던진다', () => {
    expect(() => checkRrule('FREQ=SECONDLY')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    expect(() => checkRrule('FREQ=MINUTELY;INTERVAL=5')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    expect(() => checkRrule('FREQ=HOURLY;INTERVAL=2')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });

  it('BYSETPOS, BYSECOND, BYMINUTE, BYHOUR 등 고비용 RRULE 파라미터는 거부한다', () => {
    expect(() =>
      checkRrule('FREQ=MONTHLY;BYDAY=MO,TU,WE;BYSETPOS=-1')
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' }));

    expect(() => checkRrule('FREQ=DAILY;BYHOUR=9,10,11')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });

  it('INTERVAL이 366을 초과하면 UNSUPPORTED_RECURRENCE를 던진다', () => {
    expect(() => checkRrule('FREQ=DAILY;INTERVAL=500')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });

  it('COUNT가 10000을 초과하면 UNSUPPORTED_RECURRENCE를 던진다', () => {
    expect(() => checkRrule('FREQ=DAILY;COUNT=20000')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });

  it('MONTHLY BYMONTHDAY=29(BYMONTH 없음)는 정상 허용된다', () => {
    expect(() => checkRrule('FREQ=MONTHLY;BYMONTHDAY=29')).not.toThrow();
  });

  it('불가능한 조합(2월 30일/31일, 30일달의 31일, 2월 -30일 등)은 UNSUPPORTED_RECURRENCE를 던진다', () => {
    expect(() => checkRrule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    expect(() => checkRrule('FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    expect(() => checkRrule('FREQ=YEARLY;BYMONTH=2,4,6;BYMONTHDAY=31')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    expect(() => checkRrule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=-30')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });

  it('2월 29일 반복은 YEARLY INTERVAL=1만 허용하고 그 외는 거부한다', () => {
    expect(() => checkRrule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29')).not.toThrow();

    expect(() => checkRrule('FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );

    // 라운드 4 총괄 결정 D: 달력상 도달 가능한 MONTHLY 2/29 는 과잉 거부하지 않는다.
    expect(() => checkRrule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29')).not.toThrow();
  });
});

describe('assertSupportedRecurrence 사전 종료성 오라클 (라운드 4)', () => {
  function build(rrule: string, dtstart: string): ICAL.Component {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:oracle',
      `DTSTART:${dtstart}`,
      `RRULE:${rrule}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const comp = new ICAL.Component(ICAL.parse(ics) as [string, unknown[], unknown[]]);
    return comp.getFirstSubcomponent('vevent')!;
  }

  // 2026-11-09 = 월요일, 2026-11-10 = 화요일
  const MON = '20261109T090000Z';
  const TUE = '20261110T090000Z';

  const unreachable: Array<[string, string, string]> = [
    ['DAILY INTERVAL=7 BYDAY=TU, DTSTART 월요일', 'FREQ=DAILY;INTERVAL=7;BYDAY=TU', MON],
    ['DAILY INTERVAL=14 BYDAY=MO, DTSTART 화요일', 'FREQ=DAILY;INTERVAL=14;BYDAY=MO', TUE],
    ['DAILY INTERVAL=14 BYDAY=TU,TH, DTSTART 월요일', 'FREQ=DAILY;INTERVAL=14;BYDAY=TU,TH', MON],
    ['DAILY INTERVAL=7 BYDAY=MO,WE, DTSTART 화요일', 'FREQ=DAILY;INTERVAL=7;BYDAY=MO,WE', TUE],
    ['DAILY INTERVAL=7 BYMONTH 2 BYMONTHDAY 31', 'FREQ=DAILY;INTERVAL=7;BYMONTH=2;BYMONTHDAY=31', MON],
    ['MONTHLY INTERVAL=12 BYMONTH=3, DTSTART 2월', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=3', '20260201T090000Z'],
    ['MONTHLY INTERVAL=12 BYMONTH=2 BYMONTHDAY=31', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=2;BYMONTHDAY=31', '20260201T090000Z'],
    ['MONTHLY INTERVAL=24 BYMONTH=6, DTSTART 1월', 'FREQ=MONTHLY;INTERVAL=24;BYMONTH=6', '20260115T090000Z'],
    ['MONTHLY INTERVAL=6 BYMONTH=3,9, DTSTART 1월', 'FREQ=MONTHLY;INTERVAL=6;BYMONTH=3,9', '20260115T090000Z'],
    ['YEARLY INTERVAL=2 2/29, DTSTART 홀수 해', 'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29', '20250101T090000Z'],
    ['YEARLY INTERVAL=2 2/29, DTSTART 윤년', 'FREQ=YEARLY;INTERVAL=2;BYMONTH=2;BYMONTHDAY=29', '20240101T090000Z'],
    ['YEARLY INTERVAL=3 2/29, DTSTART 2024 윤년', 'FREQ=YEARLY;INTERVAL=3;BYMONTH=2;BYMONTHDAY=29', '20240229T100000Z'],
    ['YEARLY INTERVAL=4 2/29, DTSTART 2026', 'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29', TUE],
    ['YEARLY 2/29 INTERVAL=4 DTSTART 윤년', 'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29', '20240229T090000Z'],
    ['YEARLY BYMONTH=4 BYMONTHDAY=31', 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=31', TUE],
    ['MONTHLY BYMONTHDAY=-31 BYMONTH=2', 'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=-31', TUE],
    ['BYSETPOS 거부', 'FREQ=MONTHLY;BYDAY=MO,TU;BYSETPOS=1', TUE],
    ['BYWEEKNO 거부', 'FREQ=YEARLY;BYWEEKNO=20', TUE],
    ['BYYEARDAY 거부', 'FREQ=YEARLY;BYYEARDAY=100', TUE],
    ['BYHOUR 거부', 'FREQ=DAILY;BYHOUR=9', TUE],
    ['BYMINUTE 거부', 'FREQ=DAILY;BYMINUTE=9', TUE],
    ['BYSECOND 거부', 'FREQ=DAILY;BYSECOND=9', TUE],
    ['WEEKLY 서수 BYDAY 거부', 'FREQ=WEEKLY;BYDAY=1MO', TUE],
    ['DAILY 서수 BYDAY 거부', 'FREQ=DAILY;BYDAY=-1FR', TUE],
    ['YEARLY 서수 BYDAY 명시 거부', 'FREQ=YEARLY;BYDAY=1MO', TUE],
    ['MONTHLY 서수 6 거부', 'FREQ=MONTHLY;BYDAY=6MO', TUE],
    ['WEEKLY BYMONTHDAY 거부', 'FREQ=WEEKLY;BYMONTHDAY=1', TUE],
    ['MONTHLY 5번째 월요일 & 31일 & 2월 교차 불가', 'FREQ=MONTHLY;BYMONTH=2;BYDAY=5MO;BYMONTHDAY=31', TUE],
  ];

  it.each(unreachable)('도달 불가/비허용 규칙은 UNSUPPORTED_RECURRENCE 로 즉시 거부: %s', (_name, rrule, dtstart) => {
    const t0 = Date.now();
    expect(() => assertSupportedRecurrence(build(rrule, dtstart))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  const reachable: Array<[string, string, string]> = [
    ['DAILY INTERVAL=7 BYDAY=MO, DTSTART 월요일', 'FREQ=DAILY;INTERVAL=7;BYDAY=MO', MON],
    ['DAILY INTERVAL=7 BYDAY=TU, DTSTART 화요일', 'FREQ=DAILY;INTERVAL=7;BYDAY=TU', TUE],
    ['DAILY INTERVAL=5 BYDAY=MO..FR', 'FREQ=DAILY;INTERVAL=5;BYDAY=MO,TU,WE,TH,FR', MON],
    ['WEEKLY 평일 BYDAY', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', MON],
    ['WEEKLY INTERVAL=2 BYDAY=TU,TH WKST=SU', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;WKST=SU', TUE],
    ['MONTHLY BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYMONTHDAY=1,15', TUE],
    ['MONTHLY BYMONTHDAY=-1', 'FREQ=MONTHLY;BYMONTHDAY=-1', TUE],
    ['MONTHLY 첫째 화요일', 'FREQ=MONTHLY;BYDAY=1TU', TUE],
    ['MONTHLY 마지막 금요일', 'FREQ=MONTHLY;BYDAY=-1FR', TUE],
    ['MONTHLY 다섯째 월요일(일부 달만 존재)', 'FREQ=MONTHLY;BYDAY=5MO', TUE],
    ['MONTHLY BYMONTH=2 BYMONTHDAY=29 (달력상 유효)', 'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29', TUE],
    ['MONTHLY INTERVAL=12 BYMONTH=2 BYMONTHDAY=29 DTSTART 2월', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=2;BYMONTHDAY=29', '20260201T090000Z'],
    ['MONTHLY INTERVAL=12 BYMONTH=11 (DTSTART 11월)', 'FREQ=MONTHLY;INTERVAL=12;BYMONTH=11', TUE],
    ['YEARLY 2/29 INTERVAL=1', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', TUE],
    ['YEARLY 11/10 기본', 'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=10', TUE],
    ['YEARLY BYMONTHDAY=-1 BYMONTH=2', 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1', TUE],
    ['DAILY COUNT/UNTIL', 'FREQ=DAILY;COUNT=5', TUE],
    ['DAILY BYMONTHDAY=1 BYMONTH=1', 'FREQ=DAILY;BYMONTH=1;BYMONTHDAY=1', TUE],
  ];

  it.each(reachable)('도달 가능한 규칙은 그대로 허용: %s', (_name, rrule, dtstart) => {
    expect(() => assertSupportedRecurrence(build(rrule, dtstart))).not.toThrow();
  });

  it('허용된 규칙은 실제 vendor 이터레이터가 첫 3개 인스턴스를 즉시 돌려준다(오라클-vendor 차분)', () => {
    for (const [, rrule, dtstart] of reachable) {
      const comp = build(rrule, dtstart);
      assertSupportedRecurrence(comp);
      const event = new ICAL.Event(comp);
      const it = event.iterator();
      const t0 = Date.now();
      for (let i = 0; i < 3; i += 1) {
        if (!it.next()) break;
      }
      expect(Date.now() - t0).toBeLessThan(1500);
    }
  });

  it('EXRULE 은 vendor 이터레이터 정지 위험이 있으므로 명시 거부한다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:exr',
      'DTSTART:20261110T090000Z',
      'RRULE:FREQ=DAILY',
      'EXRULE:FREQ=DAILY;INTERVAL=7;BYDAY=MO',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const comp = new ICAL.Component(ICAL.parse(ics) as [string, unknown[], unknown[]]);
    expect(() => assertSupportedRecurrence(comp.getFirstSubcomponent('vevent')!)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_RECURRENCE' })
    );
  });
});

describe('expandEventOccurrences', () => {
  const dummyWindow: WindowBoundary = {
    startInstantMs: Date.parse('2026-11-01T00:00:00.000Z'),
    endInstantMs: Date.parse('2026-11-30T23:59:59.999Z'),
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  };

  it('반복 step 한도(maxSteps) 초과 시 LIMIT_EXCEEDED 에러를 던진다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:infinite-1',
      'DTSTART:20261101T090000Z',
      'DTEND:20261101T100000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
    const vevent = comp.getFirstSubcomponent('vevent')!;
    const event = new ICAL.Event(vevent);

    const stepTracker: StepTracker = { steps: 0, maxSteps: 10 };

    expect(() => {
      expandEventOccurrences(event, [], dummyWindow, stepTracker, () => false);
    }).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });

  it('창 종료 시점(endInstantMs) 이상이면 전개를 즉시 중단한다', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:infinite-break',
      'DTSTART:20261101T090000Z',
      'DTEND:20261101T100000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
    const vevent = comp.getFirstSubcomponent('vevent')!;
    const event = new ICAL.Event(vevent);

    const narrowWindow: WindowBoundary = {
      startInstantMs: Date.parse('2026-11-01T00:00:00.000Z'),
      endInstantMs: Date.parse('2026-11-05T00:00:00.000Z'),
      startDate: '2026-11-01',
      endDateExclusive: '2026-11-05',
    };

    const stepTracker: StepTracker = { steps: 0, maxSteps: 10000 };
    const occs = expandEventOccurrences(event, [], narrowWindow, stepTracker, () => false);

    // 11/01, 11/02, 11/03, 11/04 -> 11/05 09:00은 endInstantMs(11/05 00:00) 이상이므로 중단
    expect(occs).toHaveLength(4);
    expect(stepTracker.steps).toBeLessThanOrEqual(5);
  });
});

describe('expandEventOccurrences vendor 접근자 안전 래퍼 (라운드 4)', () => {
  const window: WindowBoundary = {
    startInstantMs: Date.parse('2026-11-01T00:00:00.000Z'),
    endInstantMs: Date.parse('2026-11-30T23:59:59.999Z'),
    startDate: '2026-11-01',
    endDateExclusive: '2026-12-01',
  };
  const LEAK = 'VENDOR-LEAK uid=secret@example.com TZID=Secret/Zone SUMMARY=secret-title';

  function events(): { master: ICAL.Event; exc: ICAL.Event } {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:acc',
      'DTSTART:20261103T090000Z',
      'DTEND:20261103T100000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:acc',
      // 창(11월) 이후의 예외: 순회 종료 뒤 예외 검증 단계에서 startDate/endDate 를 읽는다
      'RECURRENCE-ID:20261215T090000Z',
      'DTSTART:20261215T110000Z',
      'DTEND:20261215T120000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const root = new ICAL.Component(ICAL.parse(ics) as [string, unknown[], unknown[]]);
    const [m, e] = root.getAllSubcomponents('vevent');
    return { master: new ICAL.Event(m), exc: new ICAL.Event(e) };
  }

  function throwing(target: object, prop: string): void {
    Object.defineProperty(target, prop, {
      configurable: true,
      get() {
        throw new Error(LEAK);
      },
    });
  }

  const sites: Array<[string, (m: ICAL.Event, e: ICAL.Event) => void]> = [
    ['예외 startDate', (_m, e) => throwing(e, 'startDate')],
    ['예외 endDate', (_m, e) => throwing(e, 'endDate')],
    ['예외 recurrenceId', (_m, e) => throwing(e, 'recurrenceId')],
    ['마스터 startDate', (m) => throwing(m, 'startDate')],
    ['마스터 duration', (m) => throwing(m, 'duration')],
    [
      '마스터 isRecurring',
      (m) => {
        m.isRecurring = () => {
          throw new Error(LEAK);
        };
      },
    ],
    [
      '마스터 getOccurrenceDetails',
      (m) => {
        m.getOccurrenceDetails = () => {
          throw new Error(LEAK);
        };
      },
    ],
  ];

  it.each(sites)('%s 접근 오류는 원문 없이 CalendarImportError 로 변환된다', (_name, sabotage) => {
    const { master, exc } = events();
    sabotage(master, exc);
    const tracker: StepTracker = { steps: 0, maxSteps: 10000 };
    try {
      expandEventOccurrences(master, [exc], window, tracker, () => false);
      expect.fail('에러가 발생해야 함');
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarImportError);
      expect((err as CalendarImportError).message).not.toContain('VENDOR-LEAK');
      expect((err as CalendarImportError).message).not.toContain('secret');
    }
  });

  it('isCancelled 콜백이 던진 원문 오류도 고정 메시지로 변환된다', () => {
    const { master, exc } = events();
    const tracker: StepTracker = { steps: 0, maxSteps: 10000 };
    expect(() =>
      expandEventOccurrences(master, [exc], window, tracker, () => {
        throw new Error(LEAK);
      })
    ).toThrow(expect.objectContaining({ name: 'CalendarImportError' }));
  });
});
