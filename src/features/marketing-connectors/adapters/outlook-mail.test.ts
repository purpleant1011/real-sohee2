import { describe, it, expect, vi } from 'vitest';
import {
  fetchOutlookDeltaMessages,
  validateGraphUrl,
  OutlookError,
  parseOutlookFrom,
  cleanOutlookBodyPreview,
  MAX_BODY_PREVIEW_CHARS,
  type OutlookGateway,
} from './outlook-mail';

describe('validateGraphUrl (SSRF Guard)', () => {
  it('allows valid Microsoft Graph v1.0 delta URLs', () => {
    const validUrl = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=xyz123';
    expect(() => validateGraphUrl(validUrl)).not.toThrow();
    expect(validateGraphUrl(validUrl)).toBe(validUrl);
  });

  it('allows valid Microsoft Graph beta delta URLs', () => {
    const validUrl = 'https://graph.microsoft.com/beta/me/mailFolders/archive/messages/delta';
    expect(() => validateGraphUrl(validUrl)).not.toThrow();
  });

  it('rejects URLs from other domains (SSRF attack prevention)', () => {
    expect(() => validateGraphUrl('https://evil-attacker.com/delta')).toThrowError(OutlookError);
    expect(() => validateGraphUrl('https://evil-attacker.com/delta')).toThrowError(/INVALID_GRAPH_URL/);
    expect(() => validateGraphUrl('https://graph.microsoft.com.attacker.com/delta')).toThrowError(/INVALID_GRAPH_URL/);
  });

  it('rejects insecure http protocol', () => {
    expect(() => validateGraphUrl('http://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta')).toThrowError(/INVALID_GRAPH_URL/);
  });

  it('rejects non-standard ports', () => {
    expect(() => validateGraphUrl('https://graph.microsoft.com:8443/v1.0/me/mailFolders/inbox/messages/delta')).toThrowError(/INVALID_GRAPH_URL/);
  });

  it('rejects invalid or malformed URLs', () => {
    expect(() => validateGraphUrl('not-a-url')).toThrowError(/INVALID_GRAPH_URL/);
    expect(() => validateGraphUrl('javascript:alert(1)')).toThrowError(/INVALID_GRAPH_URL/);
  });

  it('rejects paths not starting with /v1.0/ or /beta/', () => {
    expect(() => validateGraphUrl('https://graph.microsoft.com/admin/secrets')).toThrowError(/INVALID_GRAPH_URL/);
  });
});

describe('parseOutlookFrom (PII masking)', () => {
  it('extracts name and masks email from Graph emailAddress object', () => {
    const parsed = parseOutlookFrom({
      emailAddress: {
        name: '홍길동',
        address: 'gildong@example.com',
      },
    });
    expect(parsed.from).toBe('홍길동');
    expect(parsed.senderName).toBe('홍길동');
    expect(parsed.senderEmailMasked).toBe('g***g@example.com');
  });

  it('uses masked email when name is missing', () => {
    const parsed = parseOutlookFrom({
      emailAddress: {
        name: '',
        address: 'ceo@company.kr',
      },
    });
    expect(parsed.from).toBe('c***o@company.kr');
    expect(parsed.senderEmailMasked).toBe('c***o@company.kr');
  });

  it('handles string input with name and email', () => {
    const parsed = parseOutlookFrom('김철수 <chulsoo@test.org>');
    expect(parsed.from).toBe('김철수');
    expect(parsed.senderName).toBe('김철수');
    expect(parsed.senderEmailMasked).toBe('c***o@test.org');
  });

  it('returns fallback for empty or missing from', () => {
    const parsed = parseOutlookFrom(null);
    expect(parsed.from).toBe('알 수 없음');
  });
});

describe('cleanOutlookBodyPreview', () => {
  it('strips HTML tags and decodes common HTML entities', () => {
    const raw = '<p>안녕하세요 &amp; 반갑습니다.<br><strong>견적서</strong> 첨부합니다.</p>';
    const cleaned = cleanOutlookBodyPreview(raw);
    expect(cleaned).toBe('안녕하세요 & 반갑습니다. 견적서 첨부합니다.');
  });

  it('truncates preview exceeding MAX_BODY_PREVIEW_CHARS (5000 chars)', () => {
    const longText = '가'.repeat(6000);
    const cleaned = cleanOutlookBodyPreview(longText);
    expect(cleaned.length).toBe(MAX_BODY_PREVIEW_CHARS);
  });
});

describe('fetchOutlookDeltaMessages', () => {
  const mockAccessToken = 'mock-ms-graph-token-123';

  it('fetches delta messages from default inbox endpoint', async () => {
    const mockResponseData = {
      '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#Collection(message)',
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=skip1',
      value: [
        {
          id: 'msg-1',
          subject: '신규 발주서 안내',
          from: {
            emailAddress: {
              name: '박영희',
              address: 'younghee@client.com',
            },
          },
          receivedDateTime: '2026-11-10T10:00:00Z',
          bodyPreview: '발주서 확인 부탁드립니다.',
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    const result = await fetchOutlookDeltaMessages(
      { accessToken: mockAccessToken, folderId: 'inbox' },
      gateway
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [callUrl, callOptions] = mockFetch.mock.calls[0];
    expect(callUrl).toContain('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta');
    expect(callOptions.headers.Authorization).toBe(`Bearer ${mockAccessToken}`);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: 'msg-1',
      subject: '신규 발주서 안내',
      from: '박영희',
      senderName: '박영희',
      senderEmailMasked: 'y***e@client.com',
      receivedDateTime: '2026-11-10T10:00:00Z',
      bodyPreview: '발주서 확인 부탁드립니다.',
      isRemoved: false,
    });
    expect(result.nextLink).toBe(mockResponseData['@odata.nextLink']);
    expect(result.deltaLink).toBeUndefined();
    expect(result.removedMessageIds).toEqual([]);
  });

  it('detects @removed tombstone items and collects removedMessageIds', async () => {
    const mockResponseData = {
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=delta999',
      value: [
        {
          id: 'msg-active',
          subject: '정상 메시지',
          from: { emailAddress: { name: '관리자', address: 'admin@store.com' } },
          receivedDateTime: '2026-11-10T11:00:00Z',
          bodyPreview: '정상 본문',
        },
        {
          id: 'msg-deleted-1',
          '@removed': { reason: 'deleted' },
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    const result = await fetchOutlookDeltaMessages(
      { accessToken: mockAccessToken, folderId: 'inbox' },
      gateway
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].isRemoved).toBe(false);
    expect(result.messages[1].isRemoved).toBe(true);
    expect(result.removedMessageIds).toEqual(['msg-deleted-1']);
    expect(result.deltaLink).toBe(mockResponseData['@odata.deltaLink']);
  });

  it('uses deltaLink directly when provided instead of folderId URL', async () => {
    const deltaUrl = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=token-abc';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: [] }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await fetchOutlookDeltaMessages(
      { accessToken: mockAccessToken, deltaLink: deltaUrl },
      gateway
    );

    expect(mockFetch).toHaveBeenCalledWith(deltaUrl, expect.any(Object));
  });

  it('throws INVALID_GRAPH_URL if deltaLink is an untrusted host (SSRF)', async () => {
    const maliciousUrl = 'https://attacker-controlled.site/steal-token';
    const mockFetch = vi.fn();
    const gateway: OutlookGateway = { fetch: mockFetch };

    await expect(
      fetchOutlookDeltaMessages(
        { accessToken: mockAccessToken, deltaLink: maliciousUrl },
        gateway
      )
    ).rejects.toThrow(OutlookError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws INVALID_GRAPH_URL if returned nextLink from upstream is untrusted', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        '@odata.nextLink': 'https://evil.org/next',
        value: [],
      }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await expect(
      fetchOutlookDeltaMessages({ accessToken: mockAccessToken }, gateway)
    ).rejects.toThrow(OutlookError);
  });

  it('throws INVALID_CREDENTIALS on 401', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: { message: 'Token expired' } }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await expect(
      fetchOutlookDeltaMessages({ accessToken: mockAccessToken }, gateway)
    ).rejects.toMatchObject({
      name: 'OutlookError',
      code: 'INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('throws ACCESS_DENIED on 403', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: async () => ({ error: { message: 'Access denied' } }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await expect(
      fetchOutlookDeltaMessages({ accessToken: mockAccessToken }, gateway)
    ).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
      status: 403,
    });
  });

  it('throws RATE_LIMITED on 429 and parses Retry-After header', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('Retry-After', '25');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: mockHeaders,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await expect(
      fetchOutlookDeltaMessages({ accessToken: mockAccessToken }, gateway)
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfterMs: 25000,
    });
  });

  it('throws SERVER_ERROR on 503', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ error: { message: 'Temporary service issue' } }),
    });

    const gateway: OutlookGateway = { fetch: mockFetch };
    await expect(
      fetchOutlookDeltaMessages({ accessToken: mockAccessToken }, gateway)
    ).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      status: 503,
    });
  });
});
