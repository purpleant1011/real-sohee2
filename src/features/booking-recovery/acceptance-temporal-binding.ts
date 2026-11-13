interface OfferedSlot {
  id: string;
  startsAt: string;
}

interface DateConstraint {
  year?: number;
  month?: number;
  day: number;
}

/** Bounded Korean acceptance grammar. Unsupported conditions require review rather than guessing. */
export function matchAcceptedSlot(
  text: string,
  slots: readonly OfferedSlot[],
  timezone: string
): string | null {
  const dates: DateConstraint[] = [];
  const times: Array<{ hour: number; minute: number }> = [];
  const weekdays: number[] = [];
  let invalid = false;
  let rest = text.replace(/(?<!\d)(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/gu,
    (_match, year: string | undefined, month: string, day: string) => {
      dates.push({ year: year ? Number(year) : undefined, month: Number(month), day: Number(day) });
      return ' ';
    });
  rest = rest.replace(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/gu,
    (_match, year: string, month: string, day: string) => {
      dates.push({ year: Number(year), month: Number(month), day: Number(day) });
      return ' ';
    });
  rest = rest.replace(/(?<!\d)(\d{1,2})\s*일/gu, (_match, day: string) => {
    dates.push({ day: Number(day) });
    return ' ';
  });
  rest = rest.replace(/([일월화수목금토])요일/gu, (_match, day: string) => {
    weekdays.push('일월화수목금토'.indexOf(day));
    return ' ';
  });
  const addTime = (period: string | undefined, hour: number, minute: number, ambiguous: boolean) => {
    if (minute < 0 || minute > 59 || hour < 0 || hour > 23 ||
      (period && (hour < 1 || hour > 12)) || (!period && ambiguous && hour >= 1 && hour <= 12)) {
      invalid = true;
      return;
    }
    times.push({ hour: period ? hour % 12 + (period === '오후' ? 12 : 0) : hour, minute });
  };
  rest = rest.replace(/(?:(오전|오후)\s*)?(?<!\d)(\d{1,2}):(\d{2})(?!\d)/gu,
    (_match, period: string | undefined, hour: string, minute: string) => {
      addTime(period, Number(hour), Number(minute), hour.length === 1);
      return ' ';
    });
  rest = rest.replace(/(?:(오전|오후)\s*)?(?<!\d)(\d{1,2})\s*시(?:\s*(반|\d{1,2}\s*분))?/gu,
    (_match, period: string | undefined, hour: string, minute: string | undefined) => {
      addTime(period, Number(hour), minute === '반' ? 30 : minute ? Number(minute.replace(/\D/gu, '')) : 0, true);
      return ' ';
    });
  // Only the acceptance intent/connectors may remain after recognized temporal constraints.
  // Relative dates, alternative times, prices, foreign timezones and unknown date forms stay visible and fail closed.
  const intent = rest.replace(/\s/gu, '');
  if (invalid || !/^(?:네[,!.~]*)?(?:(?:그|해당)시간)?(?:으로|로|에)?(?:예약해주(?:세요|십시오)|예약할게요|예약(?:을)?부탁(?:드려요|합니다)?|진행할게요|갈게요|할게요)[!.~]*$/u.test(intent)) return null;

  if (!dates.length && !times.length && !weekdays.length && slots.length !== 1) return null;
  if (slots.some((slot) => !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(slot.startsAt) ||
    !Number.isFinite(Date.parse(slot.startsAt)))) return null;
  try {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    const matches = slots.filter((slot) => {
      const at = new Date(slot.startsAt);
      const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
      return Number(parts.second) === 0 &&
        dates.every((date) => (date.year === undefined || date.year === Number(parts.year)) &&
          (date.month === undefined || date.month === Number(parts.month)) && date.day === Number(parts.day)) &&
        times.every((time) => time.hour === Number(parts.hour) && time.minute === Number(parts.minute)) &&
        weekdays.every((day) => day === ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday));
    });
    return matches.length === 1 ? matches[0].id : null;
  } catch {
    return null;
  }
}
