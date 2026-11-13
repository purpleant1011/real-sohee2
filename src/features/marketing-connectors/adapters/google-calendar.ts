import 'server-only';

/**
 * Google Calendar 읽기 어댑터 (MC-02/MC-15)
 *
 * - 순수 어댑터: injectedFetch 주입, 상태 불변, Google Limited Use 준수
 * - Full / Incremental 배타적 인터페이스 (Google sync guide 계약 준수)
 * - calendarId 경로 검증(도트세그먼트/슬래시/인코딩 변형/제어문자 거부, 길이 256 상한)
 * - 120일 윈도우, 최대 10페이지(2,500건), 페이지당 500건, final page syncToken
 * - 스트림 1 MiB 상한, 페이지당 8초 / 작업 29초 / 총 30초 hard cap deadline 레이스
 * - PII(attendees, organizer, description 등) 원천 차단
 * - summary 1024 code points 초과 시 안전하게 자르고 warnings: ['summary_truncated'] 및 summaryTruncated: true
 * - status 엄격 검증(원문 미노출), start/end 실제 달력 유효성(윤초 허용/오프셋 범위) 검증, end < start 차단
 * - startTimeZone/endTimeZone 각각 독립 보존 (D3/D4)
 * - complete: boolean 플래그 및 동일 id Last-Write-Wins 중복 제거
 */

import {
  type GoogleAdapterError,
  type GoogleAdapterResult,
  type InjectedFetch,
  DEFAULT_PAGE_TIMEOUT_MS,
  WORK_DEADLINE_MS,
  CLEANUP_BUDGET_MS,
  MAX_CALENDAR_PAGE_BYTES,
  MAX_TOKEN_LENGTH,
  TimeoutError,
  validateCalendarId,
  validateCalendarWindow,
  validateOffsetRange,
  isValidCalendarDate,
  isValidCalendarTime,
  isValidCanonicalIANATimeZone,
  truncateToCodePoints,
  safeCancelBody,
  readBoundedStream,
  fetchWithTimeout,
  mapHttpStatusToAdapterError,
} from './google-adapter-common';

export type CalendarEventItem =
  | {
      kind: 'timed';
      id: string;
      summary: string;
      start: string; // ISO RFC3339 dateTime
      end: string;   // ISO RFC3339 dateTime
      /**
       * 주의: start와 end에 각각 지정된 startTimeZone과 endTimeZone은 서로 다를 수 있습니다(예: 국제선 비행 일정).
       * 소비자는 end 시각을 startTimeZone으로 해석해서는 안 되며, 각각의 timeZone을 독립적으로 취급해야 합니다.
       */
      startTimeZone?: string;
      endTimeZone?: string;
      status: 'confirmed' | 'tentative';
      summaryTruncated?: boolean;
    }
  | {
      kind: 'all_day';
      id: string;
      summary: string;
      startDate: string; // YYYY-MM-DD
      endDate: string;   // YYYY-MM-DD
      status: 'confirmed' | 'tentative';
      summaryTruncated?: boolean;
    }
  | {
      kind: 'tombstone';
      id: string;
      status: 'cancelled';
    };

/**
 * 주의: incremental 모드에서는 Google API 제약으로 인해 timeMin/timeMax 쿼리 파라미터를 사용할 수 없습니다.
 * 따라서 반환된 items에는 목표 윈도우 외의 변경사항도 포함될 수 있으며,
 * 상위 consumer는 애플리케이션 요구에 맞게 로컬 시간 창 필터링(start/end 기준)을 적용해야 합니다.
 */
export type CalendarEventsData = {
  items: CalendarEventItem[];
  complete: boolean; // 마지막 페이지이며 nextSyncToken이 있으면 true, maxPages 조기 종료/nextPageToken이 남아있으면 false
};

export type FetchCalendarEventsInput =
  | {
      mode: 'full';
      calendarId: string;
      accessToken: string;
      timeMin: string;
      timeMax: string;
      pageToken?: string;
      maxPages?: number;
      injectedFetch?: InjectedFetch;
    }
  | {
      mode: 'incremental';
      calendarId: string;
      accessToken: string;
      syncToken: string;
      pageToken?: string;
      maxPages?: number;
      injectedFetch?: InjectedFetch;
    };

interface RawGoogleCalendarEvent {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  start?: {
    dateTime?: unknown;
    date?: unknown;
    timeZone?: unknown;
  };
  end?: {
    dateTime?: unknown;
    date?: unknown;
    timeZone?: unknown;
  };
}

interface RawGoogleCalendarResponse {
  kind?: unknown;
  nextPageToken?: unknown;
  nextSyncToken?: unknown;
  items?: unknown;
}

const MAX_PAGES_LIMIT = 10;
const PAGE_SIZE = 250;
const MAX_ITEMS_PER_PAGE = 500;
const MAX_TOTAL_ITEMS_LIMIT = 2500;
const MAX_SUMMARY_CODE_POINTS = 1024;

const RFC3339_PARSER = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i;
const DATE_ONLY_PARSER = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Google Calendar 이벤트 목록 조회 순수 어댑터
 */
export async function fetchCalendarEvents(
  input: FetchCalendarEventsInput
): Promise<GoogleAdapterResult<CalendarEventsData>> {
  const overallStartTime = Date.now();
  const workDeadline = overallStartTime + WORK_DEADLINE_MS;

  // 1. 기본 입력 유효성 및 모드 상호배타 검증
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Input must be a valid object' },
    };
  }

  const rawInput = input as Record<string, unknown>;
  const mode = rawInput.mode;

  if (mode !== 'full' && mode !== 'incremental') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Mode must be either "full" or "incremental"' },
    };
  }

  // calendarId 검증
  const calendarValidation = validateCalendarId(rawInput.calendarId);
  if (!calendarValidation.ok) {
    return calendarValidation;
  }
  const encodedCalendarId = calendarValidation.encodedId;

  // accessToken 검증
  if (typeof rawInput.accessToken !== 'string' || !rawInput.accessToken.trim()) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'accessToken must be a non-empty string' },
    };
  }
  const accessToken = rawInput.accessToken.trim();

  // 모드별 윈도우 및 토큰 상호배타 검증
  let timeMin: string | undefined;
  let timeMax: string | undefined;
  let syncToken: string | undefined;

  if (mode === 'full') {
    if ('syncToken' in rawInput && rawInput.syncToken !== undefined) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'syncToken cannot be used in "full" mode' },
      };
    }

    const windowValidation = validateCalendarWindow(rawInput.timeMin, rawInput.timeMax);
    if (!windowValidation.ok) {
      return windowValidation;
    }
    timeMin = windowValidation.timeMin;
    timeMax = windowValidation.timeMax;
  } else {
    // incremental
    if (
      ('timeMin' in rawInput && rawInput.timeMin !== undefined) ||
      ('timeMax' in rawInput && rawInput.timeMax !== undefined)
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'timeMin/timeMax cannot be used with syncToken in "incremental" mode',
        },
      };
    }

    if (
      typeof rawInput.syncToken !== 'string' ||
      !rawInput.syncToken.trim() ||
      rawInput.syncToken.length > MAX_TOKEN_LENGTH
    ) {
      return {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'Valid non-empty syncToken is required in "incremental" mode',
        },
      };
    }
    syncToken = rawInput.syncToken.trim();
  }

  // pageToken 검증
  let currentPageToken: string | undefined;
  if ('pageToken' in rawInput && rawInput.pageToken !== undefined) {
    if (
      typeof rawInput.pageToken !== 'string' ||
      !rawInput.pageToken.trim() ||
      rawInput.pageToken.length > MAX_TOKEN_LENGTH
    ) {
      return {
        ok: false,
        error: { code: 'invalid_input', message: 'Invalid pageToken' },
      };
    }
    currentPageToken = rawInput.pageToken.trim();
  }

  const requestedMaxPages =
    typeof rawInput.maxPages === 'number' && rawInput.maxPages > 0
      ? Math.min(rawInput.maxPages, MAX_PAGES_LIMIT)
      : MAX_PAGES_LIMIT;

  const fetchFn = input.injectedFetch ?? fetch;

  // 동일 id 중복 제거를 위한 Map (Last-Write-Wins 정책)
  const itemsById = new Map<string, CalendarEventItem>();
  const warningsSet = new Set<string>();
  let totalProcessedItemsCount = 0;
  let pageCount = 0;
  let lastSyncToken: string | undefined;
  let lastPageToken: string | undefined;

  while (pageCount < requestedMaxPages) {
    const pageStartTime = Date.now();
    const remainingWorkMs = workDeadline - pageStartTime;
    if (remainingWorkMs <= 0) {
      return {
        ok: false,
        error: { code: 'timeout', message: 'Total request deadline of 30000ms exceeded' },
      };
    }

    // 페이지별 총 budget은 최대 8000ms이며, 남은 work deadline을 초과할 수 없음
    const pageBudgetMs = Math.min(DEFAULT_PAGE_TIMEOUT_MS, remainingWorkMs);
    const pageDeadline = pageStartTime + pageBudgetMs;
    pageCount++;

    // URL 파라미터 조합
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`
    );
    url.searchParams.set('maxResults', PAGE_SIZE.toString());

    // Google 공식 sync 가이드(https://developers.google.com/calendar/api/guides/sync):
    // full sync와 incremental sync 모두 동일하게 singleEvents=true 설정
    url.searchParams.set('singleEvents', 'true');

    if (mode === 'full') {
      if (timeMin) url.searchParams.set('timeMin', timeMin);
      if (timeMax) url.searchParams.set('timeMax', timeMax);
    } else if (syncToken) {
      url.searchParams.set('syncToken', syncToken);
    }

    if (currentPageToken) {
      url.searchParams.set('pageToken', currentPageToken);
    }

    const remainingForHeader = pageDeadline - Date.now();
    if (remainingForHeader <= 0) {
      return {
        ok: false,
        error: { code: 'timeout', message: 'Google Calendar API request timed out' },
      };
    }

    // AbortController를 생성하여 헤더 fetch부터 body read 완료까지 수명을 유지 (D1)
    const pageController = new AbortController();

    let response: Response;
    try {
      response = await fetchWithTimeout(
        fetchFn,
        url.toString(),
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        remainingForHeader,
        pageController
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        return {
          ok: false,
          error: { code: 'timeout', message: 'Google Calendar API request timed out' },
        };
      }
      return {
        ok: false,
        error: { code: 'network_error', message: 'Network error occurred during Google API request' },
      };
    }

    // HTTP 상태 코드 에러 처리 (비OK 응답 시 bounded body cancel)
    if (!response.ok) {
      await safeCancelBody(response.body, CLEANUP_BUDGET_MS);
      return {
        ok: false,
        error: mapHttpStatusToAdapterError(response.status),
      };
    }

    // 스트림 바이트 한도 강제 (헤더 수신에 소요된 시간을 차감한 남은 pageDeadline 공유!)
    const remainingForBody = pageDeadline - Date.now();
    if (remainingForBody <= 0) {
      pageController.abort();
      await safeCancelBody(response.body, CLEANUP_BUDGET_MS);
      return {
        ok: false,
        error: { code: 'timeout', message: 'Google Calendar response body read timed out' },
      };
    }

    let bodyResult: { ok: true; text: string } | { ok: false; error: GoogleAdapterError };
    try {
      bodyResult = await readBoundedStream(response, MAX_CALENDAR_PAGE_BYTES, remainingForBody);
    } catch (err) {
      pageController.abort();
      await safeCancelBody(response.body, CLEANUP_BUDGET_MS);
      if (err instanceof TimeoutError) {
        return {
          ok: false,
          error: { code: 'timeout', message: 'Google Calendar response body read timed out' },
        };
      }
      return {
        ok: false,
        error: { code: 'network_error', message: 'Failed to read response stream' },
      };
    }

    if (!bodyResult.ok) {
      return bodyResult;
    }

    // JSON 파싱
    let json: unknown;
    try {
      json = JSON.parse(bodyResult.text);
    } catch {
      return {
        ok: false,
        error: { code: 'invalid_json', message: 'Failed to parse Google API response as JSON' },
      };
    }

    // 스키마 검증
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return {
        ok: false,
        error: { code: 'invalid_schema', message: 'Response payload is not a valid object' },
      };
    }

    const rawResponse = json as RawGoogleCalendarResponse;
    if (!Array.isArray(rawResponse.items)) {
      return {
        ok: false,
        error: { code: 'invalid_schema', message: 'Response items field must be an array' },
      };
    }

    // 페이지당 item 상한 검증 (500건)
    if (rawResponse.items.length > MAX_ITEMS_PER_PAGE) {
      return {
        ok: false,
        error: {
          code: 'limit_exceeded',
          message: `Single page item count exceeded ${MAX_ITEMS_PER_PAGE}`,
        },
      };
    }

    // 누적 item 상한 검증 (2500건)
    totalProcessedItemsCount += rawResponse.items.length;
    if (totalProcessedItemsCount > MAX_TOTAL_ITEMS_LIMIT) {
      return {
        ok: false,
        error: {
          code: 'limit_exceeded',
          message: `Total accumulated items exceeded limit of ${MAX_TOTAL_ITEMS_LIMIT}`,
        },
      };
    }

    // DTO 변환 및 PII 필드 원천 배제
    for (const rawItem of rawResponse.items) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'Event item must be an object' },
        };
      }

      const item = rawItem as RawGoogleCalendarEvent;
      if (typeof item.id !== 'string' || !item.id) {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'Event id is missing or invalid' },
        };
      }

      const eventId = item.id;

      // status 검증: 필드 누락(undefined)만 'confirmed' 기본, 알 수 없는 값은 고정 메시지로 실패 (원문 미노출)
      let status: 'confirmed' | 'tentative' | 'cancelled';
      if (item.status === undefined) {
        status = 'confirmed';
      } else if (typeof item.status === 'string') {
        if (item.status === 'confirmed' || item.status === 'tentative' || item.status === 'cancelled') {
          status = item.status;
        } else {
          return {
            ok: false,
            error: { code: 'invalid_schema', message: 'Unknown or invalid event status' },
          };
        }
      } else {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'Event status must be a string' },
        };
      }

      // 1) Cancelled tombstone
      if (status === 'cancelled') {
        itemsById.set(eventId, {
          kind: 'tombstone',
          id: eventId,
          status: 'cancelled',
        });
        continue;
      }

      // summary 검증 (1024 code points 초과 시 자르고 warnings 추가, D5)
      let summary = '';
      let summaryTruncated = false;
      if (item.summary !== undefined && item.summary !== null) {
        if (typeof item.summary !== 'string') {
          return {
            ok: false,
            error: { code: 'invalid_schema', message: 'Event summary must be a string' },
          };
        }
        const truncatedResult = truncateToCodePoints(item.summary, MAX_SUMMARY_CODE_POINTS);
        summary = truncatedResult.text;
        if (truncatedResult.truncated) {
          summaryTruncated = true;
          warningsSet.add('summary_truncated');
        }
      }

      // 2) Timed event (start.dateTime & end.dateTime)
      if (
        item.start &&
        typeof item.start.dateTime === 'string' &&
        item.end &&
        typeof item.end.dateTime === 'string'
      ) {
        const startMatch = RFC3339_PARSER.exec(item.start.dateTime);
        const endMatch = RFC3339_PARSER.exec(item.end.dateTime);

        if (!startMatch || !endMatch) {
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Event start/end dateTime format is invalid',
            },
          };
        }

        const startCalValid =
          isValidCalendarDate(Number(startMatch[1]), Number(startMatch[2]), Number(startMatch[3])) &&
          isValidCalendarTime(Number(startMatch[4]), Number(startMatch[5]), Number(startMatch[6]));
        const endCalValid =
          isValidCalendarDate(Number(endMatch[1]), Number(endMatch[2]), Number(endMatch[3])) &&
          isValidCalendarTime(Number(endMatch[4]), Number(endMatch[5]), Number(endMatch[6]));

        if (!startCalValid || !endCalValid) {
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Event start/end dateTime contains invalid calendar date or time',
            },
          };
        }

        const startHasOffset = Boolean(startMatch[7]);
        const endHasOffset = Boolean(endMatch[7]);

        let startTimeZoneField: string | undefined;
        let endTimeZoneField: string | undefined;

        if (startHasOffset && endHasOffset) {
          // RFC3339 offset 범위 검증 (+99:99 거부)
          if (!validateOffsetRange(startMatch[7]) || !validateOffsetRange(endMatch[7])) {
            return {
              ok: false,
              error: {
                code: 'invalid_schema',
                message: 'Event start/end dateTime offset is out of valid range',
              },
            };
          }

          // start > end 시간 역전 검증 (D5)
          const startMs = Date.parse(item.start.dateTime);
          const endMs = Date.parse(item.end.dateTime);
          if (endMs < startMs) {
            return {
              ok: false,
              error: {
                code: 'invalid_schema',
                message: 'Event end time cannot be before start time',
              },
            };
          }
        } else if (!startHasOffset && !endHasOffset) {
          // offset 없는 floating dateTime인 경우: start/end IANA timeZone 엄격 canonical 일치 검사 (D4)
          if (
            isValidCanonicalIANATimeZone(item.start.timeZone) &&
            isValidCanonicalIANATimeZone(item.end.timeZone)
          ) {
            startTimeZoneField = item.start.timeZone as string;
            endTimeZoneField = item.end.timeZone as string;

            // start > end 비교
            // 같은 timezone인 경우 직접 사전식 비교 가능
            if (startTimeZoneField === endTimeZoneField) {
              if (item.end.dateTime < item.start.dateTime) {
                return {
                  ok: false,
                  error: {
                    code: 'invalid_schema',
                    message: 'Event end time cannot be before start time',
                  },
                };
              }
            }
          } else {
            return {
              ok: false,
              error: {
                code: 'invalid_schema',
                message: 'Floating dateTime requires valid canonical IANA timeZone on start and end',
              },
            };
          }
        } else {
          // 한쪽만 offset이 있는 불일치 케이스
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Mismatched offset presence between start and end dateTime',
            },
          };
        }

        const timedItem: CalendarEventItem = {
          kind: 'timed',
          id: eventId,
          summary,
          start: item.start.dateTime,
          end: item.end.dateTime,
          status,
          ...(startTimeZoneField ? { startTimeZone: startTimeZoneField } : {}),
          ...(endTimeZoneField ? { endTimeZone: endTimeZoneField } : {}),
          ...(summaryTruncated ? { summaryTruncated: true } : {}),
        };

        itemsById.set(eventId, timedItem);
        continue;
      }

      // 3) All-day event (start.date & end.date with YYYY-MM-DD format and valid calendar date)
      if (
        item.start &&
        typeof item.start.date === 'string' &&
        item.end &&
        typeof item.end.date === 'string'
      ) {
        const startMatch = DATE_ONLY_PARSER.exec(item.start.date);
        const endMatch = DATE_ONLY_PARSER.exec(item.end.date);

        if (!startMatch || !endMatch) {
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Event start/end date must follow YYYY-MM-DD format',
            },
          };
        }

        const startDateValid = isValidCalendarDate(
          Number(startMatch[1]),
          Number(startMatch[2]),
          Number(startMatch[3])
        );
        const endDateValid = isValidCalendarDate(
          Number(endMatch[1]),
          Number(endMatch[2]),
          Number(endMatch[3])
        );

        if (!startDateValid || !endDateValid) {
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Event start/end date contains invalid calendar date',
            },
          };
        }

        if (item.end.date < item.start.date) {
          return {
            ok: false,
            error: {
              code: 'invalid_schema',
              message: 'Event end date cannot be before start date',
            },
          };
        }

        const allDayItem: CalendarEventItem = {
          kind: 'all_day',
          id: eventId,
          summary,
          startDate: item.start.date,
          endDate: item.end.date,
          status,
          ...(summaryTruncated ? { summaryTruncated: true } : {}),
        };

        itemsById.set(eventId, allDayItem);
        continue;
      }

      // 필수 날짜 정보 결여 시 스키마 에러
      return {
        ok: false,
        error: {
          code: 'invalid_schema',
          message: 'Event is missing valid start/end dateTime or date',
        },
      };
    }

    // 토큰 길이 및 형식 검증 & 무한 루프 방지
    if (rawResponse.nextPageToken !== undefined) {
      if (
        typeof rawResponse.nextPageToken !== 'string' ||
        rawResponse.nextPageToken.length > MAX_TOKEN_LENGTH
      ) {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'Invalid nextPageToken in response' },
        };
      }

      // 요청에 사용된 pageToken과 동일한 nextPageToken이 오면 무한루프
      if (rawResponse.nextPageToken === currentPageToken) {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'nextPageToken loop detected' },
        };
      }

      lastPageToken = rawResponse.nextPageToken;
      currentPageToken = rawResponse.nextPageToken;
    } else {
      lastPageToken = undefined;
      currentPageToken = undefined;
    }

    if (rawResponse.nextSyncToken !== undefined) {
      if (
        typeof rawResponse.nextSyncToken !== 'string' ||
        rawResponse.nextSyncToken.length > MAX_TOKEN_LENGTH
      ) {
        return {
          ok: false,
          error: { code: 'invalid_schema', message: 'Invalid nextSyncToken in response' },
        };
      }
      lastSyncToken = rawResponse.nextSyncToken;
    }

    // 다음 페이지가 없거나, 호출자가 요청한 최대 페이지(단일 페이지 등)에 도달한 경우 루프 탈출
    if (!currentPageToken || pageCount >= requestedMaxPages) {
      break;
    }
  }

  // 10페이지를 모두 소비했는데도 여전히 nextPageToken이 남아있는 경우 limit_exceeded
  if (currentPageToken && requestedMaxPages >= MAX_PAGES_LIMIT) {
    return {
      ok: false,
      error: {
        code: 'limit_exceeded',
        message: `Exceeded maximum page budget of ${MAX_PAGES_LIMIT} pages (2,500 items)`,
      },
    };
  }

  // 완료 여부 판정: 마지막 페이지이며 nextPageToken이 없고 nextSyncToken이 있으면 complete = true
  const isComplete = !lastPageToken && Boolean(lastSyncToken);

  const result: GoogleAdapterResult<CalendarEventsData> = {
    ok: true,
    data: {
      items: Array.from(itemsById.values()),
      complete: isComplete,
    },
    derivedFromGoogle: true,
  };

  if (warningsSet.size > 0) {
    result.warnings = Array.from(warningsSet);
  }

  if (lastPageToken) {
    result.nextPageToken = lastPageToken;
  } else if (lastSyncToken) {
    result.nextSyncToken = lastSyncToken;
  }

  return result;
}
