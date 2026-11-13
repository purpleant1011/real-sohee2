import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  sealReviewSession,
  type ReviewSession,
} from '@/features/billing/pg-review-readback';

const MOCK_SECRET_32 = '12345678901234567890123456789012';

vi.mock('@portone/server-sdk', () => {
  return {
    PortOneClient: vi.fn(),
  };
});

vi.mock('@/lib/auth/workspace-guard', () => {
  return {
    requireWorkspaceMembership: vi.fn(),
  };
});

import { PortOneClient } from '@portone/server-sdk';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';

function buildRequest(options: {
  url?: string;
  origin?: string;
  cookieToken?: string;
  body?: unknown;
}): NextRequest {
  const url = options.url ?? 'http://localhost:3000/api/payments/review/billing-key/verify';
  const headers = new Headers();
  headers.set('origin', options.origin ?? new URL(url).origin);
  headers.set('content-type', 'application/json');

  if (options.cookieToken) {
    headers.set('cookie', `${REVIEW_COOKIE_NAME}=${options.cookieToken}`);
  }

  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function createSession(overrides?: Partial<ReviewSession>): ReviewSession {
  const now = Date.now();
  return {
    issueId: 'issue_test_123',
    userId: 'user_tester_1',
    workspaceId: '11111111-2222-3333-4444-555555555555',
    planCode: 'scale',
    createdAt: now,
    expiresAt: now + 900_000,
    ...overrides,
  };
}

describe('POST /api/payments/review/billing-key/verify', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      PORTONE_REVIEW_ENABLED: '1',
      PORTONE_REVIEW_MODE: 'TEST',
      PORTONE_REVIEW_SESSION_SECRET: MOCK_SECRET_32,
      PORTONE_REVIEW_USER_IDS: 'user_tester_1,user_tester_2',
      PORTONE_API_SECRET: 'test_portone_api_secret',
    };

    // Default auth guard mock: ok, owner role, matches user_tester_1
    vi.mocked(requireWorkspaceMembership).mockResolvedValue({
      ok: true,
      userId: 'user_tester_1',
      role: 'owner',
      status: 200,
    } as unknown as Awaited<ReturnType<typeof requireWorkspaceMembership>>);
  });

  it('returns 503 with no-store if review gates are unavailable', async () => {
    process.env.PORTONE_REVIEW_ENABLED = '0';

    const req = buildRequest({
      body: { billingKey: 'bkey_mock_123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const json = await res.json();
    expect(json.error).toBe('REVIEW_UNAVAILABLE');
    expect(PortOneClient).not.toHaveBeenCalled();
  });

  describe('Origin verification', () => {
    it('returns 403 if origin is not allowed or does not match request origin', async () => {
      const session = createSession();
      const token = sealReviewSession(session, MOCK_SECRET_32);

      const req = buildRequest({
        origin: 'https://malicious-site.com',
        cookieToken: token,
        body: { billingKey: 'bkey_mock_123' },
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const json = await res.json();
      expect(json.error).toBe('ORIGIN_FORBIDDEN');
      expect(PortOneClient).not.toHaveBeenCalled();
    });

    it('rejects disallowed domains: evil.example.com, example.com.evil.com, https://sohee.ai', async () => {
      const session = createSession();
      const token = sealReviewSession(session, MOCK_SECRET_32);

      const disallowedOrigins = [
        'https://evil.example.com',
        'https://example.com.evil.com',
        'https://sohee.ai',
      ];

      for (const origin of disallowedOrigins) {
        const req = buildRequest({
          url: `${origin}/api/payments/review/billing-key/verify`,
          origin,
          cookieToken: token,
          body: { billingKey: 'bkey_mock_123' },
        });

        const res = await POST(req);
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toBe('ORIGIN_FORBIDDEN');
      }
      expect(PortOneClient).not.toHaveBeenCalled();
    });

    it('allows valid production origins: example.com, www.example.com, m.example.com', async () => {
      const session = createSession();
      const token = sealReviewSession(session, MOCK_SECRET_32);

      const validOrigins = [
        'https://example.com',
        'https://www.example.com',
        'https://m.example.com',
      ];

      for (const origin of validOrigins) {
        const req = buildRequest({
          url: `${origin}/api/payments/review/billing-key/verify`,
          origin,
          cookieToken: token,
          body: { billingKey: '' }, // intentionally fail at body to test origin passed
        });

        const res = await POST(req);
        // If origin check passed, it reached body check -> 400 INVALID_BILLING_KEY_FORMAT
        expect(res.status).toBe(400);
      }
    });
  });

  it('returns 401 if session cookie is missing or invalid', async () => {
    const req = buildRequest({
      body: { billingKey: 'bkey_mock_123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const json = await res.json();
    expect(json.error).toBe('INVALID_REVIEW_SESSION');
    expect(PortOneClient).not.toHaveBeenCalled();
  });

  describe('requireWorkspaceMembership and role guards', () => {
    it('returns 401 if workspace guard auth fails (unauthenticated)', async () => {
      const session = createSession();
      const token = sealReviewSession(session, MOCK_SECRET_32);

      vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        error: 'UNAUTHORIZED',
        message: '로그인이 필요합니다.',
        status: 401,
      } as unknown as Awaited<ReturnType<typeof requireWorkspaceMembership>>);

      const req = buildRequest({
        cookieToken: token,
        body: { billingKey: 'bkey_mock_123' },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const json = await res.json();
      expect(json.error).toBe('UNAUTHORIZED');
      expect(PortOneClient).not.toHaveBeenCalled();
    });

    it('returns 403 if logged-in auth user does not match session userId', async () => {
      const session = createSession({ userId: 'user_tester_1' });
      const token = sealReviewSession(session, MOCK_SECRET_32);

      vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user_other_different',
        role: 'owner',
        status: 200,
      } as unknown as Awaited<ReturnType<typeof requireWorkspaceMembership>>);

      const req = buildRequest({
        cookieToken: token,
        body: { billingKey: 'bkey_mock_123' },
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const json = await res.json();
      expect(json.error).toBe('FORBIDDEN_USER_MISMATCH');
      expect(PortOneClient).not.toHaveBeenCalled();
    });

    it('returns 403 if user role is not owner or manager (e.g. member)', async () => {
      const session = createSession();
      const token = sealReviewSession(session, MOCK_SECRET_32);

      vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'user_tester_1',
        role: 'member',
        status: 200,
      } as unknown as Awaited<ReturnType<typeof requireWorkspaceMembership>>);

      const req = buildRequest({
        cookieToken: token,
        body: { billingKey: 'bkey_mock_123' },
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const json = await res.json();
      expect(json.error).toBe('FORBIDDEN_ROLE');
      expect(PortOneClient).not.toHaveBeenCalled();
    });

    it('returns 403 if session/auth userId is not in PORTONE_REVIEW_USER_IDS allowlist', async () => {
      const session = createSession({ userId: 'unauthorized_user' });
      const token = sealReviewSession(session, MOCK_SECRET_32);

      vi.mocked(requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'unauthorized_user',
        role: 'owner',
        status: 200,
      } as unknown as Awaited<ReturnType<typeof requireWorkspaceMembership>>);

      const req = buildRequest({
        cookieToken: token,
        body: { billingKey: 'bkey_mock_123' },
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toContain('no-store');
      const json = await res.json();
      expect(json.error).toBe('USER_NOT_ALLOWED');
      expect(PortOneClient).not.toHaveBeenCalled();
    });
  });

  it('returns 400 if request body violates strict schema (e.g. extra fields or missing billingKey)', async () => {
    const session = createSession();
    const token = sealReviewSession(session, MOCK_SECRET_32);

    // Extra field injected
    const req1 = buildRequest({
      cookieToken: token,
      body: { billingKey: 'bkey_mock_123', extraField: 'evil' },
    });
    const res1 = await POST(req1);
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.error).toBe('INVALID_REQUEST_BODY');

    // Missing billingKey or invalid type
    const req2 = buildRequest({
      cookieToken: token,
      body: { billingKey: '' },
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.error).toBe('INVALID_BILLING_KEY_FORMAT');
    expect(PortOneClient).not.toHaveBeenCalled();
  });

  it('returns 422 if server readback fails verification (e.g. store/channel/issueId mismatch)', async () => {
    const session = createSession();
    const token = sealReviewSession(session, MOCK_SECRET_32);

    const mockGetBillingKeyInfo = vi.fn().mockResolvedValue({
      status: 'ISSUED',
      billingKey: 'bkey_mock_123',
      storeId: 'store-mismatched',
      channels: [
        {
          key: REVIEW_CHANNEL_KEY,
          type: 'TEST',
          pgProvider: 'INICIS_V2',
          pgMerchantId: 'INIBillTst',
        },
      ],
      customer: { id: session.userId },
      issueId: session.issueId,
    });

    vi.mocked(PortOneClient).mockReturnValue({
      payment: {
        billingKey: {
          getBillingKeyInfo: mockGetBillingKeyInfo,
        },
      },
    } as unknown as ReturnType<typeof PortOneClient>);

    const req = buildRequest({
      cookieToken: token,
      body: { billingKey: 'bkey_mock_123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('VERIFICATION_FAILED');
    // Ensure no sensitive billingKey or PG internal secrets in response
    expect(JSON.stringify(json)).not.toContain('bkey_mock_123');
  });

  it('succeeds with verified_test_billing_key, expires the review session cookie, and returns no-store', async () => {
    const session = createSession();
    const token = sealReviewSession(session, MOCK_SECRET_32);

    const mockGetBillingKeyInfo = vi.fn().mockResolvedValue({
      status: 'ISSUED',
      billingKey: 'bkey_mock_123',
      storeId: REVIEW_STORE_ID,
      channels: [
        {
          key: REVIEW_CHANNEL_KEY,
          type: 'TEST',
          pgProvider: 'INICIS_V2',
          pgMerchantId: 'INIBillTst',
        },
      ],
      customer: { id: session.userId },
      issueId: session.issueId,
    });

    vi.mocked(PortOneClient).mockReturnValue({
      payment: {
        billingKey: {
          getBillingKeyInfo: mockGetBillingKeyInfo,
        },
      },
    } as unknown as ReturnType<typeof PortOneClient>);

    const req = buildRequest({
      cookieToken: token,
      body: { billingKey: 'bkey_mock_123' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');

    // Cookie expiration verification
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain(`${REVIEW_COOKIE_NAME}=`);
    expect(setCookie).toContain('Max-Age=0');

    const json = await res.json();
    expect(json).toEqual({
      status: 'verified_test_billing_key',
      paymentCharged: false,
      subscriptionActivated: false,
    });
  });
});
