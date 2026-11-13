import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import {
  REVIEW_CHANNEL_KEY,
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  openReviewSession,
  resolveReviewConfig,
  sealReviewSession,
  type ReviewSession,
} from '@/features/billing/pg-review-session'
import {
  subscriptionOfferPolicy,
  subscriptionOffers,
} from '@/features/billing/subscription-offers'

const ALLOWED_EXACT_ORIGINS = new Set([
  'https://example.com',
  'https://www.example.com',
  'https://m.example.com',
])

const LOCAL_DEV_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
]

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_EXACT_ORIGINS.has(origin)) {
    return true
  }
  return LOCAL_DEV_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
}

const RequestBodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    planCode: z.enum(['STARTER_150K', 'GROWTH_300K', 'SCALE_500K']),
    policyVersion: z.literal(subscriptionOfferPolicy.version),
    customer: z
      .object({
        fullName: z.string().trim().min(1).max(100),
        email: z.string().trim().email(),
        phoneNumber: z.string().trim().min(8).max(30),
      })
      .strict(),
    consents: z
      .object({
        terms: z.literal(true),
        privacy: z.literal(true),
        billingReview: z.literal(true),
      })
      .strict(),
  })
  .strict()

function noStoreJsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originHeader = request.headers.get('origin')
  if (!originHeader || !isAllowedOrigin(originHeader)) {
    return noStoreJsonResponse(
      { error: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 요청 출처입니다.' },
      403
    )
  }

  let requestUrlOrigin: string
  try {
    requestUrlOrigin = new URL(request.url).origin
  } catch {
    return noStoreJsonResponse(
      { error: 'INVALID_REQUEST_URL', message: '요청 URL이 유효하지 않습니다.' },
      400
    )
  }

  if (originHeader !== requestUrlOrigin) {
    return noStoreJsonResponse(
      { error: 'FORBIDDEN_ORIGIN', message: '요청 출처와 대상 출처가 일치하지 않습니다.' },
      403
    )
  }

  const reviewConfig = resolveReviewConfig(process.env)
  if (!reviewConfig) {
    return noStoreJsonResponse(
      {
        error: 'REVIEW_UNAVAILABLE',
        message: '심사용 TEST 결제창 서비스가 비활성화되어 있거나 준비되지 않았습니다.',
      },
      503
    )
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return noStoreJsonResponse(
      { error: 'INVALID_JSON', message: '요청 본문이 올바른 JSON 형식이 아닙니다.' },
      400
    )
  }

  const parsedBody = RequestBodySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return noStoreJsonResponse(
      { error: 'INVALID_REQUEST_BODY', message: '요청 본문 유효성 검증에 실패했습니다.' },
      400
    )
  }

  const body = parsedBody.data
  const plan = subscriptionOffers.find((p) => p.code === body.planCode)
  if (!plan) {
    return noStoreJsonResponse(
      { error: 'PLAN_NOT_FOUND', message: '요청한 플랜을 찾을 수 없습니다.' },
      400
    )
  }

  const auth = await requireWorkspaceMembership(body.workspaceId)
  if (!auth.ok) {
    return noStoreJsonResponse(
      {
        error: auth.error ?? 'UNAUTHORIZED',
        message: auth.message ?? '작업공간 접근 권한이 없습니다.',
      },
      auth.status ?? 401
    )
  }

  if (auth.role !== 'owner' && auth.role !== 'manager') {
    return noStoreJsonResponse(
      {
        error: 'FORBIDDEN_ROLE',
        message: '워크스페이스 소유자 또는 관리자만 심사 요청을 진행할 수 있습니다.',
      },
      403
    )
  }

  if (!reviewConfig.userIds.includes(auth.userId)) {
    return noStoreJsonResponse(
      {
        error: 'FORBIDDEN_USER',
        message: '심사용 테스트가 허용되지 않은 사용자 계정입니다.',
      },
      403
    )
  }

  const now = Date.now()
  const existingCookie = request.cookies.get(REVIEW_COOKIE_NAME)?.value
  let session: ReviewSession | null = null

  if (existingCookie) {
    const existingSession = openReviewSession(existingCookie, reviewConfig.sessionSecret, now)
    if (
      existingSession &&
      existingSession.userId === auth.userId &&
      existingSession.workspaceId === body.workspaceId &&
      existingSession.planCode === body.planCode
    ) {
      session = existingSession
    }
  }

  if (!session) {
    const issueId = `test-review-${randomUUID()}`
    const expiresAt = now + 15 * 60 * 1000
    session = {
      issueId,
      userId: auth.userId,
      workspaceId: body.workspaceId,
      planCode: body.planCode,
      createdAt: now,
      expiresAt,
    }
  }

  const sealedToken = sealReviewSession(session, reviewConfig.sessionSecret)
  const isSecure = originHeader.startsWith('https://')
  const remainingSeconds = Math.max(1, Math.floor((session.expiresAt - now) / 1000))

  const response = noStoreJsonResponse(
    {
      mode: 'TEST',
      policyVersion: subscriptionOfferPolicy.version,
      message:
        '본 요청은 정책 미승인 판매가 아닌 심사용 TEST 카드등록창 검토입니다. 실제 결제나 청구는 발생하지 않습니다.',
      request: {
        storeId: REVIEW_STORE_ID,
        channelKey: REVIEW_CHANNEL_KEY,
        billingKeyMethod: 'CARD',
        issueId: session.issueId,
        issueName: `SOHEE TEST ${plan.name}`,
        displayAmount: plan.monthlyTotalPriceKrw,
        currency: 'KRW',
        customer: {
          id: auth.userId,
          customerId: auth.userId,
          fullName: body.customer.fullName,
          name: {
            full: body.customer.fullName,
          },
          email: body.customer.email,
          phoneNumber: body.customer.phoneNumber,
        },
        offerPeriod: {
          interval: '1m',
        },
        redirectUrl: `${originHeader}/pg-review/return`,
      },
    },
    200
  )

  response.cookies.set({
    name: REVIEW_COOKIE_NAME,
    value: sealedToken,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: remainingSeconds,
    secure: isSecure,
  })

  return response
}
