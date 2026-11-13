import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  createMarketingOAuthTransaction,
  createSupabaseOAuthTransactionGateway,
} from '@/features/marketing-connectors/oauth/oauth-transaction';
import {
  validateMicrosoftScopeRequest,
  buildMicrosoftAuthorizeUrl,
  MicrosoftPolicyViolationError,
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_OFFLINE_ACCESS_SCOPE,
} from '@/features/marketing-connectors/providers/microsoft-oauth';
import type { ProviderId } from '@/features/marketing-connectors/providers/registry';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<NextResponse> {
  try {
    const { workspaceId } = await context.params;

    if (
      !workspaceId ||
      typeof workspaceId !== 'string' ||
      !UUID_REGEX.test(workspaceId.trim())
    ) {
      return NextResponse.json(
        {
          error: 'INVALID_WORKSPACE_ID',
          message: '유효한 작업공간 식별자가 필요합니다.',
        },
        { status: 400 }
      );
    }

    const cleanWorkspaceId = workspaceId.trim();

    // 1. 작업공간 멤버십 가드 검증 (데모 우회 금지)
    const auth = await requireWorkspaceMembership(cleanWorkspaceId, {
      allowDemoBypass: false,
    });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      );
    }

    // 2. 실제 세션 사용자 확인
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error: 'AUTH_REQUIRED',
          message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
        },
        { status: 401 }
      );
    }

    if (user.id !== auth.userId) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '작업공간 접근 권한이 없습니다.',
        },
        { status: 403 }
      );
    }

    // 3. active workspace_members role 대조 (owner / manager만 허용)
    const { data: memberData, error: memberError } = await (supabase as any)
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', cleanWorkspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError || !memberData || memberData.status !== 'active') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '작업공간 접근 권한이 없습니다.',
        },
        { status: 403 }
      );
    }

    if (memberData.role !== 'owner' && memberData.role !== 'manager') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '마케팅 커넥터 연동 권한이 없습니다.',
        },
        { status: 403 }
      );
    }

    // 4. 환경 변수 및 Microsoft OAuth 설정 검증
    const clientId = process.env.MARKETING_MICROSOFT_CLIENT_ID;
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return NextResponse.json(
        {
          error: 'SERVER_MISCONFIGURED',
          message: '서버 연동을 위한 환경 설정이 필요합니다.',
        },
        { status: 500 }
      );
    }

    // 5. Scope 검증 (요청 body 파싱 및 validateMicrosoftScopeRequest 게이트)
    let requestedScopes: readonly string[] = [
      MICROSOFT_MAIL_READ_SCOPE,
      MICROSOFT_OFFLINE_ACCESS_SCOPE,
    ];

    try {
      const contentType = request.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const body = await request.json().catch(() => null);
        if (body && 'scopes' in body) {
          requestedScopes = body.scopes;
        }
      }
    } catch {
      // Body parse fallback
    }

    let validatedScopes: readonly string[];
    try {
      validatedScopes = validateMicrosoftScopeRequest(requestedScopes);
    } catch (err: any) {
      if (err instanceof MicrosoftPolicyViolationError) {
        return NextResponse.json(
          {
            error: err.code,
            message: err.message,
            scope: err.scope,
          },
          { status: 400 }
        );
      }
      throw err;
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://example.com';
    const cleanAppUrl = appUrl.trim().replace(/\/+$/, '');
    const redirectUri =
      process.env.MARKETING_MICROSOFT_REDIRECT_URI ||
      `${cleanAppUrl}/api/marketing-connectors/microsoft/callback`;

    // 6. F02 영속 OAuth 트랜잭션 및 PKCE 생성
    const adminSupabase = createAdminSupabaseClient();
    const gateway = createSupabaseOAuthTransactionGateway(adminSupabase as any);

    const tx = await createMarketingOAuthTransaction(
      {
        workspaceId: cleanWorkspaceId,
        userId: user.id,
        providerId: 'outlook_mail' as unknown as ProviderId,
        requestedScopes: validatedScopes,
        redirectUri,
      },
      gateway
    );

    // 7. Microsoft Authorize URL 구성 (tenant, PKCE S256, consent prompt)
    const tenantId = (process.env.MARKETING_MICROSOFT_TENANT_ID || 'common').trim();
    const authorizeUrl = buildMicrosoftAuthorizeUrl({
      clientId: clientId.trim(),
      redirectUri,
      state: tx.state,
      codeChallenge: tx.codeChallenge,
      scopes: validatedScopes,
      tenantId,
      prompt: 'consent',
    });

    return NextResponse.json(
      {
        authorizeUrl,
        url: authorizeUrl,
        state: tx.state,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하는 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
