import ICAL from 'ical.js';

export type CalendarImportErrorCode =
  | 'INVALID_ICS'
  | 'TOO_LARGE'
  | 'INVALID_WINDOW'
  | 'UNSUPPORTED_TIMEZONE'
  | 'UNSUPPORTED_RECURRENCE'
  | 'LIMIT_EXCEEDED';

export class CalendarImportError extends Error {
  readonly code: CalendarImportErrorCode;

  constructor(code: CalendarImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CalendarImportError';
    this.code = code;
    Object.setPrototypeOf(this, CalendarImportError.prototype);
  }
}

/**
 * 모든 vendor(ical.js) 접근을 감싸는 단일 안전 래퍼.
 * vendor 가 던진 원문 오류(UID/TZID/SUMMARY/입력 조각 포함 가능)는 버리고
 * 고정 메시지의 CalendarImportError 로만 변환한다.
 */
export function guardVendor<T>(
  fn: () => T,
  code: CalendarImportErrorCode = 'INVALID_ICS',
  message = 'Failed to process calendar data'
): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof CalendarImportError) {
      throw error;
    }
    throw new CalendarImportError(code, message);
  }
}

// ---------------------------------------------------------------------------
// 사전 종료성 검증 오라클
//
// vendor RecurIterator.next() 는 DAILY/WEEKLY 에 후보 부재 가드가 없고
// MONTHLY/YEARLY 가드도 일부 경로에만 닿는다. 따라서 vendor 를 호출하기 전에
// 순수 달력 산술로 "DTSTART 이후 일정 횟수의 반복 주기 안에 후보가 존재하는가"를
// 직접 시뮬레이션하고, 없으면 UNSUPPORTED_RECURRENCE 로 거부한다.
// ---------------------------------------------------------------------------

const ALLOWED_FREQS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const ALLOWED_BY_PARTS = new Set(['BYMONTH', 'BYMONTHDAY', 'BYDAY']);

const FREQ_INTERVAL_MAX: Record<string, number> = {
  DAILY: 366,
  WEEKLY: 104,
  MONTHLY: 24,
  YEARLY: 10,
};

/**
 * FREQ 별 시뮬레이션 반복 횟수 K. "반복 주기 index i (실제 간격은 i x INTERVAL)" 를
 * K 개까지 본다. DAILY 8000일, WEEKLY 1500주, MONTHLY 1200개월, YEARLY 400년(그레고리력 전체 주기).
 */
const ORACLE_HORIZON: Record<string, number> = {
  DAILY: 8000,
  WEEKLY: 1500,
  MONTHLY: 1200,
  YEARLY: 400,
};

type ByDayEntry = { ordinal: number | null; dow: number };

type RuleSpec = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count: number | null;
  byMonth: number[];
  byMonthDay: number[];
  byDay: ByDayEntry[];
  /** 0=일 ... 6=토 */
  wkst: number;
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const BYDAY_REGEX = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i;

function unsupported(message: string): CalendarImportError {
  return new CalendarImportError('UNSUPPORTED_RECURRENCE', message);
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return [year, month, day];
}

/** 0=일 ... 6=토 (1970-01-01 = 목요일) */
function dowOfDays(days: number): number {
  return (((days % 7) + 7) % 7 + 4) % 7;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parseByDay(raw: unknown, freq: string): ByDayEntry[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw unsupported('Invalid BYDAY value');
  }
  if (raw.length > 7) {
    throw unsupported('Excessive BYDAY elements');
  }
  const entries: ByDayEntry[] = [];
  for (const item of raw) {
    const match = typeof item === 'string' ? BYDAY_REGEX.exec(item.trim()) : null;
    if (!match) {
      throw unsupported('Invalid BYDAY value');
    }
    const dow = DAY_CODES.indexOf(match[2].toUpperCase());
    let ordinal: number | null = null;
    if (match[1] !== undefined) {
      ordinal = Number.parseInt(match[1], 10);
      // 서수 BYDAY 는 MONTHLY(월 범위, 1..5 / -1..-5) 에서만 명시 지원한다.
      if (freq !== 'MONTHLY' || ordinal === 0 || Math.abs(ordinal) > 5) {
        throw unsupported('Unsupported ordinal BYDAY');
      }
    }
    entries.push({ ordinal, dow });
  }
  return entries;
}

function readIntegerList(
  raw: unknown,
  min: number,
  max: number,
  maxLength: number,
  label: string
): number[] {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw unsupported(`Invalid ${label} value`);
  }
  if (raw.length > maxLength) {
    throw unsupported(`Excessive ${label} elements`);
  }
  for (const value of raw) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < min ||
      value > max ||
      value === 0
    ) {
      throw unsupported(`Invalid ${label} value`);
    }
  }
  return raw as number[];
}

/** 허용 목록·상한 검증 후 RuleSpec 으로 정규화 */
function buildRuleSpec(recur: ICAL.Recur): RuleSpec {
  const freq = String(recur.freq || '').toUpperCase();
  if (!ALLOWED_FREQS.has(freq)) {
    throw unsupported('Unsupported recurrence frequency');
  }

  const maxInterval = FREQ_INTERVAL_MAX[freq] ?? 366;
  let interval = 1;
  if (recur.interval !== undefined && recur.interval !== null) {
    if (
      typeof recur.interval !== 'number' ||
      !Number.isInteger(recur.interval) ||
      recur.interval < 1 ||
      recur.interval > maxInterval
    ) {
      throw unsupported('Unsupported recurrence interval');
    }
    interval = recur.interval;
  }

  let count: number | null = null;
  if (recur.count !== undefined && recur.count !== null) {
    if (
      typeof recur.count !== 'number' ||
      !Number.isInteger(recur.count) ||
      recur.count <= 0 ||
      recur.count > 10000
    ) {
      throw unsupported('Unsupported recurrence count');
    }
    count = recur.count;
  }

  const parts = (recur.parts || {}) as Record<string, unknown>;

  // 허용 목록 밖 BY* (BYSETPOS/BYWEEKNO/BYYEARDAY/BYHOUR/BYMINUTE/BYSECOND 등) 전부 명시 거부
  for (const key of Object.keys(parts)) {
    const value = parts[key];
    const present = value !== undefined && !(Array.isArray(value) && value.length === 0);
    if (present && key.startsWith('BY') && !ALLOWED_BY_PARTS.has(key)) {
      throw unsupported('Unsupported recurrence parameters');
    }
  }

  const byMonth = readIntegerList(parts.BYMONTH, 1, 12, 12, 'BYMONTH');
  const byMonthDay = readIntegerList(parts.BYMONTHDAY, -31, 31, 31, 'BYMONTHDAY');
  const byDay = parseByDay(parts.BYDAY, freq);

  if (freq === 'WEEKLY' && byMonthDay.length > 0) {
    throw unsupported('BYMONTHDAY is not supported with WEEKLY');
  }

  let wkst = 1; // 월요일 기본
  if (typeof recur.wkst === 'number' && Number.isInteger(recur.wkst) && recur.wkst >= 1 && recur.wkst <= 7) {
    wkst = recur.wkst - 1;
  }

  return { freq: freq as RuleSpec['freq'], interval, count, byMonth, byMonthDay, byDay, wkst };
}

/** 월 안의 day 가 BYMONTHDAY/BYDAY(서수 포함) 규칙(없으면 DTSTART 일)에 맞는가 */
function dayMatchesMonthRules(
  spec: RuleSpec,
  year: number,
  month: number,
  day: number,
  dow: number,
  dtDay: number
): boolean {
  const hasMonthDay = spec.byMonthDay.length > 0;
  const hasByDay = spec.byDay.length > 0;
  const dim = daysInMonth(year, month);

  if (!hasMonthDay && !hasByDay) {
    return day === dtDay;
  }

  if (hasMonthDay) {
    const ok = spec.byMonthDay.some((md) => (md > 0 ? md === day : dim + md + 1 === day));
    if (!ok) {
      return false;
    }
  }

  if (hasByDay) {
    const ok = spec.byDay.some((entry) => {
      if (entry.dow !== dow) {
        return false;
      }
      if (entry.ordinal === null) {
        return true;
      }
      return entry.ordinal > 0
        ? Math.floor((day - 1) / 7) + 1 === entry.ordinal
        : Math.floor((dim - day) / 7) + 1 === -entry.ordinal;
    });
    if (!ok) {
      return false;
    }
  }

  return true;
}

/** DAILY/WEEKLY 의 단일 일자 필터(BYMONTH, BYMONTHDAY, 서수 없는 BYDAY) */
function dayMatchesFilters(spec: RuleSpec, absDay: number, defaultDow: number | null): boolean {
  const [year, month, day] = civilFromDays(absDay);
  if (spec.byMonth.length > 0 && !spec.byMonth.includes(month)) {
    return false;
  }
  if (spec.byMonthDay.length > 0) {
    const dim = daysInMonth(year, month);
    if (!spec.byMonthDay.some((md) => (md > 0 ? md === day : dim + md + 1 === day))) {
      return false;
    }
  }
  const dow = dowOfDays(absDay);
  if (spec.byDay.length > 0) {
    return spec.byDay.some((entry) => entry.dow === dow);
  }
  return defaultDow === null ? true : dow === defaultDow;
}

/** i 번째 반복 주기에서 DTSTART 이후(포함)에 존재하는 후보 일(절대 일수)을 오름차순으로 돌려준다 */
function candidateDaysInPeriod(
  spec: RuleSpec,
  index: number,
  dtDays: number,
  dtYear: number,
  dtMonth: number,
  dtDay: number
): number[] {
  const step = index * spec.interval;
  const out: number[] = [];

  switch (spec.freq) {
    case 'DAILY': {
      const abs = dtDays + step;
      if (dayMatchesFilters(spec, abs, null)) {
        out.push(abs);
      }
      return out;
    }
    case 'WEEKLY': {
      const dtDow = dowOfDays(dtDays);
      const weekStart = dtDays - ((dtDow - spec.wkst + 7) % 7);
      const base = weekStart + 7 * step;
      for (let j = 0; j < 7; j += 1) {
        const abs = base + j;
        if (abs >= dtDays && dayMatchesFilters(spec, abs, dtDow)) {
          out.push(abs);
        }
      }
      return out;
    }
    case 'MONTHLY':
    case 'YEARLY': {
      const months: number[] = [];
      let year: number;
      if (spec.freq === 'MONTHLY') {
        const total = dtYear * 12 + (dtMonth - 1) + step;
        year = Math.floor(total / 12);
        const month = (total % 12) + 1;
        if (spec.byMonth.length === 0 || spec.byMonth.includes(month)) {
          months.push(month);
        }
      } else {
        year = dtYear + step;
        if (spec.byMonth.length > 0) {
          months.push(...spec.byMonth);
        } else if (spec.byMonthDay.length > 0 || spec.byDay.length > 0) {
          for (let m = 1; m <= 12; m += 1) {
            months.push(m);
          }
        } else {
          months.push(dtMonth);
        }
      }

      const sortedMonths = [...new Set(months)].sort((x, y) => x - y);
      for (const month of sortedMonths) {
        const dim = daysInMonth(year, month);
        const first = daysFromCivil(year, month, 1);
        for (let day = 1; day <= dim; day += 1) {
          const abs = first + day - 1;
          if (abs < dtDays) {
            continue;
          }
          if (dayMatchesMonthRules(spec, year, month, day, dowOfDays(abs), dtDay)) {
            out.push(abs);
          }
        }
      }
      return out;
    }
    default:
      return out;
  }
}

/**
 * 종료성 오라클: DTSTART 이후 K 주기 안에 첫 후보가 있고, 그 뒤 K 주기 안에 두 번째 후보가
 * 있어야(COUNT=1 이면 첫 후보만) 규칙이 유한 시간 안에 계속 진행됨이 보장된다.
 */
function ruleHasBoundedCandidates(
  spec: RuleSpec,
  dtYear: number,
  dtMonth: number,
  dtDay: number
): boolean {
  const horizon = ORACLE_HORIZON[spec.freq];
  const dtDays = daysFromCivil(dtYear, dtMonth, dtDay);
  const needed = spec.count === 1 ? 1 : 2;

  let found = 0;
  let firstIndex = -1;

  for (let i = 0; ; i += 1) {
    if (firstIndex < 0 ? i >= horizon : i >= firstIndex + horizon) {
      return false;
    }
    const n = candidateDaysInPeriod(spec, i, dtDays, dtYear, dtMonth, dtDay).length;
    if (n > 0) {
      if (firstIndex < 0) {
        firstIndex = i;
      }
      found += n;
      if (found >= needed) {
        return true;
      }
    }
  }
}

/** expand 한 번당 허용되는 반복 주기 평가 총량(후보 없는 주기 포함). 초과 시 LIMIT_EXCEEDED */
const MAX_PERIOD_EVALUATIONS = 2_000_000;

type SingleRule = {
  spec: RuleSpec;
  dtstart: ICAL.Time;
  until: ICAL.Time | null;
};

/**
 * 컴포넌트의 반복 정의를 검증하고 단일 RRULE 로 정규화한다.
 * 반복 후보는 vendor 이터레이터(RecurIterator/RecurExpansion)를 쓰지 않고
 * 아래 RuleExpander(순수 달력 산술, 모든 루프 상한 보장)로만 생성한다.
 * 그러므로 RRULE 이 있는 컴포넌트는 반드시 이 검증을 통과해야 한다.
 */
function readSingleRule(comp: ICAL.Component): SingleRule | null {
  // EXRULE 은 deprecated, RDATE 는 DTSTART 와 표현이 다른 인스턴스를 만들 수 있어 명시 거부
  if (comp.hasProperty('exrule')) {
    throw unsupported('EXRULE is not supported');
  }
  if (comp.hasProperty('rdate')) {
    throw unsupported('RDATE is not supported');
  }

  const rruleProps = comp.getAllProperties('rrule');
  if (rruleProps.length === 0) {
    return null;
  }
  if (rruleProps.length > 1) {
    throw unsupported('Multiple RRULE properties are not supported');
  }

  let dtstart: unknown;
  try {
    dtstart = comp.getFirstPropertyValue('dtstart');
  } catch {
    throw new CalendarImportError('INVALID_ICS', 'Failed to parse DTSTART property');
  }
  if (!(dtstart instanceof ICAL.Time)) {
    throw new CalendarImportError('INVALID_ICS', 'Event is missing DTSTART');
  }

  let val: unknown;
  try {
    val = rruleProps[0].getFirstValue();
  } catch {
    throw new CalendarImportError('INVALID_ICS', 'RRULE parsing failed');
  }
  // RRULE 이 Recur 로 해석되지 않으면 검증 불가이므로 조용히 건너뛰지 않고 거부한다.
  if (!val || !(val instanceof ICAL.Recur)) {
    throw new CalendarImportError('INVALID_ICS', 'RRULE parsing failed');
  }

  const spec = buildRuleSpec(val);

  // 라운드 3 Ruling: 2/29-only는 YEARLY INTERVAL=1 에서만 허용, INTERVAL >= 2는 거부
  if (spec.freq === 'YEARLY' && spec.interval !== 1) {
    const isFebOrEmpty =
      spec.byMonth.length === 0 ||
      (spec.byMonth.length === 1 && spec.byMonth[0] === 2);
    const has29 =
      spec.byMonthDay.includes(29) ||
      spec.byMonthDay.includes(-1) ||
      (spec.byMonthDay.length === 0 && dtstart.day === 29);
    if (isFebOrEmpty && has29) {
      throw unsupported('2/29 recurrence is only supported for YEARLY with INTERVAL=1');
    }
  }

  if (!ruleHasBoundedCandidates(spec, dtstart.year, dtstart.month, dtstart.day)) {
    throw unsupported('Recurrence rule has no reachable occurrence');
  }

  const until = val.until instanceof ICAL.Time ? val.until : null;
  return { spec, dtstart, until };
}

/**
 * 허용 RRULE 조합 allowlist, 고비용 파라미터 명시 거부, 사전 종료성 오라클.
 */
export function assertSupportedRecurrence(comp: ICAL.Component): void {
  guardVendor(
    () => {
      readSingleRule(comp);
    },
    'INVALID_ICS',
    'Failed to validate recurrence rule'
  );
}

/**
 * RRULE 후보 생성기. 모든 반복 주기 index 루프는 후보 없는 주기 연속 상한(FREQ 별 K)과
 * 총 평가량 상한(MAX_PERIOD_EVALUATIONS)으로 유한하다. 상한 초과는 조용히 끝내지 않고 오류로 던진다.
 */
class RuleExpander {
  private readonly spec: RuleSpec;
  private readonly dtstart: ICAL.Time;
  private readonly until: ICAL.Time | null;
  private readonly dtDays: number;
  private index = 0;
  private buffer: number[] = [];
  private emitted = 0;
  private evaluations = 0;
  private done = false;

  constructor(rule: SingleRule) {
    this.spec = rule.spec;
    this.dtstart = rule.dtstart;
    this.until = rule.until;
    this.dtDays = daysFromCivil(rule.dtstart.year, rule.dtstart.month, rule.dtstart.day);
  }

  next(): ICAL.Time | null {
    if (this.done) {
      return null;
    }
    if (this.spec.count !== null && this.emitted >= this.spec.count) {
      this.done = true;
      return null;
    }

    let idle = 0;
    while (this.buffer.length === 0) {
      this.evaluations += 1;
      if (this.evaluations > MAX_PERIOD_EVALUATIONS) {
        throw new CalendarImportError('LIMIT_EXCEEDED', 'Recurrence evaluation budget exceeded');
      }
      const days = candidateDaysInPeriod(
        this.spec,
        this.index,
        this.dtDays,
        this.dtstart.year,
        this.dtstart.month,
        this.dtstart.day
      );
      this.index += 1;
      if (days.length > 0) {
        this.buffer = days;
        break;
      }
      idle += 1;
      if (idle > ORACLE_HORIZON[this.spec.freq]) {
        throw unsupported('Recurrence gap exceeds supported horizon');
      }
    }

    const abs = this.buffer.shift() as number;
    const [year, month, day] = civilFromDays(abs);
    const data: Record<string, unknown> = { year, month, day, isDate: this.dtstart.isDate };
    if (!this.dtstart.isDate) {
      data.hour = this.dtstart.hour;
      data.minute = this.dtstart.minute;
      data.second = this.dtstart.second;
    }
    const time = ICAL.Time.fromData(data, this.dtstart.zone);

    if (this.until && time.compare(this.until) > 0) {
      this.done = true;
      return null;
    }

    this.emitted += 1;
    return time;
  }
}

// ---------------------------------------------------------------------------
// 전개
// ---------------------------------------------------------------------------

/**
 * 검증·테스트용: 컴포넌트의 RRULE 후보를 앞에서부터 limit 개까지 ISO 유사 문자열로 돌려준다
 * (EXDATE 미적용, vendor 이터레이터 미사용).
 */
export function previewRuleCandidates(comp: ICAL.Component, limit: number): string[] {
  return guardVendor(
    () => {
      const rule = readSingleRule(comp);
      if (!rule) {
        return [];
      }
      const expander = new RuleExpander(rule);
      const out: string[] = [];
      while (out.length < limit) {
        const t = expander.next();
        if (!t) {
          break;
        }
        out.push(t.toString());
      }
      return out;
    },
    'INVALID_ICS',
    'Failed to preview recurrence'
  );
}

export type RawOccurrenceDetail = {
  item: ICAL.Event;
  startDate: ICAL.Time;
  endDate: ICAL.Time;
  recurrenceId: ICAL.Time | null;
  recurring: boolean;
};

/**
 * stepTracker: 파일 전체 누적 합계 상한 (최대 10000 steps)
 */
export type StepTracker = {
  steps: number;
  readonly maxSteps: number;
};

export type WindowBoundary = {
  startInstantMs: number;
  endInstantMs: number;
  startDate: string;
  endDateExclusive: string;
};

export function formatDateOnly(time: ICAL.Time): string {
  const y = String(time.year).padStart(4, '0');
  const m = String(time.month).padStart(2, '0');
  const d = String(time.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 시간대 정규화 key 생성 (UTC instant ms 또는 YYYY-MM-DD)
 */
export function getNormalizedTimeKey(time: ICAL.Time): string {
  if (time.isDate) {
    return formatDateOnly(time);
  }
  const utc = time.convertToZone(ICAL.Timezone.utcTimezone);
  return utc.toJSDate().getTime().toString();
}

/**
 * 인스턴스가 윈도우와 겹치는지 판정 (길이 0 인스턴스 창끝 inclusive 규칙 통일)
 */
export function isOccurrenceInWindow(
  startDate: ICAL.Time,
  endDate: ICAL.Time | null | undefined,
  window: WindowBoundary
): boolean {
  if (startDate.isDate) {
    const startStr = formatDateOnly(startDate);
    let endStr: string;
    if (endDate) {
      endStr = formatDateOnly(endDate);
    } else {
      const nextDay = startDate.clone();
      nextDay.adjust(1, 0, 0, 0);
      endStr = formatDateOnly(nextDay);
    }
    return startStr < window.endDateExclusive && endStr > window.startDate;
  }

  const startUtc = startDate.convertToZone(ICAL.Timezone.utcTimezone);
  const startMs = startUtc.toJSDate().getTime();
  const endUtc = endDate
    ? endDate.convertToZone(ICAL.Timezone.utcTimezone)
    : startUtc;
  const endMs = endUtc.toJSDate().getTime();

  return startMs === endMs
    ? startMs >= window.startInstantMs && startMs <= window.endInstantMs
    : startMs < window.endInstantMs && endMs > window.startInstantMs;
}

/** 값 표현(타입/시간대) 분류. vendor 예외 키 매칭 규칙을 그대로 따른다. */
function representationClass(time: ICAL.Time): string {
  if (time.isDate) {
    return 'date';
  }
  const zone = time.zone;
  if (!zone || zone.tzid === 'floating') {
    return 'floating';
  }
  if (zone === ICAL.Timezone.utcTimezone) {
    return 'utc';
  }
  return `tzid:${zone.tzid}`;
}

/**
 * vendor(ICAL.Event.getOccurrenceDetails)는 예외를 recurrenceId.toString() 문자열 키로
 * `occurrence.toString()` 또는 그 UTC 문자열과만 대조한다. 따라서 안전하게 매칭되는 조합만 허용한다:
 * date<->date, UTC 마스터<->UTC id, floating<->floating, TZID 마스터<->같은 TZID 또는 UTC id.
 * 그 외(다른 TZID 로 같은 순간을 표기, 벽시계 문자열만 우연히 같은 다른 TZID 등)는
 * vendor 가 적용하지 않거나 잘못 적용하므로 거부한다.
 */
function isSafeExceptionIdClass(master: string, id: string): boolean {
  if (master === 'date' || master === 'utc' || master === 'floating') {
    return id === master;
  }
  return id === 'utc' || id === master;
}

type PreparedException = {
  event: ICAL.Event;
  recurrenceId: ICAL.Time;
  key: string;
};

function exceptionInstantKey(time: ICAL.Time): string {
  return time.isDate ? `D:${formatDateOnly(time)}` : `T:${getNormalizedTimeKey(time)}`;
}

/** EXDATE 값을 인스턴스 key(date 또는 UTC instant)로 정규화. DTSTART 와 값 타입이 다르면 거부 */
function readExdateKeys(comp: ICAL.Component, dtstart: ICAL.Time): Set<string> {
  const keys = new Set<string>();
  for (const prop of comp.getAllProperties('exdate')) {
    for (const value of prop.getValues()) {
      if (!(value instanceof ICAL.Time) || value.isDate !== dtstart.isDate) {
        throw unsupported('EXDATE value type must match DTSTART');
      }
      keys.add(exceptionInstantKey(value));
    }
  }
  return keys;
}

function prepareExceptions(
  master: ICAL.Event,
  exceptions: readonly ICAL.Event[]
): PreparedException[] {
  if (exceptions.length === 0) {
    return [];
  }

  const masterClass = guardVendor(
    () => representationClass(master.startDate),
    'INVALID_ICS',
    'Failed to read event dates'
  );

  // RDATE 로 생성된 인스턴스는 DTSTART 와 표현이 다를 수 있어 예외 키 안전성을 보장할 수 없다.
  const masterHasRdate = guardVendor(() => master.component.hasProperty('rdate'));
  if (masterHasRdate) {
    throw unsupported('Recurrence exceptions with RDATE are not supported');
  }

  const seen = new Set<string>();
  const prepared: PreparedException[] = [];

  for (const exc of exceptions) {
    const recurrenceId = guardVendor(
      () => exc.recurrenceId,
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );
    if (!recurrenceId) {
      throw new CalendarImportError('INVALID_ICS', 'Failed to read exception recurrenceId');
    }

    const range = guardVendor(
      () => {
        const prop = exc.component.getFirstProperty('recurrence-id');
        const value = prop ? prop.getParameter('range') : undefined;
        return value === undefined || value === null ? null : String(value).trim().toUpperCase();
      },
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );
    if (range !== null) {
      if (range === 'THISANDFUTURE') {
        throw unsupported('RANGE=THISANDFUTURE recurrence exceptions are not supported');
      }
      throw new CalendarImportError('INVALID_ICS', 'Invalid recurrence exception range');
    }

    const idClass = guardVendor(
      () => representationClass(recurrenceId),
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );
    if (!isSafeExceptionIdClass(masterClass, idClass)) {
      throw unsupported('Recurrence exception identifier representation cannot be matched safely');
    }

    const instantKey = guardVendor(
      () => exceptionInstantKey(recurrenceId),
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );
    if (seen.has(instantKey)) {
      throw new CalendarImportError('INVALID_ICS', 'Duplicate recurrence exception');
    }
    seen.add(instantKey);

    const key = guardVendor(
      () => recurrenceId.toString(),
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );
    prepared.push({ event: exc, recurrenceId, key });
  }

  return prepared;
}

/**
 * 조회창을 인식하여 바운드된 step 내에서 master 및 exceptions 확장.
 * 모든 vendor 접근 오류는 고정 메시지 CalendarImportError 로 변환된다.
 */
export function expandEventOccurrences(
  masterEvent: ICAL.Event,
  exceptions: readonly ICAL.Event[],
  window: WindowBoundary,
  stepTracker: StepTracker,
  isCancelled: (comp: ICAL.Component) => boolean
): RawOccurrenceDetail[] {
  return guardVendor(
    () => expandEventOccurrencesUnsafe(masterEvent, exceptions, window, stepTracker, isCancelled),
    'INVALID_ICS',
    'Failed to expand recurrence'
  );
}

function expandEventOccurrencesUnsafe(
  masterEvent: ICAL.Event,
  exceptions: readonly ICAL.Event[],
  window: WindowBoundary,
  stepTracker: StepTracker,
  isCancelled: (comp: ICAL.Component) => boolean
): RawOccurrenceDetail[] {
  // master가 이미 취소 상태라면 해당 UID의 모든 예외를 포함하여 전체 제외
  const masterCancelled = guardVendor(
    () => isCancelled(masterEvent.component),
    'INVALID_ICS',
    'Failed to read event status'
  );
  if (masterCancelled) {
    return [];
  }

  const results: RawOccurrenceDetail[] = [];

  const isMasterRecurring = guardVendor(
    () => masterEvent.isRecurring(),
    'INVALID_ICS',
    'Failed to check if event is recurring'
  );

  if (!isMasterRecurring) {
    if (exceptions.length > 0) {
      throw new CalendarImportError(
        'INVALID_ICS',
        'Recurrence exception on non-recurring event'
      );
    }
    results.push(
      guardVendor(
        () => ({
          item: masterEvent,
          startDate: masterEvent.startDate,
          endDate: masterEvent.endDate,
          recurrenceId: null,
          recurring: false,
        }),
        'INVALID_ICS',
        'Failed to read event dates'
      )
    );
    return results;
  }

  const preparedExceptions = prepareExceptions(masterEvent, exceptions);

  // vendor 이터레이터(RecurExpansion)는 종료를 보장하지 못하므로 사용하지 않는다.
  const rule = guardVendor(
    () => readSingleRule(masterEvent.component),
    'INVALID_ICS',
    'Failed to create recurrence iterator'
  );
  if (!rule) {
    throw new CalendarImportError('INVALID_ICS', 'Failed to create recurrence iterator');
  }
  const expander = new RuleExpander(rule);
  const excludedKeys = guardVendor(
    () => readExdateKeys(masterEvent.component, rule.dtstart),
    'INVALID_ICS',
    'Failed to read EXDATE'
  );

  const matchedExceptions = new Set<ICAL.Event>();
  let hitHorizon = false;

  while (true) {
    const nextTime = guardVendor(
      () => expander.next(),
      'INVALID_ICS',
      'Failed to advance recurrence iterator'
    );

    if (!nextTime) {
      break;
    }

    // step 상한은 파일 전체 누적 합계 (최대 10000 steps)
    stepTracker.steps += 1;
    if (stepTracker.steps > stepTracker.maxSteps) {
      throw new CalendarImportError(
        'LIMIT_EXCEEDED',
        'Recurrence iteration step limit exceeded'
      );
    }

    // 창 종료 시점 판정: 예외로 이동된 시각이 아니라 규칙상 원래 인스턴스(nextTime) 기준!
    const pastHorizon = guardVendor(
      () => {
        if (nextTime.isDate) {
          return formatDateOnly(nextTime) >= window.endDateExclusive;
        }
        const nextUtc = nextTime.convertToZone(ICAL.Timezone.utcTimezone);
        return nextUtc.toJSDate().getTime() > window.endInstantMs;
      },
      'INVALID_ICS',
      'Failed to read occurrence time'
    );
    if (pastHorizon) {
      hitHorizon = true;
      break;
    }

    // EXDATE 로 제외된 인스턴스는 건너뛴다 (COUNT 는 EXDATE 이전에 소진된다)
    const excluded = guardVendor(
      () => excludedKeys.has(exceptionInstantKey(nextTime)),
      'INVALID_ICS',
      'Failed to read occurrence time'
    );
    if (excluded) {
      continue;
    }

    const details = guardVendor(
      () => masterEvent.getOccurrenceDetails(nextTime),
      'INVALID_ICS',
      'Failed to get occurrence details'
    );

    // vendor 와 동일한 문자열 키(occurrence.toString() 또는 UTC 문자열)로 매칭된 예외를 추적
    // (이중 반환 금지 및 orphan 판정용)
    if (preparedExceptions.length > 0) {
      const [occKey, utcKey] = guardVendor(
        () => [
          nextTime.toString(),
          nextTime.convertToZone(ICAL.Timezone.utcTimezone).toString(),
        ],
        'INVALID_ICS',
        'Failed to read occurrence time'
      );
      for (const exc of preparedExceptions) {
        if (exc.key === occKey || exc.key === utcKey) {
          matchedExceptions.add(exc.event);
        }
      }
    }

    const cancelled = guardVendor(
      () => isCancelled(details.item.component),
      'INVALID_ICS',
      'Failed to read event status'
    );
    if (cancelled) {
      continue;
    }

    // 실제 이동/반영된 시각 기준 창 교집합 판정 (예외 우선 단일 인스턴스)
    const inWindow = guardVendor(
      () => isOccurrenceInWindow(details.startDate, details.endDate, window),
      'INVALID_ICS',
      'Failed to read occurrence time'
    );
    if (inWindow) {
      results.push({
        item: details.item,
        startDate: details.startDate,
        endDate: details.endDate,
        recurrenceId: details.recurrenceId || nextTime,
        recurring: true,
      });

      if (results.length > 100) {
        throw new CalendarImportError(
          'LIMIT_EXCEEDED',
          'Occurrence count limit exceeded'
        );
      }
    }
  }

  // 매칭되지 않은 예외(orphan, COUNT/UNTIL 이후, 미래 예외) 검증
  for (const exc of preparedExceptions) {
    if (matchedExceptions.has(exc.event)) {
      continue;
    }

    // 1) 규칙이 자연 종료(COUNT/UNTIL 끝남)되었는데 예외가 남아있다면 orphan!
    if (!hitHorizon) {
      throw new CalendarImportError('INVALID_ICS', 'Orphan recurrence exception');
    }

    // 2) 규칙 horizon(창 종료)으로 인해 iterator가 중단된 경우
    const recId = exc.recurrenceId;
    const isRecIdPastHorizon = guardVendor(
      () => {
        if (recId.isDate) {
          return formatDateOnly(recId) >= window.endDateExclusive;
        }
        const recUtc = recId.convertToZone(ICAL.Timezone.utcTimezone);
        return recUtc.toJSDate().getTime() > window.endInstantMs;
      },
      'INVALID_ICS',
      'Failed to read exception recurrenceId'
    );

    if (!isRecIdPastHorizon) {
      // 창 종료 이전(이미 지나간 범위)인데 규칙 인스턴스에 매칭되지 않은 예외는 orphan!
      throw new CalendarImportError('INVALID_ICS', 'Orphan recurrence exception');
    }

    // 3) 미래 RECURRENCE-ID 예외:
    // 창 안으로 앞당겨진 미래 예외는 검증 불가능하므로 명시 오류
    const movedIntoWindow = guardVendor(
      () => isOccurrenceInWindow(exc.event.startDate, exc.event.endDate, window),
      'INVALID_ICS',
      'Failed to read event dates'
    );
    if (movedIntoWindow) {
      throw new CalendarImportError(
        'UNSUPPORTED_RECURRENCE',
        'Future recurrence exception moved into window cannot be verified'
      );
    }
    // 이동 후에도 창 밖이면 무시 허용
  }

  return results;
}
