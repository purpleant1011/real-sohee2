import { CanonicalPublicationSchedule } from './types';

export interface CalendarGridDay {
  year: number;
  month: number; // 1 ~ 12
  day: number; // 1 ~ 31
  dateString: string; // YYYY-MM-DD
  isCurrentMonth: boolean;
  isToday: boolean;
  dayOfWeek: number; // 0: 일, 1: 월, ..., 6: 토
}

/**
 * 윤년 판별 알고리즘 (ANI-827)
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 특정 연월의 정확한 일수 반환 (ANI-827)
 * 32~34일 등 비정상 가상 날짜 원천 차단
 */
export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Month must be between 1 and 12.`);
  }

  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

/**
 * YYYY-MM-DD 문자열 포맷팅
 */
function formatDateString(year: number, month: number, day: number): string {
  const m = month < 10 ? `0${month}` : `${month}`;
  const d = day < 10 ? `0${day}` : `${day}`;
  return `${year}-${m}-${d}`;
}

/**
 * ANI-827: 엄격하게 검증된 달력 그리드 일자 생성기
 * 절대 32일 이상을 반환하지 않으며, 전월/익월 패딩 역시 정확한 일자만을 매핑
 */
export function getValidCalendarGridDays(
  year: number,
  month: number,
  today: Date = new Date()
): CalendarGridDay[] {
  const daysInCurrentMonth = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0(일) ~ 6(토)

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth);

  const grid: CalendarGridDay[] = [];
  const todayStr = formatDateString(today.getFullYear(), today.getMonth() + 1, today.getDate());

  // 1. 이전 달 잔여 패딩 채우기
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    if (day <= 0 || day > daysInPrevMonth) {
      throw new Error(`Illegal day detected in prevMonth: ${day}`);
    }
    const dateString = formatDateString(prevYear, prevMonth, day);
    const dayOfWeek = new Date(prevYear, prevMonth - 1, day).getDay();

    grid.push({
      year: prevYear,
      month: prevMonth,
      day,
      dateString,
      isCurrentMonth: false,
      isToday: dateString === todayStr,
      dayOfWeek,
    });
  }

  // 2. 이번 달 일자 채우기 (1 ~ 말일)
  for (let day = 1; day <= daysInCurrentMonth; day++) {
    const dateString = formatDateString(year, month, day);
    const dayOfWeek = new Date(year, month - 1, day).getDay();

    grid.push({
      year,
      month,
      day,
      dateString,
      isCurrentMonth: true,
      isToday: dateString === todayStr,
      dayOfWeek,
    });
  }

  // 3. 다음 달 시작 패딩 채우기 (7의 배수가 되도록)
  const remaining = (7 - (grid.length % 7)) % 7;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const daysInNextMonth = getDaysInMonth(nextYear, nextMonth);

  for (let day = 1; day <= remaining; day++) {
    if (day > daysInNextMonth) {
      throw new Error(`Illegal day detected in nextMonth: ${day}`);
    }
    const dateString = formatDateString(nextYear, nextMonth, day);
    const dayOfWeek = new Date(nextYear, nextMonth - 1, day).getDay();

    grid.push({
      year: nextYear,
      month: nextMonth,
      day,
      dateString,
      isCurrentMonth: false,
      isToday: dateString === todayStr,
      dayOfWeek,
    });
  }

  return grid;
}

/**
 * ANI-837: 통합 캘린더 이벤트 매니저 (월/주/일 뷰 간 동일 event_id 유지 및 동기화)
 */
export class CalendarEventManager {
  private events: Map<string, CanonicalPublicationSchedule> = new Map();

  addOrUpdateEvent(event: CanonicalPublicationSchedule): void {
    this.events.set(event.calendarEventId, { ...event, updatedAt: new Date().toISOString() });
  }

  getEvent(calendarEventId: string): CanonicalPublicationSchedule | undefined {
    return this.events.get(calendarEventId);
  }

  /**
   * 월간 뷰 이벤트 조회 (YYYY-MM)
   */
  getEventsByMonth(workspaceId: string, year: number, month: number): CanonicalPublicationSchedule[] {
    const prefix = formatDateString(year, month, 1).slice(0, 7); // 'YYYY-MM'
    return Array.from(this.events.values()).filter(
      (e) => e.workspaceId === workspaceId && e.scheduledAt.startsWith(prefix)
    );
  }

  /**
   * 주간 또는 일간 뷰 이벤트 조회 (YYYY-MM-DD 범위)
   */
  getEventsByDateRange(
    workspaceId: string,
    startDateStr: string,
    endDateStr: string
  ): CanonicalPublicationSchedule[] {
    const startMs = new Date(startDateStr).getTime();
    const endMs = new Date(endDateStr).getTime() + 86400000; // inclusive
    return Array.from(this.events.values()).filter((e) => {
      const eMs = new Date(e.scheduledAt).getTime();
      return e.workspaceId === workspaceId && eMs >= startMs && eMs < endMs;
    });
  }

  /**
   * 드래그 앤 드롭 또는 시간 변경 (동일 event_id 유지)
   */
  rescheduleEvent(
    calendarEventId: string,
    newScheduledAt: string
  ): CanonicalPublicationSchedule {
    const existing = this.events.get(calendarEventId);
    if (!existing) {
      throw new Error(`Calendar event not found: ${calendarEventId}`);
    }

    const updated: CanonicalPublicationSchedule = {
      ...existing,
      scheduledAt: newScheduledAt,
      updatedAt: new Date().toISOString(),
    };

    this.events.set(calendarEventId, updated);
    return updated;
  }
}
