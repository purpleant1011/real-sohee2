import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listProviderReadiness } from '@/features/marketing-connectors/providers/config.server';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
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

    // 1. 기존 작업공간 가드 검증 (데모 우회 금지)
    const auth = await requireWorkspaceMembership(cleanWorkspaceId, {
      allowDemoBypass: false,
    });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      );
    }

    // 2. 실제 세션 사용자 확인 (guard 통과 후 auth.getUser 실사용자 일치 검증)
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

    // 3. 실제 active workspace_members role 대조 (owner / manager만 허용, staff/member/disabled 차단)
    // workspaces 테이블의 created_by 영구 권한이나 데모 우회 불인정
    const { data: memberData, error: memberError } = await (supabase as any)
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', cleanWorkspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError || !memberData) {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '작업공간 접근 권한이 없습니다.',
        },
        { status: 403 }
      );
    }

    if (memberData.status !== 'active') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '비활성화된 사용자 계정입니다.',
        },
        { status: 403 }
      );
    }

    if (memberData.role !== 'owner' && memberData.role !== 'manager') {
      return NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '마케팅 커넥터 조회 권한이 없습니다.',
        },
        { status: 403 }
      );
    }

    // 4. 공급자 readiness 판정 (기본 approvedProviders: []로 안전 차단, process.env 서버 격리)
    const isProduction = process.env.NODE_ENV === 'production';

    const providers = listProviderReadiness(process.env, {
      isProduction,
      approvedProviders: [],
    });

    return NextResponse.json(
      {
        workspaceId: cleanWorkspaceId,
        providers,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch {
    // DB 에러 등 예외 발생 시 내부 오류 및 DB 접속 원문 노출 차단, 고정 한국어 응답
    return NextResponse.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하는 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
