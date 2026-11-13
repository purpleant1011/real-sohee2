import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  fetchCalendarEvents,
  type FetchCalendarEventsInput,
} from './google-calendar';
import {
  mockCalendarEventTimed,
  mockCalendarEventAllDay,
  mockCalendarEventCancelled,
  createMockGoogleCalendarResponse,
} from './__fixtures__/google-calendar-fixtures';

describe('Google Calendar Adapter (fetchCalendarEvents)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Input validation & mutual exclusivity (full vs incremental)', () => {
    it('rejects unknown mode', async () => {
      const input = {
        mode: 'unknown',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
      } as unknown as FetchCalendarEventsInput;

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('requires timeMin and timeMax in full mode and rejects missing bounds', async () => {
      const input = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
      } as unknown as FetchCalendarEventsInput;

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('rejects syncToken in full mode (mutually exclusive)', async () => {
      const input = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-07-01T00:00:00Z',
        syncToken: 'some-sync-token',
      } as unknown as FetchCalendarEventsInput;

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('requires syncToken in incremental mode', async () => {
      const input = {
        mode: 'incremental',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
      } as unknown as FetchCalendarEventsInput;

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('rejects timeMin or timeMax in incremental mode (mutually exclusive)', async () => {
      const input = {
        mode: 'incremental',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        syncToken: 'valid-sync-token',
        timeMin: '2026-06-01T00:00:00Z',
      } as unknown as FetchCalendarEventsInput;

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('includes singleEvents=true in incremental mode as required by Google sync guide', async () => {
      let requestedUrl = '';
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        requestedUrl = url.toString();
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({})), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'incremental',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        syncToken: 'valid-sync-token',
        injectedFetch: mockFetch,
      };

      await fetchCalendarEvents(input);
      expect(requestedUrl).toContain('singleEvents=true');
      expect(requestedUrl).toContain('syncToken=valid-sync-token');
    });
  });

  describe('2. calendarId path validation', () => {
    it.each([
      '   ',
      'primary',
      'PRIMARY',
      '../other-calendar',
      'cals/injected',
      'cals\\injected',
      'cals%2einjected',
      'cal\x00id\x1b',
      'a'.repeat(257),
    ])('rejects unsafe or invalid calendarId: %s', async (calendarId) => {
      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId,
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-07-01T00:00:00Z',
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('properly encodes valid calendarId in URL path', async () => {
      const capturedUrls: string[] = [];
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        capturedUrls.push(url.toString());
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({})), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team+shop@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-07-01T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      expect(capturedUrls.length).toBe(1);
      expect(capturedUrls[0]).toContain(
        encodeURIComponent('team+shop@group.calendar.google.com')
      );
    });
  });

  describe('3. 120-day window & RFC3339 validation', () => {
    it('rejects timeMin without RFC3339 timezone offset', async () => {
      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00',
        timeMax: '2026-06-10T00:00:00Z',
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('rejects timeMin > timeMax', async () => {
      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-07-01T00:00:00Z',
        timeMax: '2026-06-01T00:00:00Z',
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });

    it('rejects window exceeding 120 days', async () => {
      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-01-01T00:00:00Z',
        timeMax: '2026-05-10T00:00:00Z',
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_input');
      }
    });
  });

  describe('4. Pagination & syncToken rules & complete flag', () => {
    it('includes maxResults=250 and redirect: error in request', async () => {
      let requestedUrl = '';
      let passedInit: RequestInit | undefined;
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = url.toString();
        passedInit = init;
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({})), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      await fetchCalendarEvents(input);
      expect(requestedUrl).toContain('maxResults=250');
      expect(passedInit?.redirect).toBe('error');
    });

    it('returns complete: true and nextSyncToken only on the final page when nextPageToken is absent', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              nextSyncToken: 'sync_token_final_999',
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.complete).toBe(true);
        expect(result.nextSyncToken).toBe('sync_token_final_999');
        expect(result.nextPageToken).toBeUndefined();
      }
    });

    it('returns complete: false and does not expose nextSyncToken if intermediate page has nextPageToken in single page query', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              nextPageToken: 'page_token_2',
              nextSyncToken: 'premature_sync_token',
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        maxPages: 1,
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.complete).toBe(false);
        expect(result.nextPageToken).toBe('page_token_2');
        expect(result.nextSyncToken).toBeUndefined();
      }
    });

    it('fails immediately with invalid_schema if nextPageToken matches previous pageToken (loop prevention)', async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              nextPageToken: 'stuck_token',
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      expect(callCount).toBe(2);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('fails with limit_exceeded when single page exceeds 500 items', async () => {
      const items = Array.from({ length: 501 }, (_, i) => ({
        id: `evt_${i}`,
        status: 'confirmed',
        summary: `Event ${i}`,
        start: { dateTime: '2026-06-01T10:00:00Z' },
        end: { dateTime: '2026-06-01T11:00:00Z' },
      }));

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('limit_exceeded');
      }
    });

    it('fails with limit_exceeded when total accumulated items exceed 2500', async () => {
      let callCount = 0;
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        const items = Array.from({ length: 500 }, (_, i) => ({
          id: `evt_c${callCount}_${i}`,
          status: 'confirmed',
          summary: `Event ${i}`,
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        }));
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              items,
              nextPageToken: callCount < 6 ? `token_${callCount}` : undefined,
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('limit_exceeded');
      }
    });

    it('deduplicates duplicate event IDs using Last-Write-Wins policy', async () => {
      const items = [
        {
          id: 'evt_dup_001',
          status: 'confirmed',
          summary: 'Original Meeting',
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
        {
          id: 'evt_dup_001',
          status: 'cancelled',
          summary: 'Cancelled Meeting',
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items.length).toBe(1);
        expect(result.data.items[0]).toEqual({
          kind: 'tombstone',
          id: 'evt_dup_001',
          status: 'cancelled',
        });
      }
    });
  });

  describe('5. Status, Schema, and Summary constraints', () => {
    it('defaults missing status to confirmed', async () => {
      const items = [
        {
          id: 'evt_no_status',
          summary: 'No status meeting',
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items[0].status).toBe('confirmed');
      }
    });

    it('rejects unknown status value with invalid_schema', async () => {
      const items = [
        {
          id: 'evt_bad_status',
          status: 'pending_approval',
          summary: 'Pending meeting',
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('rejects start/end dateTime without RFC3339 offset with invalid_schema if no valid IANA timeZone', async () => {
      const items = [
        {
          id: 'evt_no_offset',
          status: 'confirmed',
          summary: 'Missing offset meeting',
          start: { dateTime: '2026-06-01T10:00:00' }, // no Z or offset and no timeZone
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('accepts dateTime without offset when valid IANA timeZone is present on start and end and preserves startTimeZone and endTimeZone in DTO even if different', async () => {
      const items = [
        {
          id: 'evt_cross_tz',
          status: 'confirmed',
          summary: 'Flight from Seoul to New York',
          start: { dateTime: '2026-06-01T10:00:00', timeZone: 'Asia/Seoul' },
          end: { dateTime: '2026-06-01T18:00:00', timeZone: 'America/New_York' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.items[0]).toEqual({
          kind: 'timed',
          id: 'evt_cross_tz',
          summary: 'Flight from Seoul to New York',
          start: '2026-06-01T10:00:00',
          end: '2026-06-01T18:00:00',
          startTimeZone: 'Asia/Seoul',
          endTimeZone: 'America/New_York',
          status: 'confirmed',
        });
      }
    });

    it('rejects non-canonical or lowercase IANA timeZone (D4)', async () => {
      const items = [
        {
          id: 'evt_lowercase_tz',
          status: 'confirmed',
          summary: 'Lowercase timezone meeting',
          start: { dateTime: '2026-06-01T10:00:00', timeZone: 'asia/seoul' },
          end: { dateTime: '2026-06-01T11:00:00', timeZone: 'Asia/Seoul' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('rejects timed events where end time is before start time (D5)', async () => {
      const items = [
        {
          id: 'evt_inverted_time',
          status: 'confirmed',
          summary: 'Inverted meeting',
          start: { dateTime: '2026-06-01T12:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('allows leap second (second 60) per RFC3339 in timed events (D5)', async () => {
      const items = [
        {
          id: 'evt_leap_sec',
          status: 'confirmed',
          summary: 'Leap second event',
          start: { dateTime: '2026-06-30T23:59:60Z' },
          end: { dateTime: '2026-07-01T00:05:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-07-02T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const first = result.data.items[0];
        expect(first.kind).toBe('timed');
        if (first.kind === 'timed') {
          expect(first.start).toBe('2026-06-30T23:59:60Z');
        }
      }
    });

    it('rejects invalid offsets like +99:99 or +24:00 with invalid_schema (D5)', async () => {
      const items = [
        {
          id: 'evt_bad_offset',
          status: 'confirmed',
          summary: 'Bad offset event',
          start: { dateTime: '2026-06-01T10:00:00+99:99' },
          end: { dateTime: '2026-06-01T11:00:00+99:99' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('truncates summary safely across surrogate pairs (D5)', async () => {
      // 1023 ascii chars + 1 emoji (2 UTF-16 code units, 1 code point) = 1024 code points
      // + another emoji = 1025 code points. Truncation must slice cleanly at code point 1024.
      const emoji = '🎉';
      const longSummary = 'A'.repeat(1023) + emoji + emoji;

      const items = [
        {
          id: 'evt_surrogate_summary',
          status: 'confirmed',
          summary: longSummary,
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const first = result.data.items[0];
        if (first.kind === 'timed') {
          // Exactly 1024 code points: 1023 'A's + 1 '🎉'
          expect(Array.from(first.summary).length).toBe(1024);
          expect(first.summary.endsWith('🎉')).toBe(true);
          expect(first.summaryTruncated).toBe(true);
        }
      }
    });

    it('rejects invalid calendar dates (2026-13-45, 2026-02-29 non-leap year, 25:00 hours) with invalid_schema', async () => {
      const invalidDateItems = [
        {
          id: 'evt_bad_date',
          status: 'confirmed',
          summary: 'Bad calendar date',
          start: { date: '2026-13-45' },
          end: { date: '2026-13-46' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items: invalidDateItems })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
      }
    });

    it('truncates summary exceeding 1024 characters to 1024 without failing and emits warnings: ["summary_truncated"]', async () => {
      const items = [
        {
          id: 'evt_long_summary',
          status: 'confirmed',
          summary: 'A'.repeat(1050),
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const firstItem = result.data.items[0];
        expect(firstItem.kind).toBe('timed');
        if (firstItem.kind === 'timed') {
          expect(firstItem.summary.length).toBe(1024);
          expect(firstItem.summary).toBe('A'.repeat(1024));
          expect(firstItem.summaryTruncated).toBe(true);
        }
        expect(result.warnings).toContain('summary_truncated');
      }
    });

    it('does not leak raw unknown status in error message', async () => {
      const SECRET_STATUS = 'SUPER_SECRET_RAW_STATUS_STRING_999';
      const items = [
        {
          id: 'evt_secret_status',
          status: SECRET_STATUS,
          summary: 'Test',
          start: { dateTime: '2026-06-01T10:00:00Z' },
          end: { dateTime: '2026-06-01T11:00:00Z' },
        },
      ];

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({ items })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('invalid_schema');
        expect(result.error.message).not.toContain(SECRET_STATUS);
      }
    });
  });

  describe('6. Timeout handling (per-page 8s, global 30s, shared page budget)', () => {
    it('enforces shared page budget: header 7.9s + body 7.9s exceeds 8s total per-page deadline and times out', async () => {
      vi.useFakeTimers();

      // Slow header taking 7900ms, followed by slow body taking another 7900ms
      const slowFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 7900));

        const slowStream = new ReadableStream({
          async start(controller) {
            await new Promise((resolve) => setTimeout(resolve, 7900));
            controller.enqueue(new TextEncoder().encode(JSON.stringify(createMockGoogleCalendarResponse({}))));
            controller.close();
          },
        });

        return new Response(slowStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: slowFetch,
      };

      const resultPromise = fetchCalendarEvents(input);

      // Advance by 8001ms (7900ms header + 101ms body > 8000ms page budget)
      await vi.advanceTimersByTimeAsync(8001);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
    });

    it('terminates hung body read ignoring signal after 8 seconds using fake timers', async () => {
      vi.useFakeTimers();

      const hangingStream = new ReadableStream({
        start() {
          // never emits chunk or closes
        },
      });

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(hangingStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const resultPromise = fetchCalendarEvents(input);
      await vi.advanceTimersByTimeAsync(8001);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
    });

    it('terminates with timeout within 30,000ms hard cap including 1000ms cleanup budget (D2)', async () => {
      vi.useFakeTimers();

      let pageCount = 0;
      const slowFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        pageCount++;
        await new Promise((resolve) => setTimeout(resolve, 7000));
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              items: [],
              nextPageToken: `page_${pageCount}`,
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: slowFetch,
      };

      const startNow = Date.now();
      const resultPromise = fetchCalendarEvents(input);

      // Advance through pages up to hard cap
      await vi.advanceTimersByTimeAsync(30000);

      const result = await resultPromise;
      const elapsedWallTime = Date.now() - startNow;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('timeout');
      }
      expect(elapsedWallTime).toBeLessThanOrEqual(30000);
    });

    it('bounds non-2xx body.cancel with 1000ms timeout when cancel hangs', async () => {
      vi.useFakeTimers();

      const hangingCancelStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('error'));
        },
        cancel() {
          return new Promise(() => {
            // never resolves cancel
          });
        },
      });

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(hangingCancelStream, {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const resultPromise = fetchCalendarEvents(input);
      await vi.advanceTimersByTimeAsync(1005);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('forbidden');
      }
    });
  });

  describe('7. HTTP status & Non-2xx response cleanup', () => {
    it('cancels response body on non-2xx status', async () => {
      let bodyCancelled = false;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Error body'));
        },
        cancel() {
          bodyCancelled = true;
        },
      });

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(stream, {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      expect(bodyCancelled).toBe(true);
      if (!result.ok) {
        expect(result.error.code).toBe('forbidden');
      }
    });
  });

  describe('8. Stream byte cap (Calendar 1 MiB/page)', () => {
    it('fails with response_too_large when stream exceeds 1 MiB even if Content-Length is small or absent', async () => {
      const oversizedChunk = new Uint8Array(1024 * 1024 + 10);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(oversizedChunk);
          controller.close();
        },
      });

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': '100',
          },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('response_too_large');
      }
    });
  });

  describe('9. DTO discrimination, PII exclusion, and tombstone handling', () => {
    it('discriminates timed, all_day, and tombstone events with derivedFromGoogle: true', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(createMockGoogleCalendarResponse({})), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.derivedFromGoogle).toBe(true);
        expect(result.data.complete).toBe(true);

        const [timed, allDay, tombstone] = result.data.items;

        expect(timed).toEqual({
          kind: 'timed',
          id: 'evt_timed_001',
          summary: '여름 시즌 신메뉴 론칭 행사',
          start: '2026-06-01T10:00:00+09:00',
          end: '2026-06-01T12:00:00+09:00',
          status: 'confirmed',
        });

        expect(allDay).toEqual({
          kind: 'all_day',
          id: 'evt_allday_002',
          summary: '매장 정기 휴무일',
          startDate: '2026-06-15',
          endDate: '2026-06-16',
          status: 'tentative',
        });

        expect(tombstone).toEqual({
          kind: 'tombstone',
          id: 'evt_cancelled_003',
          status: 'cancelled',
        });
      }
    });

    it('strictly strips attendees, organizer, description, location, conference fields from all DTO items', async () => {
      const mockFetch: typeof fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify(
            createMockGoogleCalendarResponse({
              items: [
                mockCalendarEventTimed,
                mockCalendarEventAllDay,
                mockCalendarEventCancelled,
              ],
            })
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: 'valid-token',
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const item of result.data.items) {
          const raw = item as Record<string, unknown>;
          expect('attendees' in raw).toBe(false);
          expect('organizer' in raw).toBe(false);
          expect('description' in raw).toBe(false);
          expect('location' in raw).toBe(false);
          expect('conferenceData' in raw).toBe(false);
          expect('creator' in raw).toBe(false);
          expect('hangoutLink' in raw).toBe(false);
        }
      }
    });
  });

  describe('10. Token & query confidentiality (no leaks in errors)', () => {
    it('uses accessToken only in Authorization header and never leaks token or query in error messages', async () => {
      const SECRET_TOKEN = 'secret-access-token-987654321';
      let capturedAuthHeader: string | null = null;

      const mockFetch: typeof fetch = vi.fn().mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        capturedAuthHeader = headers.get('authorization');
        return new Response(JSON.stringify({ error: { message: 'Some internal error' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      });

      const input: FetchCalendarEventsInput = {
        mode: 'full',
        calendarId: 'team-cal@group.calendar.google.com',
        accessToken: SECRET_TOKEN,
        timeMin: '2026-06-01T00:00:00Z',
        timeMax: '2026-06-10T00:00:00Z',
        injectedFetch: mockFetch,
      };

      const result = await fetchCalendarEvents(input);
      expect(capturedAuthHeader).toBe(`Bearer ${SECRET_TOKEN}`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const serialized = JSON.stringify(result.error);
        expect(serialized).not.toContain(SECRET_TOKEN);
        expect(serialized).not.toContain('timeMin=');
        expect(serialized).not.toContain('timeMax=');
      }
    });
  });
});
