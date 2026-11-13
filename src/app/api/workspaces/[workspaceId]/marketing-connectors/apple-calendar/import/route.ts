import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  saveImportedCalendarEvents,
  createSupabaseCalendarImportGateway,
  CalendarImportValidationError,
  type ImportedCalendarEventInput,
} from '@/features/marketing-connectors/imports/calendar-import-service';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ImportRequestBody {
  events?: ImportedCalendarEventInput[];
  timeZone?: string;
  sourceHash?: string;
}

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

    // 4. Request Body 파싱
    let body: ImportRequestBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'INVALID_PAYLOAD',
          message: '올바른 JSON 요청 본문이 필요합니다.',
        },
        { status: 400 }
      );
    }

    // 5. 서버 검증 및 영속 저장 실행
    const gateway = createSupabaseCalendarImportGateway(supabase);
    const result = await saveImportedCalendarEvents(
      {
        workspaceId: cleanWorkspaceId,
        events: body.events ?? [],
        actorUserId: user.id,
        timeZone: body.timeZone,
        sourceHash: body.sourceHash,
      },
      gateway
    );

    return NextResponse.json({
      ok: true,
      sourceId: result.sourceId,
      consentGeneration: result.consentGeneration,
      importedCount: result.importedCount,
      validUntil: result.validUntil,
    });
  } catch (error: any) {
    if (error instanceof CalendarImportValidationError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: '캘린더 일정을 가져오는 중 서버 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
