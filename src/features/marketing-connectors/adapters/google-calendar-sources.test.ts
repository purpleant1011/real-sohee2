import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listGoogleCalendars,
  type GoogleCalendarSourceItem,
} from './google-calendar-sources';
import {
  saveConnectorCredential,
  type CredentialVaultGateway,
  type StoredCredentialRecord,
  type EncryptedToken,
} from '../credentials/credential-vault';

class InMemoryVaultGateway implements CredentialVaultGateway {
  private store = new Map<string, StoredCredentialRecord>();

  async getCredential(workspaceId: string, connectorId: string) {
    return this.store.get(`${workspaceId}:${connectorId}`) ?? null;
  }

  async saveCredential(record: StoredCredentialRecord) {
    this.store.set(`${record.workspaceId}:${record.connectorId}`, record);
  }

  async updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: string;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }) {
    const key = `${params.workspaceId}:${params.connectorId}`;
    const existing = this.store.get(key);
    if (existing) {
      this.store.set(key, {
        ...existing,
        encryptedAccessToken: params.encryptedAccessToken,
        encryptedRefreshToken: params.encryptedRefreshToken,
        expiresAt: params.expiresAt,
        updatedAt: params.updatedAt,
      });
    }
  }
}

const TEST_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 32-byte base64

describe('google-calendar-sources adapter', () => {
  let gateway: InMemoryVaultGateway;
  const workspaceId = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    gateway = new InMemoryVaultGateway();
    process.env.MARKETING_CONNECTOR_TOKEN_KEY = TEST_KEY;

    // Seed credential in vault
    await saveConnectorCredential(
      {
        workspaceId,
        connectorId: 'google_calendar',
        consentGeneration: 1,
        accessToken: 'ya29.mock-google-token',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        grantedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
      },
      gateway,
      { keyBase64: TEST_KEY }
    );
  });

  it('fetches and returns google calendars list successfully', async () => {
    const mockGoogleResponse = {
      kind: 'calendar#calendarList',
      items: [
        {
          id: 'owner@example.com',
          summary: '대표 캘린더',
          primary: true,
          timeZone: 'Asia/Seoul',
        },
        {
          id: 'booking_team@group.calendar.google.com',
          summary: '예약 및 일정 관리',
          primary: false,
          timeZone: 'Asia/Seoul',
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockGoogleResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await listGoogleCalendars(workspaceId, gateway, {
      injectedFetch: mockFetch,
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.derivedFromGoogle).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual<GoogleCalendarSourceItem>({
      id: 'owner@example.com',
      summary: '대표 캘린더',
      primary: true,
      timeZone: 'Asia/Seoul',
    });
    expect(result.data[1]).toEqual<GoogleCalendarSourceItem>({
      id: 'booking_team@group.calendar.google.com',
      summary: '예약 및 일정 관리',
      primary: false,
      timeZone: 'Asia/Seoul',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer ya29.mock-google-token',
        }),
      })
    );
  });

  it('returns not_found if credential does not exist in vault', async () => {
    const result = await listGoogleCalendars('unknown-workspace', gateway, {
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
  });

  it('handles 401 unauthorized from Google Calendar API', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await listGoogleCalendars(workspaceId, gateway, {
      injectedFetch: mockFetch,
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthorized');
  });

  it('handles 403 forbidden from Google API', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 403, message: 'Forbidden' } }), {
        status: 403,
      })
    );

    const result = await listGoogleCalendars(workspaceId, gateway, {
      injectedFetch: mockFetch,
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('forbidden');
  });

  it('handles invalid JSON responses gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('not-valid-json', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const result = await listGoogleCalendars(workspaceId, gateway, {
      injectedFetch: mockFetch,
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_json');
  });

  it('handles invalid schema response where items is missing', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ kind: 'calendar#calendarList' }), {
        status: 200,
      })
    );

    const result = await listGoogleCalendars(workspaceId, gateway, {
      injectedFetch: mockFetch,
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_schema');
  });

  it('rejects invalid workspaceId', async () => {
    const result = await listGoogleCalendars('', gateway, {
      keyBase64: TEST_KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_input');
  });
});
