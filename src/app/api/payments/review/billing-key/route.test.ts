import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import * as workspaceGuard from '@/lib/auth/workspace-guard'
import {
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  sealReviewSession,
} from '@/features/billing/pg-review-session'
import {
  subscriptionOfferPolicy,
  subscriptionOffers,
} from '@/features/billing/subscription-offers'

vi.mock('@/lib/auth/workspace-guard', () => ({
  requireWorkspaceMembership: vi.fn(),
}))

describe('POST /api/payments/review/billing-key', () => {
  const validSecret = 'test-secret-at-least-32-characters-long-key'
  const allowedUserId = 'user-review-tester-uuid'
  const validWorkspaceId = '00000000-0000-4000-8000-000000000001'
  const validOrigin = 'http://localhost:3000'

  const validBody = {
    workspaceId: validWorkspaceId,
    planCode: 'GROWTH_300K',
    policyVersion: subscriptionOfferPolicy.version,
    customer: {
      fullName: '홍길동',
      email: 'tester@example.com',
      phoneNumber: '010-1234-5678',
    },
    consents: {
      terms: true,
      privacy: true,
      billingReview: true,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('PORTONE_REVIEW_ENABLED', '1')
    vi.stubEnv('PORTONE_REVIEW_MODE', 'TEST')
    vi.stubEnv('PORTONE_REVIEW_SESSION_SECRET', validSecret)
    vi.stubEnv('PORTONE_REVIEW_USER_IDS', `${allowedUserId},other-allowed-user`)

    vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValue({
      ok: true,
      userId: allowedUserId,
      role: 'owner',
      workspaceId: validWorkspaceId,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function createRequest(
    body: unknown,
    options?: {
      origin?: string
      url?: string
      cookies?: Record<string, string>
    }
  ): NextRequest {
    const origin = options?.origin !== undefined ? options.origin : validOrigin
    const url = options?.url ?? `${validOrigin}/api/payments/review/billing-key`

    const headers = new Headers()
    if (origin) {
      headers.set('origin', origin)
    }
    headers.set('content-type', 'application/json')
    if (options?.cookies) {
      const cookieHeader = Object.entries(options.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      headers.set('cookie', cookieHeader)
    }

    return new NextRequest(url, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  describe('Server Env Gates', () => {
    it('returns 503 REVIEW_UNAVAILABLE in production environment', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('REVIEW_UNAVAILABLE')
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 503 when PORTONE_REVIEW_ENABLED is not 1', async () => {
      vi.stubEnv('PORTONE_REVIEW_ENABLED', '0')
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(503)
      const json = await res.json()
      expect(json.error).toBe('REVIEW_UNAVAILABLE')
    })

    it('returns 503 when PORTONE_REVIEW_MODE is not TEST', async () => {
      vi.stubEnv('PORTONE_REVIEW_MODE', 'LIVE')
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(503)
    })

    it('returns 503 when secret is under 32 chars', async () => {
      vi.stubEnv('PORTONE_REVIEW_SESSION_SECRET', 'short')
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(503)
    })
  })

  describe('Origin and Same-Origin Guards', () => {
    it('returns 403 when Origin header is missing', async () => {
      const req = createRequest(validBody, { origin: '' })
      const res = await POST(req)
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 403 when Origin header is from an untrusted domain', async () => {
      const req = createRequest(validBody, { origin: 'https://malicious-site.com' })
      const res = await POST(req)
      expect(res.status).toBe(403)
    })

    it('returns 403 when Origin header does not match request.url origin', async () => {
      const req = createRequest(validBody, {
        origin: 'http://localhost:3000',
        url: 'http://localhost:3100/api/payments/review/billing-key',
      })
      const res = await POST(req)
      expect(res.status).toBe(403)
    })

    it('allows official production origins in non-production environment: example.com, www.example.com, m.example.com', async () => {
      for (const origin of [
        'https://example.com',
        'https://www.example.com',
        'https://m.example.com',
      ]) {
        const req = createRequest(validBody, { origin, url: `${origin}/api/payments/review/billing-key` })
        const res = await POST(req)
        expect(res.status).toBe(200)
      }
    })

    it('rejects disallowed domains including legacy sohee.ai, subdomains, suffix-attacks, and insecure http', async () => {
      const forbiddenOrigins = [
        'https://sohee.ai',
        'https://evil.example.com',
        'https://example.com.evil.com',
        'http://example.com',
        'http://www.example.com',
        'http://m.example.com',
      ]
      for (const origin of forbiddenOrigins) {
        const req = createRequest(validBody, { origin, url: `${origin}/api/payments/review/billing-key` })
        const res = await POST(req)
        expect(res.status).toBe(403)
      }
    })
  })

  describe('Request Body Validation', () => {
    it('returns 400 when body includes extra/disallowed fields like amount or returnURL', async () => {
      const req = createRequest({ ...validBody, amount: 100 })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 when consents are not all true', async () => {
      const req = createRequest({
        ...validBody,
        consents: { ...validBody.consents, billingReview: false },
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 when policyVersion does not match current official policy version', async () => {
      const req = createRequest({ ...validBody, policyVersion: 'outdated-version' })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 when planCode is not in subscriptionOffers catalog', async () => {
      const req = createRequest({ ...validBody, planCode: 'UNKNOWN_PLAN' })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 400 when workspaceId is not a valid UUID', async () => {
      const req = createRequest({ ...validBody, workspaceId: 'not-a-uuid' })
      const res = await POST(req)
      expect(res.status).toBe(400)
    })
  })

  describe('Authorization and Workspace Guards', () => {
    it('returns 401 when workspace membership check fails', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: false,
        status: 401,
        error: 'UNAUTHORIZED',
        message: '로그인이 필요합니다.',
      })
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(401)
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

    it('returns 403 when user is not an owner or manager', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: allowedUserId,
        role: 'member',
        workspaceId: validWorkspaceId,
      })
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(403)
    })

    it('returns 403 when user is not in PORTONE_REVIEW_USER_IDS allowlist', async () => {
      vi.mocked(workspaceGuard.requireWorkspaceMembership).mockResolvedValueOnce({
        ok: true,
        userId: 'unauthorized-user-uuid',
        role: 'owner',
        workspaceId: validWorkspaceId,
      })
      const req = createRequest(validBody)
      const res = await POST(req)
      expect(res.status).toBe(403)
    })
  })

  describe('Success and Session Lifecycle', () => {
    it('returns official PortOne SDK IssueBillingKeyRequest payload with pinned credentials and cookies', async () => {
      const req = createRequest(validBody)
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('no-store')

      const json = await res.json()
      expect(json.mode).toBe('TEST')
      expect(json.policyVersion).toBe(subscriptionOfferPolicy.version)
      expect(json.message).toContain('심사용 TEST 카드등록창 검토')

      const offer = subscriptionOffers.find((p) => p.code === 'GROWTH_300K')!
      expect(json.request).toEqual({
        storeId: REVIEW_STORE_ID,
        channelKey: REVIEW_CHANNEL_KEY,
        billingKeyMethod: 'CARD',
        issueId: expect.stringMatching(/^test-review-[a-f0-9-]+$/),
        issueName: `SOHEE TEST ${offer.name}`,
        displayAmount: offer.monthlyTotalPriceKrw,
        currency: 'KRW',
        customer: {
          id: allowedUserId,
          customerId: allowedUserId,
          fullName: validBody.customer.fullName,
          name: {
            full: validBody.customer.fullName,
          },
          email: validBody.customer.email,
          phoneNumber: validBody.customer.phoneNumber,
        },
        offerPeriod: {
          interval: '1m',
        },
        redirectUrl: `${validOrigin}/pg-review/return`,
      })

      const setCookie = res.headers.get('set-cookie')
      expect(setCookie).toBeTruthy()
      expect(setCookie).toContain(REVIEW_COOKIE_NAME)
      expect(setCookie).toContain('Max-Age=900')
      expect(setCookie).toContain('Path=/')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie?.toLowerCase()).toContain('samesite=lax')
    })

    it('reuses existing issueId and retains original createdAt and expiresAt without extending TTL', async () => {
      const existingIssueId = 'test-review-reused-12345678'
      const now = Date.now()
      const originalCreatedAt = now - 5 * 60 * 1000 // 5 minutes ago
      const originalExpiresAt = originalCreatedAt + 15 * 60 * 1000 // 10 minutes left
      const existingToken = sealReviewSession(
        {
          issueId: existingIssueId,
          userId: allowedUserId,
          workspaceId: validWorkspaceId,
          planCode: 'GROWTH_300K',
          createdAt: originalCreatedAt,
          expiresAt: originalExpiresAt,
        },
        validSecret
      )

      const req = createRequest(validBody, {
        cookies: { [REVIEW_COOKIE_NAME]: existingToken },
      })
      const res = await POST(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.request.issueId).toBe(existingIssueId)

      // Verify the returned cookie retains the original expiresAt and createdAt
      const setCookie = res.headers.get('set-cookie')
      const tokenMatch = setCookie?.match(new RegExp(`${REVIEW_COOKIE_NAME}=([^;]+)`))
      expect(tokenMatch).toBeTruthy()
      const reopened = (await import('@/features/billing/pg-review-session')).openReviewSession(
        tokenMatch![1],
        validSecret,
        now
      )
      expect(reopened?.createdAt).toBe(originalCreatedAt)
      expect(reopened?.expiresAt).toBe(originalExpiresAt)
    })

    it('generates a new session and issueId when existing cookie is expired', async () => {
      const expiredIssueId = 'test-review-expired-12345678'
      const now = Date.now()
      const expiredToken = sealReviewSession(
        {
          issueId: expiredIssueId,
          userId: allowedUserId,
          workspaceId: validWorkspaceId,
          planCode: 'GROWTH_300K',
          createdAt: now - 20 * 60 * 1000,
          expiresAt: now - 5 * 60 * 1000,
        },
        validSecret
      )

      const req = createRequest(validBody, {
        cookies: { [REVIEW_COOKIE_NAME]: expiredToken },
      })
      const res = await POST(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.request.issueId).not.toBe(expiredIssueId)
    })

    it('creates a new session with new issueId if existing cookie is for a different plan', async () => {
      const existingIssueId = 'test-review-old-plan-12345678'
      const now = Date.now()
      const existingToken = sealReviewSession(
        {
          issueId: existingIssueId,
          userId: allowedUserId,
          workspaceId: validWorkspaceId,
          planCode: 'STARTER_150K', // different plan
          createdAt: now - 60_000,
          expiresAt: now + 14 * 60 * 1000,
        },
        validSecret
      )

      const req = createRequest(validBody, {
        cookies: { [REVIEW_COOKIE_NAME]: existingToken },
      })
      const res = await POST(req)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.request.issueId).not.toBe(existingIssueId)
    })
  })
})
