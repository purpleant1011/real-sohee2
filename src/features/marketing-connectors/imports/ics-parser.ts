import ICAL from 'ical.js';
import {
  assertSupportedRecurrence,
  CalendarImportError,
  type CalendarImportErrorCode,
  expandEventOccurrences,
  formatDateOnly,
  isOccurrenceInWindow,
  type StepTracker,
  type WindowBoundary,
} from './ics-recurrence';

export { CalendarImportError, type CalendarImportErrorCode };

export type CalendarParseWindow = {
  startInstant: string;
  endInstant: string;
  startDate: string;
  endDateExclusive: string;
};

export type CalendarOccurrence = Readonly<
  {
    id: string;
    title: string;
    recurring: boolean;
  } & (
    | {
        kind: 'timed';
        startsAt: string;
        endsAt: string;
      }
    | {
        kind: 'all_day';
        startDate: string;
        endDateExclusive: string;
      }
  )
>;

export type CalendarPreview = Readonly<{
  sourceHash: string;
  occurrences: readonly CalendarOccurrence[];
}>;

const MAX_BYTES = 1024 * 1024; // 1 MiB
const MAX_LOGICAL_LINE_LENGTH = 8192;
const MAX_COMPONENT_DEPTH = 8;
const MAX_VEVENTS = 100;
const MAX_OCCURRENCES = 100;

// 파일 전체 누적 반복 계산 총 상한 (10000 steps)
const MAX_RECURRENCE_STEPS = 10000;

const ISO_INSTANT_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 윈도우 유효성 검증
 */
function validateParseWindow(window: CalendarParseWindow): WindowBoundary {
  if (!window || typeof window !== 'object') {
    throw new CalendarImportError('INVALID_WINDOW', 'Window must be an object');
  }

  const { startInstant, endInstant, startDate, endDateExclusive } = window;

  if (
    typeof startInstant !== 'string' ||
    typeof endInstant !== 'string' ||
    !ISO_INSTANT_REGEX.test(startInstant) ||
    !ISO_INSTANT_REGEX.test(endInstant)
  ) {
    throw new CalendarImportError(
      'INVALID_WINDOW',
      'Instant must be ISO 8601 with explicit timezone'
    );
  }

  const startTime = Date.parse(startInstant);
  const endTime = Date.parse(endInstant);

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    throw new CalendarImportError('INVALID_WINDOW', 'Invalid instant timestamp');
  }

  if (startTime > endTime) {
    throw new CalendarImportError('INVALID_WINDOW', 'startInstant cannot be after endInstant');
  }

  const maxDurationMs = 31 * 24 * 60 * 60 * 1000;
  if (endTime - startTime > maxDurationMs) {
    throw new CalendarImportError(
      'INVALID_WINDOW',
      'Instant window cannot exceed 31 days'
    );
  }

  if (
    typeof startDate !== 'string' ||
    typeof endDateExclusive !== 'string' ||
    !DATE_ONLY_REGEX.test(startDate) ||
    !DATE_ONLY_REGEX.test(endDateExclusive)
  ) {
    throw new CalendarImportError('INVALID_WINDOW', 'Date window must be YYYY-MM-DD');
  }

  const startDateMs = Date.parse(`${startDate}T00:00:00Z`);
  const endDateMs = Date.parse(`${endDateExclusive}T00:00:00Z`);

  if (Number.isNaN(startDateMs) || Number.isNaN(endDateMs)) {
    throw new CalendarImportError('INVALID_WINDOW', 'Invalid date format');
  }

  if (startDateMs >= endDateMs) {
    throw new CalendarImportError(
      'INVALID_WINDOW',
      'startDate must be strictly before endDateExclusive'
    );
  }

  if (endDateMs - startDateMs > maxDurationMs) {
    throw new CalendarImportError(
      'INVALID_WINDOW',
      'Date window cannot exceed 31 days'
    );
  }

  return {
    startInstantMs: startTime,
    endInstantMs: endTime,
    startDate,
    endDateExclusive,
  };
}

/**
 * 크기 및 논리 줄/깊이 상한 검사
 */
function validateInputBounds(icsText: string): void {
  if (typeof icsText !== 'string') {
    throw new CalendarImportError('INVALID_ICS', 'icsText must be a string');
  }

  if (icsText.length > MAX_BYTES) {
    throw new CalendarImportError('TOO_LARGE', 'Input length exceeds 1 MiB');
  }

  const byteLength = new TextEncoder().encode(icsText).byteLength;
  if (byteLength > MAX_BYTES) {
    throw new CalendarImportError('TOO_LARGE', 'Input byte length exceeds 1 MiB');
  }

  // 논리 줄(unfolded line) 길이 및 중첩 깊이 검사
  const rawLines = icsText.split(/\r\n|\r|\n/);
  let currentLogicalLine = '';
  let depth = 0;
  let maxDepth = 0;

  for (const line of rawLines) {
    if (/^[ \t]/.test(line)) {
      currentLogicalLine += line.slice(1);
    } else {
      if (currentLogicalLine.length > MAX_LOGICAL_LINE_LENGTH) {
        throw new CalendarImportError(
          'LIMIT_EXCEEDED',
          'Logical line length exceeds 8192 characters'
        );
      }
      currentLogicalLine = line;
    }

    const trimmedUpper = line.trim().toUpperCase();
    if (trimmedUpper.startsWith('BEGIN:')) {
      depth += 1;
      if (depth > maxDepth) {
        maxDepth = depth;
      }
    } else if (trimmedUpper.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
    }
  }

  if (currentLogicalLine.length > MAX_LOGICAL_LINE_LENGTH) {
    throw new CalendarImportError(
      'LIMIT_EXCEEDED',
      'Logical line length exceeds 8192 characters'
    );
  }

  if (maxDepth > MAX_COMPONENT_DEPTH) {
    throw new CalendarImportError(
      'LIMIT_EXCEEDED',
      'Component nesting depth exceeds 8'
    );
  }
}

/**
 * SHA-256 hex 해시 계산 (Web Crypto)
 */
async function computeSha256Hex(data: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isCancelledComponent(comp: ICAL.Component): boolean {
  const status = comp.getFirstPropertyValue('status');
  return typeof status === 'string' && status.trim().toUpperCase() === 'CANCELLED';
}

function validateEventTimezone(
  time: ICAL.Time,
  rootComp: ICAL.Component
): void {
  if (time.isDate) {
    return;
  }

  const zone = time.zone;
  if (!zone || zone.tzid === 'floating') {
    throw new CalendarImportError(
      'UNSUPPORTED_TIMEZONE',
      'Floating timed events are not supported'
    );
  }

  if (zone === ICAL.Timezone.utcTimezone || zone.tzid === 'UTC') {
    return;
  }

  const hydrated = rootComp.getTimeZoneByID(zone.tzid);
  if (!hydrated || !hydrated.component) {
    throw new CalendarImportError(
      'UNSUPPORTED_TIMEZONE',
      'Timezone is not defined in the file'
    );
  }
}

/**
 * 안전한 ICS 후보 파서
 */
export async function parseCalendarPreview(input: {
  icsText: string;
  window: CalendarParseWindow;
}): Promise<CalendarPreview> {
  try {
    return await parseCalendarPreviewUnsafe(input);
  } catch (error) {
    // vendor(ical.js)/런타임이 던진 원문 오류(UID/TZID/SUMMARY/입력 조각 포함 가능)는 노출하지 않고
    // 고정 메시지 CalendarImportError 로만 변환한다.
    if (error instanceof CalendarImportError) {
      throw error;
    }
    throw new CalendarImportError('INVALID_ICS', 'Failed to process calendar data');
  }
}

async function parseCalendarPreviewUnsafe(input: {
  icsText: string;
  window: CalendarParseWindow;
}): Promise<CalendarPreview> {
  const { icsText, window } = input;

  const windowBoundary = validateParseWindow(window);
  validateInputBounds(icsText);

  let jcal: unknown;
  try {
    jcal = ICAL.parse(icsText);
  } catch {
    throw new CalendarImportError('INVALID_ICS', 'Failed to parse iCalendar text');
  }

  if (!Array.isArray(jcal)) {
    throw new CalendarImportError('INVALID_ICS', 'Invalid root component structure');
  }

  let rootComp: ICAL.Component;
  try {
    rootComp = new ICAL.Component(jcal as [string, unknown[], unknown[]]);
  } catch {
    throw new CalendarImportError('INVALID_ICS', 'Invalid root component');
  }

  if (rootComp.name !== 'vcalendar') {
    throw new CalendarImportError('INVALID_ICS', 'Root component must be VCALENDAR');
  }

  const veventComps = rootComp.getAllSubcomponents('vevent');
  if (veventComps.length > MAX_VEVENTS) {
    throw new CalendarImportError(
      'LIMIT_EXCEEDED',
      'VEVENT count limit exceeded'
    );
  }

  // UID별 마스터 및 예외 분류
  const masterMap = new Map<string, ICAL.Component>();
  const exceptionsMap = new Map<string, ICAL.Component[]>();

  for (const comp of veventComps) {
    // DTSTART 속성 존재 검증 (null startDate TypeError 방지)
    const dtstartProp = comp.getFirstProperty('dtstart');
    if (!dtstartProp) {
      throw new CalendarImportError('INVALID_ICS', 'Event is missing DTSTART');
    }
    try {
      const val = dtstartProp.getFirstValue();
      if (!val) {
        throw new CalendarImportError('INVALID_ICS', 'Event is missing DTSTART');
      }
    } catch (e) {
      if (e instanceof CalendarImportError) {
        throw e;
      }
      throw new CalendarImportError('INVALID_ICS', 'Failed to parse DTSTART property');
    }

    // DTEND 속성 있을 시 문법 검증 (DTEND:garbage 차단)
    const dtendProp = comp.getFirstProperty('dtend');
    if (dtendProp) {
      try {
        dtendProp.getFirstValue();
      } catch {
        throw new CalendarImportError('INVALID_ICS', 'Failed to parse DTEND property');
      }
    }

    const uidProp = comp.getFirstPropertyValue('uid');
    if (typeof uidProp !== 'string' || uidProp.trim().length === 0) {
      throw new CalendarImportError('INVALID_ICS', 'Event UID is missing or empty');
    }
    const uid = uidProp.trim();

    const isException = comp.hasProperty('recurrence-id');
    if (isException) {
      const list = exceptionsMap.get(uid) || [];
      list.push(comp);
      exceptionsMap.set(uid, list);
    } else {
      if (masterMap.has(uid)) {
        throw new CalendarImportError(
          'INVALID_ICS',
          'Multiple master events found'
        );
      }
      masterMap.set(uid, comp);
    }
  }

  // 마스터 없는 예외 검증
  for (const uid of exceptionsMap.keys()) {
    if (!masterMap.has(uid)) {
      throw new CalendarImportError(
        'INVALID_ICS',
        'Recurrence exception without master'
      );
    }
  }

  const sourceHash = await computeSha256Hex(icsText);

  // stepTracker: 파일 전체 누적 합계 상한 (최대 10000 steps)
  const stepTracker: StepTracker = { steps: 0, maxSteps: MAX_RECURRENCE_STEPS };
  const collectedOccurrences: CalendarOccurrence[] = [];

  for (const [uid, masterComp] of masterMap.entries()) {
    // 취소된 master는 해당 UID 전체(예외 포함) 제외
    if (isCancelledComponent(masterComp)) {
      continue;
    }

    // RRULE 안전 검사
    assertSupportedRecurrence(masterComp);
    const excComps = exceptionsMap.get(uid) || [];
    for (const exc of excComps) {
      assertSupportedRecurrence(exc);
    }

    let masterEvent: ICAL.Event;
    try {
      // vendor 기본 동작은 VCALENDAR 안의 모든 RECURRENCE-ID VEVENT 를 UID 와 무관하게 연결하므로
      // 같은 UID 의 예외만 명시적으로 연결한다.
      masterEvent = new ICAL.Event(masterComp, {
        exceptions: excComps,
        strictExceptions: true,
      });
      if (!masterEvent.startDate) {
        throw new CalendarImportError('INVALID_ICS', 'Event is missing DTSTART');
      }
      // endDate 접근자 안전 검증
      void masterEvent.endDate;
    } catch (e) {
      if (e instanceof CalendarImportError) {
        throw e;
      }
      throw new CalendarImportError('INVALID_ICS', 'Invalid master event component');
    }

    const excEvents: ICAL.Event[] = [];
    for (const c of excComps) {
      try {
        const ev = new ICAL.Event(c);
        if (!ev.startDate) {
          throw new CalendarImportError('INVALID_ICS', 'Event is missing DTSTART');
        }
        void ev.endDate;
        excEvents.push(ev);
      } catch (e) {
        if (e instanceof CalendarImportError) {
          throw e;
        }
        throw new CalendarImportError('INVALID_ICS', 'Invalid recurrence exception component');
      }
    }

    // 비반복 master에 RECURRENCE-ID 예외가 연결된 경우 명시적 오류는
    // expandEventOccurrences 안에서 vendor 접근 안전 래퍼와 함께 판정한다.
    const rawOccs = expandEventOccurrences(
      masterEvent,
      excEvents,
      windowBoundary,
      stepTracker,
      isCancelledComponent
    );

    for (const raw of rawOccs) {
      // 시간대 검사
      validateEventTimezone(raw.startDate, rootComp);
      if (raw.endDate) {
        validateEventTimezone(raw.endDate, rootComp);
      }

      // 윈도우 overlap 검사 (비반복 및 반복 동일 규칙)
      if (!isOccurrenceInWindow(raw.startDate, raw.endDate, windowBoundary)) {
        continue;
      }

      const summaryProp = raw.item.component.getFirstPropertyValue('summary');
      const title = typeof summaryProp === 'string' ? summaryProp : '';

      // ID 생성: canonical tuple (UID + \0 + recurrenceIdentifier)
      const recurrenceIdent = raw.recurring
        ? raw.recurrenceId
          ? raw.recurrenceId.toString()
          : raw.startDate.toString()
        : '';
      const occurrenceId = await computeSha256Hex(`${uid}\0${recurrenceIdent}`);

      if (raw.startDate.isDate) {
        // All-day event
        const startDateStr = formatDateOnly(raw.startDate);
        let endDateExclusiveStr: string;

        if (raw.endDate) {
          endDateExclusiveStr = formatDateOnly(raw.endDate);
        } else {
          // DTEND 없으면 1일 뒤
          const nextDay = raw.startDate.clone();
          nextDay.adjust(1, 0, 0, 0);
          endDateExclusiveStr = formatDateOnly(nextDay);
        }

        if (endDateExclusiveStr <= startDateStr) {
          throw new CalendarImportError(
            'INVALID_ICS',
            'All-day event DTEND must be after DTSTART'
          );
        }

        collectedOccurrences.push({
          id: occurrenceId,
          title,
          recurring: raw.recurring,
          kind: 'all_day',
          startDate: startDateStr,
          endDateExclusive: endDateExclusiveStr,
        });
      } else {
        // Timed event -> Convert to UTC
        const startUtc = raw.startDate.convertToZone(ICAL.Timezone.utcTimezone);
        let endUtc: ICAL.Time;

        if (raw.endDate) {
          endUtc = raw.endDate.convertToZone(ICAL.Timezone.utcTimezone);
        } else {
          endUtc = startUtc.clone();
        }

        const startsAt = startUtc.toJSDate().toISOString();
        const endsAt = endUtc.toJSDate().toISOString();

        const startsAtMs = startUtc.toJSDate().getTime();
        const endsAtMs = endUtc.toJSDate().getTime();

        if (endsAtMs < startsAtMs) {
          throw new CalendarImportError(
            'INVALID_ICS',
            'Timed event DTEND cannot be before DTSTART'
          );
        }

        collectedOccurrences.push({
          id: occurrenceId,
          title,
          recurring: raw.recurring,
          kind: 'timed',
          startsAt,
          endsAt,
        });
      }

      if (collectedOccurrences.length > MAX_OCCURRENCES) {
        throw new CalendarImportError(
          'LIMIT_EXCEEDED',
          'Occurrence count limit exceeded'
        );
      }
    }
  }

  return {
    sourceHash,
    occurrences: collectedOccurrences,
  };
}
