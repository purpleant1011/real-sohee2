import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateCalendarId,
  validateCalendarWindow,
  readBoundedStream,
  fetchWithTimeout,
  mapHttpStatusToAdapterError,
  isValidCanonicalIANATimeZone,
  isValidCalendarTime,
  isValidCalendarDate,
  validateOffsetRange,
  TimeoutError,
} from './google-adapter-common';

describe('Google Adapter Common Utilities', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateCalendarId (Table Test)', () => {
    const invalidCases = [
      { id: null, reason: 'null' },
      { id: undefined, reason: 'undefined' },
      { id: '', reason: 'empty string' },
      { id: '   ', reason: 'whitespace only' },
      { id: '.', reason: 'single dot' },
      { id: '..', reason: 'double dot' },
      { id: 'primary', reason: 'primary keyword' },
      { id: 'PRIMARY', reason: 'uppercase primary' },
      { id: 'cals/primary', reason: 'forward slash' },
      { id: 'cals\\other', reason: 'backslash' },
      { id: 'cal%2ebar', reason: 'URL encoded dot (%2e)' },
      { id: 'cal%2Ebar', reason: 'URL encoded dot uppercase (%2E)' },
      { id: 'cal%252ebar', reason: 'double encoded dot (%25)' },
      { id: 'cal\x00id', reason: 'null control char' },
      { id: 'cal\x1fid', reason: 'control char 0x1f' },
      { id: 'cal\x7fid', reason: 'delete control char 0x7f' },
      { id: 'a'.repeat(257), reason: 'exceeds 256 chars' },
    ];

    it.each(invalidCases)('rejects invalid calendarId: $reason', ({ id }) => {
      const res = validateCalendarId(id);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('invalid_input');
      }
    });

    const validCases = [
      { id: 'store@example.com', expected: 'store%40example.com' },
      { id: 'team.sub-cal_1@group.calendar.google.com', expected: 'team.sub-cal_1%40group.calendar.google.com' },
      { id: 'workspace-cal-12345', expected: 'workspace-cal-12345' },
      { id: 'a'.repeat(256), expected: 'a'.repeat(256) },
    ];

    it.each(validCases)('accepts valid calendarId: $id', ({ id, expected }) => {
      const res = validateCalendarId(id);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.encodedId).toBe(expected);
      }
    });
  });

  describe('validateCalendarWindow & offset range', () => {
    it('rejects invalid or offset-lacking timeMin / timeMax', () => {
      expect(validateCalendarWindow('2026-06-01', '2026-06-10T00:00:00Z').ok).toBe(false);
      expect(validateCalendarWindow('2026-06-01T00:00:00', '2026-06-10T00:00:00Z').ok).toBe(false);
      expect(validateCalendarWindow('invalid', '2026-06-10T00:00:00Z').ok).toBe(false);
    });

    it('rejects invalid offset range like +99:99 or +24:00', () => {
      expect(validateCalendarWindow('2026-06-01T00:00:00+99:99', '2026-06-10T00:00:00Z').ok).toBe(false);
      expect(validateCalendarWindow('2026-06-01T00:00:00Z', '2026-06-10T00:00:00+24:00').ok).toBe(false);
      expect(validateOffsetRange('+99:99')).toBe(false);
      expect(validateOffsetRange('+09:60')).toBe(false);
      expect(validateOffsetRange('+09:00')).toBe(true);
      expect(validateOffsetRange('-05:00')).toBe(true);
      expect(validateOffsetRange('Z')).toBe(true);
    });

    it('rejects timeMin > timeMax', () => {
      const res = validateCalendarWindow('2026-07-01T00:00:00Z', '2026-06-01T00:00:00Z');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('invalid_input');
      }
    });

    it('rejects window greater than 120 days', () => {
      const res = validateCalendarWindow('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('invalid_input');
      }
    });

    it('accepts valid window with offset', () => {
      const res = validateCalendarWindow('2026-06-01T00:00:00+09:00', '2026-08-01T00:00:00+09:00');
      expect(res.ok).toBe(true);
    });
  });

  describe('D4. IANA TimeZone Strict Canonical Matching', () => {
    it('accepts exact canonical IANA timeZone identifiers', () => {
      expect(isValidCanonicalIANATimeZone('Asia/Seoul')).toBe(true);
      expect(isValidCanonicalIANATimeZone('UTC')).toBe(true);
      expect(isValidCanonicalIANATimeZone('Etc/UTC')).toBe(true);
      expect(isValidCanonicalIANATimeZone('America/New_York')).toBe(true);
    });

    it('rejects lowercase, offset, whitespace, or invalid timezones', () => {
      expect(isValidCanonicalIANATimeZone('asia/seoul')).toBe(false);
      expect(isValidCanonicalIANATimeZone('utc')).toBe(false);
      expect(isValidCanonicalIANATimeZone('+09:00')).toBe(false);
      expect(isValidCanonicalIANATimeZone('Asia/Seoul ')).toBe(false);
      expect(isValidCanonicalIANATimeZone(' Asia/Seoul')).toBe(false);
      expect(isValidCanonicalIANATimeZone('Invalid/Zone')).toBe(false);
      expect(isValidCanonicalIANATimeZone('')).toBe(false);
      expect(isValidCanonicalIANATimeZone(null)).toBe(false);
    });
  });

  describe('D5. Leap second (second 60) and calendar validity', () => {
    it('allows second 60 (leap second) per RFC3339', () => {
      expect(isValidCalendarTime(23, 59, 60)).toBe(true);
      expect(isValidCalendarTime(23, 59, 61)).toBe(false);
      expect(isValidCalendarTime(24, 0, 0)).toBe(false);
    });

    it('validates leap year and calendar days correctly', () => {
      expect(isValidCalendarDate(2024, 2, 29)).toBe(true); // leap year
      expect(isValidCalendarDate(2026, 2, 29)).toBe(false); // non-leap year
      expect(isValidCalendarDate(2026, 4, 31)).toBe(false); // April has 30 days
      expect(isValidCalendarDate(2026, 13, 10)).toBe(false); // invalid month
    });
  });

  describe('D1. readBoundedStream lifecycle & lock ownership', () => {
    it('successfully reads stream under maxBytes and releases lock', async () => {
      const payload = JSON.stringify({ ok: true, data: 'test' });
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(payload));
          controller.close();
        },
      });

      const response = new Response(stream);
      const res = await readBoundedStream(response, 1024);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.text).toBe(payload);
      }
      // Stream is unlocked after reading finishes
      expect(stream.locked).toBe(false);
    });

    it('cancels reader and releases lock when maxBytes exceeded', async () => {
      let cancelled = false;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(200));
        },
        cancel() {
          cancelled = true;
        },
      });

      const response = new Response(stream);
      const res = await readBoundedStream(response, 100);
      expect(res.ok).toBe(false);
      expect(cancelled).toBe(true);
      expect(stream.locked).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('response_too_large');
      }
    });

    it('times out if body stream reading hangs after headers received', async () => {
      vi.useFakeTimers();
      const hangingStream = new ReadableStream({
        start() {},
      });

      const response = new Response(hangingStream);
      const readPromise = readBoundedStream(response, 1024, 8000);
      const assertion = expect(readPromise).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(8001);

      await assertion;
    });
  });

  describe('fetchWithTimeout', () => {
    it('resolves on normal fetch with redirect error', async () => {
      let passedInit: RequestInit | undefined;
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        passedInit = init;
        return new Response('ok', { status: 200 });
      });

      const res = await fetchWithTimeout(mockFetch, 'https://example.com', {}, 5000);
      expect(res.status).toBe(200);
      expect(passedInit?.redirect).toBe('error');
    });

    it('throws TimeoutError when deadline is exceeded', async () => {
      vi.useFakeTimers();
      const mockFetch: typeof fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      const fetchPromise = fetchWithTimeout(mockFetch, 'https://example.com', {}, 5000);
      const assertion = expect(fetchPromise).rejects.toThrow(TimeoutError);
      await vi.advanceTimersByTimeAsync(5001);

      await assertion;
    });
  });

  describe('mapHttpStatusToAdapterError', () => {
    it('maps statuses correctly', () => {
      expect(mapHttpStatusToAdapterError(401).code).toBe('unauthorized');
      expect(mapHttpStatusToAdapterError(403).code).toBe('forbidden');
      expect(mapHttpStatusToAdapterError(404).code).toBe('not_found');
      expect(mapHttpStatusToAdapterError(410).code).toBe('sync_expired');
      expect(mapHttpStatusToAdapterError(429).code).toBe('rate_limited');
      expect(mapHttpStatusToAdapterError(500).code).toBe('server_error');
      expect(mapHttpStatusToAdapterError(503).code).toBe('server_error');
      expect(mapHttpStatusToAdapterError(418).code).toBe('network_error');
    });
  });
});
