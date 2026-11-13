import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import {
  REVIEW_COOKIE_NAME,
  REVIEW_STORE_ID,
  openReviewSession,
  readbackBillingKey,
  resolveReviewConfig,
} from '@/features/billing/pg-review-readback';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

function isOriginAllowed(requestOrigin: string | null, requestUrl: string): boolean {
  if (!requestOrigin) return false;

  try {
    const originUrl = new URL(requestOrigin);
    const reqUrl = new URL(requestUrl);

    // 프로토콜과 호스트 일치 여부 (포트 포함)
    if (originUrl.origin !== reqUrl.origin) {
      return false;
    }

    const hostname = originUrl.hostname;
    const protocol = originUrl.protocol;

    if (protocol === 'http:') {
      return hostname === 'localhost' || hostname === '127.0.0.1';
    }

    if (protocol === 'https:') {
      return (
        hostname === 'example.com' ||
        hostname === 'www.example.com' ||
        hostname === 'm.example.com'
      );
    }

    return false;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. 환경 게이트 및 서버 API Secret 확인
  const config = resolveReviewConfig(process.env);
  const apiSecret = process.env.PORTONE_API_SECRET;

  if (!config || !apiSecret) {
    return NextResponse.json(
      { error: 'REVIEW_UNAVAILABLE' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  // 2. Same-Origin & 고정 허용 Origin 검증
  const origin = request.headers.get('origin');
  if (!isOriginAllowed(origin, request.url)) {
    return NextResponse.json(
      { error: 'ORIGIN_FORBIDDEN' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  // 3. 서명된 세션 쿠키 검증
  const cookieToken = request.cookies.get(REVIEW_COOKIE_NAME)?.value;
  if (!cookieToken) {
    return NextResponse.json(
      { error: 'INVALID_REVIEW_SESSION' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const session = openReviewSession(cookieToken, config.sessionSecret, Date.now());
  if (!session) {
    return NextResponse.json(
      { error: 'INVALID_REVIEW_SESSION' },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  // 3-1. 현재 인증 사용자 및 작업공간 멤버십/역할/allowlist 재검증
  const auth = await requireWorkspaceMembership(session.workspaceId);
  if (!auth.ok) {
    return NextResponse.json(
      {
        error: auth.error ?? 'UNAUTHORIZED',
        message: auth.message ?? '작업공간 접근 권한이 없습니다.',
      },
      { status: auth.status ?? 401, headers: NO_STORE_HEADERS },
    );
  }

  if (auth.userId !== session.userId) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN_USER_MISMATCH',
        message: '현재 인증된 사용자가 세션 발급자와 일치하지 않습니다.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (auth.role !== 'owner' && auth.role !== 'manager') {
    return NextResponse.json(
      {
        error: 'FORBIDDEN_ROLE',
        message: '워크스페이스 소유자 또는 관리자만 심사 결과를 검증할 수 있습니다.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  if (!config.userIds.includes(auth.userId)) {
    return NextResponse.json(
      {
        error: 'USER_NOT_ALLOWED',
        message: '심사용 테스트가 허용되지 않은 사용자 계정입니다.',
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  // 4. Strict Body 파싱 및 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'INVALID_REQUEST_BODY' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'INVALID_REQUEST_BODY' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const bodyRecord = body as Record<string, unknown>;
  const keys = Object.keys(bodyRecord);
  if (keys.length !== 1 || keys[0] !== 'billingKey') {
    return NextResponse.json(
      { error: 'INVALID_REQUEST_BODY' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const billingKey = bodyRecord.billingKey;
  if (
    typeof billingKey !== 'string' ||
    billingKey.length < 1 ||
    billingKey.length > 256 ||
    billingKey.trim() !== billingKey ||
    /[\r\n\t\0]/.test(billingKey)
  ) {
    return NextResponse.json(
      { error: 'INVALID_BILLING_KEY_FORMAT' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // 5. 서버 공식 readback 및 상점/환경 검증
  const result = await readbackBillingKey({
    billingKey,
    session,
    apiSecret,
    storeId: REVIEW_STORE_ID,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'VERIFICATION_FAILED',
        reason: result.reason,
      },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }

  // 6. 성공 응답: 민감 정보 제거 + 쿠키 만료 + no-store
  const isHttps = request.url.startsWith('https://');
  const secureFlag = isHttps ? '; Secure' : '';
  const expireCookieHeader = `${REVIEW_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`;

  const responseHeaders = new Headers(NO_STORE_HEADERS);
  responseHeaders.set('Set-Cookie', expireCookieHeader);

  return NextResponse.json(
    {
      status: result.status,
      paymentCharged: result.paymentCharged,
      subscriptionActivated: result.subscriptionActivated,
    },
    {
      status: 200,
      headers: responseHeaders,
    },
  );
}
