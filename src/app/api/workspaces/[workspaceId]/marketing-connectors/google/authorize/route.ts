import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  createMarketingOAuthTransaction,
  createSupabaseOAuthTransactionGateway,
} from '@/features/marketing-connectors/oauth/oauth-transaction';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GOOGLE_CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.readonly';

export async function POST(
  _request: NextRequest,
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

    // 4. 환경 변수 및 Google OAuth 설정 검증
    const clientId = process.env.MARKETING_GOOGLE_CLIENT_ID;
    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return NextResponse.json(
        {
          error: 'SERVER_MISCONFIGURED',
          message: '서버 연동을 위한 환경 설정이 필요합니다.',
        },
        { status: 500 }
      );
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://example.com';
    const cleanAppUrl = appUrl.trim().replace(/\/+$/, '');
    const redirectUri = `${cleanAppUrl}/api/marketing-connectors/google/callback`;

    // 5. F02 영속 OAuth 트랜잭션 및 PKCE 생성
    const adminSupabase = createAdminSupabaseClient();
    const gateway = createSupabaseOAuthTransactionGateway(adminSupabase as any);

    const tx = await createMarketingOAuthTransaction(
      {
        workspaceId: cleanWorkspaceId,
        userId: user.id,
        providerId: 'google',
        requestedScopes: [GOOGLE_CALENDAR_SCOPE],
        redirectUri,
      },
      gateway
    );

    // 6. Google Authorize URL 구성 (offline access, consent prompt, PKCE)
    const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorizeUrl.searchParams.set('client_id', clientId.trim());
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
    authorizeUrl.searchParams.set('state', tx.state);
    authorizeUrl.searchParams.set('code_challenge', tx.codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('access_type', 'offline');
    authorizeUrl.searchParams.set('prompt', 'consent');

    return NextResponse.json(
      {
        authorizeUrl: authorizeUrl.toString(),
        url: authorizeUrl.toString(),
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
