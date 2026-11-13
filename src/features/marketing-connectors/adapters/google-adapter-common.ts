/**
 * Google 읽기 어댑터 공통 규격 및 유틸리티
 *
 * - 원칙: 순수 함수, 최소 권한, Google Limited Use 보존, fail-closed
 */

export type GoogleAdapterErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'sync_expired'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'invalid_json'
  | 'invalid_schema'
  | 'network_error'
  | 'response_too_large'
  | 'limit_exceeded'
  | 'unsupported_structure';

export type GoogleAdapterError = {
  code: GoogleAdapterErrorCode;
  status?: number;
  message: string;
};

export type GoogleAdapterResult<T> =
  | {
      ok: true;
      data: T;
      derivedFromGoogle: true;
      nextSyncToken?: string;
      nextPageToken?: string;
      warnings?: string[];
    }
  | {
      ok: false;
      error: GoogleAdapterError;
    };

export type InjectedFetch = typeof fetch;

export const DEFAULT_PAGE_TIMEOUT_MS = 8000;
export const DEFAULT_GLOBAL_TIMEOUT_MS = 30000;
export const WORK_DEADLINE_MS = 29000; // 29s work deadline (1s cleanup budget reserved for hard cap 30s)
export const CLEANUP_BUDGET_MS = 1000;
export const MAX_CALENDAR_PAGE_BYTES = 1024 * 1024; // 1 MiB per page
export const MAX_TOKEN_LENGTH = 4096;
export const MAX_CALENDAR_ID_LENGTH = 256;

export class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * calendarId 안전성 검증
 * - 필수 문자열, 길이 1~256
 * - '.' 및 '..' 단독 거부
 * - 'primary' 거부 (대소문자 무관, 명시적 선택 원칙)
 * - 경로 탐색('..') 및 슬래시('/', '\') 차단
 * - URL 인코딩 dot(%2e, %2E) 및 더블 인코딩(%25) 차단
 * - 제어 문자(0x00~0x1F, 0x7F) 차단
 */
export function validateCalendarId(
  calendarId: unknown
): { ok: true; encodedId: string } | { ok: false; error: GoogleAdapterError } {
  if (typeof calendarId !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'calendarId must be a non-empty string' },
    };
  }

  const trimmed = calendarId.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'calendarId cannot be empty' },
    };
  }

  if (trimmed.length > MAX_CALENDAR_ID_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'invalid_input',
        message: `calendarId exceeds maximum length of ${MAX_CALENDAR_ID_LENGTH} characters`,
      },
    };
  }

  if (trimmed === '.' || trimmed === '..') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Dot segments are not allowed as calendarId' },
    };
  }

  if (trimmed.toLowerCase() === 'primary') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Default "primary" calendarId is prohibited. Explicit choice required.' },
    };
  }

  // Traversal & separator check
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Invalid calendarId path format' },
    };
  }

  // Encoded dot or double encoding check (%2e, %2E, %25)
  if (/%2e|%25/i.test(trimmed)) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Encoded dot or percent sequences are prohibited in calendarId' },
    };
  }

  // Control characters check (\x00-\x1F, \x7F)
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'calendarId contains invalid control characters' },
    };
  }

  return { ok: true, encodedId: encodeURIComponent(trimmed) };
}

const RFC3339_PARSER = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const MAX_WINDOW_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * RFC3339 timezone 오프셋 범위 검증 (+hh:mm / -hh:mm / Z)
 * - hh <= 23 && mm <= 59
 */
export function validateOffsetRange(offset: string): boolean {
  if (offset === 'Z' || offset === 'z') {
    return true;
  }
  const match = /^[+-](\d{2}):(\d{2})$/.exec(offset);
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59;
}

/**
 * 캘린더 시간 윈도우 검증
 * - RFC3339 offset 필수 및 범위 검증
 * - timeMin <= timeMax
 * - 최대 120일 폭
 */
export function validateCalendarWindow(
  timeMin: unknown,
  timeMax: unknown
): { ok: true; timeMin: string; timeMax: string } | { ok: false; error: GoogleAdapterError } {
  if (typeof timeMin !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'timeMin must be an RFC3339 string with timezone offset' },
    };
  }

  const startMatch = RFC3339_PARSER.exec(timeMin);
  if (!startMatch || !validateOffsetRange(startMatch[7])) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'timeMin must be an RFC3339 string with valid timezone offset' },
    };
  }

  if (typeof timeMax !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'timeMax must be an RFC3339 string with timezone offset' },
    };
  }

  const endMatch = RFC3339_PARSER.exec(timeMax);
  if (!endMatch || !validateOffsetRange(endMatch[7])) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'timeMax must be an RFC3339 string with valid timezone offset' },
    };
  }

  const startMs = Date.parse(timeMin);
  const endMs = Date.parse(timeMax);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'Invalid date format for timeMin or timeMax' },
    };
  }

  if (startMs > endMs) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: 'timeMin cannot be greater than timeMax' },
    };
  }

  if (endMs - startMs > MAX_WINDOW_DAYS * MS_PER_DAY) {
    return {
      ok: false,
      error: { code: 'invalid_input', message: `Calendar query window cannot exceed ${MAX_WINDOW_DAYS} days` },
    };
  }

  return { ok: true, timeMin, timeMax };
}

/**
 * 윤년 판정
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 실제 달력 날짜 유효성 검사 (2026-13-45, 2026-02-29 평년 거부)
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * 실제 달력 시간 유효성 검사 (00~23시, 00~59분, 00~60초 (초 60 윤초 허용))
 */
export function isValidCalendarTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 60;
}

/**
 * IANA timeZone 엄격 Canonical 정확 일치 검사 (D4)
 * - Intl.DateTimeFormat resolvedOptions().timeZone과 입력 문자열이 대소문자/공백까지 정확히 동일해야 함
 * - 오프셋 문자열(+09:00 등) 및 소문자/공백 거부
 * - 'UTC', 'Etc/UTC' 정식 명칭 허용
 * - Intl 미지원 환경 시 fail-closed (false)
 */
export function isValidCanonicalIANATimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== 'string' || !timeZone) {
    return false;
  }
  // 오프셋 형태(+09:00, -05:00 등)는 IANA 명칭이 아니므로 사전 차단
  if (/^[+-]\d{2}(?::?\d{2})?$/i.test(timeZone)) {
    return false;
  }
  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    return false;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone });
    const resolved = formatter.resolvedOptions().timeZone;
    if (resolved === timeZone) {
      return true;
    }
    if (timeZone === 'Etc/UTC' && resolved === 'UTC') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * UTF-16 surrogate pair를 분리하지 않는 안전한 code point 단위 슬라이스 (D5)
 */
export function truncateToCodePoints(str: string, maxCodePoints: number): { text: string; truncated: boolean } {
  const codePoints = Array.from(str);
  if (codePoints.length <= maxCodePoints) {
    return { text: str, truncated: false };
  }
  return {
    text: codePoints.slice(0, maxCodePoints).join(''),
    truncated: true,
  };
}

/**
 * 안전한 바운디드 reader.cancel 및 lock 해제 (최대 1000ms 내 종료 보장)
 */
export async function safeCancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = CLEANUP_BUDGET_MS
): Promise<void> {
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    cancelTimer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([reader.cancel().catch(() => {}), timeoutPromise]);
  } catch {
    // ignore
  } finally {
    if (cancelTimer !== undefined) clearTimeout(cancelTimer);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * 안전한 바운디드 body.cancel (최대 1000ms 내 종료 보장)
 */
export async function safeCancelBody(
  body: ReadableStream<Uint8Array> | null | undefined,
  timeoutMs = CLEANUP_BUDGET_MS
): Promise<void> {
  if (!body) return;
  // If already locked, do not attempt to cancel body directly
  if (body.locked) return;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    cancelTimer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([body.cancel().catch(() => {}), timeoutPromise]);
  } catch {
    // ignore
  } finally {
    if (cancelTimer !== undefined) clearTimeout(cancelTimer);
  }
}

/**
 * 스트림 바이트 한도 강제 읽기 (타임아웃 보호 및 reader 수명/lock 완벽 소유)
 * - Content-Length 헤더만 신뢰하지 않고 스트림 단위 계측
 * - maxBytes 초과 시 reader.cancel 및 response_too_large 오류 반환
 * - 어떤 종료 경로(한도초과, 에러, 타임아웃)에서도 reader lock 해제 및 cancel 처리
 */
export async function readBoundedStream(
  response: Response,
  maxBytes: number,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS
): Promise<{ ok: true; text: string } | { ok: false; error: GoogleAdapterError }> {
  if (timeoutMs <= 0) {
    throw new TimeoutError('Remaining deadline is 0ms before reading body');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(`Body stream read timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const readWork = async (): Promise<{ ok: true; text: string } | { ok: false; error: GoogleAdapterError }> => {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            receivedBytes += value.byteLength;
            if (receivedBytes > maxBytes) {
              await safeCancelReader(reader);
              return {
                ok: false,
                error: {
                  code: 'response_too_large',
                  message: `Response body exceeded limit of ${maxBytes} bytes`,
                },
              };
            }
            chunks.push(value);
          }
        }
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      } catch (err) {
        await safeCancelReader(reader);
        if (err instanceof Error && err.name === 'AbortError') {
          throw err;
        }
        return {
          ok: false,
          error: { code: 'network_error', message: 'Failed to read response stream' },
        };
      }

      const totalBuffer = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        totalBuffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const decoder = new TextDecoder('utf-8');
      return { ok: true, text: decoder.decode(totalBuffer) };
    }

    // Fallback if body stream reader is unavailable
    try {
      const text = await response.text();
      const textBytes = new TextEncoder().encode(text).byteLength;
      if (textBytes > maxBytes) {
        return {
          ok: false,
          error: {
            code: 'response_too_large',
            message: `Response body exceeded limit of ${maxBytes} bytes`,
          },
        };
      }
      return { ok: true, text };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      return {
        ok: false,
        error: { code: 'network_error', message: 'Failed to read response text' },
      };
    }
  };

  try {
    return await Promise.race([readWork(), timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * 타임아웃 레이스를 보장하는 Fetch 래퍼 (redirect: 'error' 강제, 늦은 응답 취소 보호)
 */
export async function fetchWithTimeout(
  injectedFetch: InjectedFetch,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  externalController?: AbortController
): Promise<Response> {
  if (timeoutMs <= 0) {
    throw new TimeoutError('Remaining deadline is 0ms before fetch');
  }

  const controller = externalController ?? new AbortController();
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const fetchPromise = injectedFetch(url, {
    ...init,
    redirect: 'error',
    signal: controller.signal,
  });

  // Catch late arrivals after timeout
  fetchPromise
    .then((res) => {
      if (controller.signal.aborted && res.body) {
        safeCancelBody(res.body, CLEANUP_BUDGET_MS).catch(() => {});
      }
    })
    .catch(() => {});

  try {
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    return response;
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

/**
 * HTTP 응답 상태 코드를 표준 GoogleAdapterError로 매핑
 */
export function mapHttpStatusToAdapterError(status: number): GoogleAdapterError {
  if (status === 401) {
    return { code: 'unauthorized', status, message: 'Google API authentication failed' };
  }
  if (status === 403) {
    return { code: 'forbidden', status, message: 'Access to Google Calendar resource is forbidden' };
  }
  if (status === 404) {
    return { code: 'not_found', status, message: 'Google Calendar resource not found' };
  }
  if (status === 410) {
    return { code: 'sync_expired', status, message: 'Sync token has expired. Full sync required.' };
  }
  if (status === 429) {
    return { code: 'rate_limited', status, message: 'Google API rate limit exceeded' };
  }
  if (status >= 500 && status < 600) {
    return { code: 'server_error', status, message: `Google API server error (${status})` };
  }
  return { code: 'network_error', status, message: `Google API request failed with status ${status}` };
}
