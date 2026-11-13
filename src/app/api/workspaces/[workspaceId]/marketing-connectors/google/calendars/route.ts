import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { listGoogleCalendars } from '@/features/marketing-connectors/adapters/google-calendar-sources';
import {
  recordConsentGrant,
  type ConsentLedgerGateway,
  type MarketingConsentRecord,
} from '@/features/marketing-connectors/consent/consent-ledger';
import { DefaultCredentialVaultGateway } from '@/app/api/marketing-connectors/google/callback/route';
import type { ConnectorId } from '@/features/marketing-connectors/catalog';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DefaultConsentLedgerGateway implements ConsentLedgerGateway {
  private static store = new Map<string, MarketingConsentRecord>();

  async getLatestConsent(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<MarketingConsentRecord | null> {
    const existing = DefaultConsentLedgerGateway.store.get(
      `${workspaceId}:${connectorId}`
    );
    if (existing) {
      return existing;
    }

    try {
      const adminSupabase = createAdminSupabaseClient();
      const { data } = await (adminSupabase as any)
        .from('marketing_connector_connections')
        .select('consent_generation')
        .eq('workspace_id', workspaceId)
        .eq('connector_id', connectorId)
        .maybeSingle();

      if (data && typeof data.consent_generation === 'number') {
        return {
          workspaceId,
          connectorId,
          consentGeneration: data.consent_generation,
          allowedSourceIds: [],
          purpose: 'marketing',
          validUntil: new Date().toISOString(),
          aiProcessingApproved: false,
          status: 'active',
          updatedAt: new Date().toISOString(),
          updatedBy: 'system',
        };
      }
    } catch {
      // ignore
    }

    return null;
  }

  async saveConsentRecord(record: MarketingConsentRecord): Promise<void> {
    DefaultConsentLedgerGateway.store.set(
      `${record.workspaceId}:${record.connectorId}`,
      record
    );
  }
}

const defaultVaultGateway = new DefaultCredentialVaultGateway();
const defaultConsentGateway = new DefaultConsentLedgerGateway();

async function authorizeWorkspaceManager(
  rawWorkspaceId: string
): Promise<
  | { ok: true; workspaceId: string; userId: string; user: any }
  | { ok: false; response: NextResponse }
> {
  if (
    !rawWorkspaceId ||
    typeof rawWorkspaceId !== 'string' ||
    !UUID_REGEX.test(rawWorkspaceId.trim())
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'INVALID_WORKSPACE_ID',
          message: '유효한 작업공간 식별자가 필요합니다.',
        },
        { status: 400 }
      ),
    };
  }

  const workspaceId = rawWorkspaceId.trim();

  // 1. 작업공간 멤버십 가드 검증
  const auth = await requireWorkspaceMembership(workspaceId, {
    allowDemoBypass: false,
  });
  if (!auth.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      ),
    };
  }

  // 2. 실제 세션 사용자 확인
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'AUTH_REQUIRED',
          message: '인증이 필요합니다. 로그인 후 다시 시도해 주세요.',
        },
        { status: 401 }
      ),
    };
  }

  if (user.id !== auth.userId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '작업공간 접근 권한이 없습니다.',
        },
        { status: 403 }
      ),
    };
  }

  // 3. active workspace_members role 대조 (owner / manager만 허용)
  const { data: memberData, error: memberError } = await (supabase as any)
    .from('workspace_members')
    .select('role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (memberError || !memberData || memberData.status !== 'active') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '작업공간 접근 권한이 없습니다.',
        },
        { status: 403 }
      ),
    };
  }

  if (memberData.role !== 'owner' && memberData.role !== 'manager') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: '마케팅 커넥터 연동 권한이 없습니다.',
        },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    workspaceId,
    userId: user.id,
    user,
  };
}

/**
 * GET /api/workspaces/[workspaceId]/marketing-connectors/google/calendars
 * 연결된 Google 계정의 캘린더 목록(id, summary, primary, timeZone)을 조회
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<NextResponse> {
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const authResult = await authorizeWorkspaceManager(rawWorkspaceId);
    if (!authResult.ok) {
      return authResult.response;
    }

    const { workspaceId } = authResult;

    // Google Calendar 커넥터 연동 확인
    const adminSupabase = createAdminSupabaseClient();
    const { data: connection } = await (adminSupabase as any)
      .from('marketing_connector_connections')
      .select('status, consent_generation')
      .eq('workspace_id', workspaceId)
      .eq('connector_id', 'google_calendar')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json(
        {
          error: 'CONNECTOR_NOT_FOUND',
          message: 'Google Calendar 커넥터 연결 정보를 찾을 수 없습니다.',
        },
        { status: 404 }
      );
    }

    const adapterResult = await listGoogleCalendars(
      workspaceId,
      defaultVaultGateway,
      { generation: connection.consent_generation }
    );

    if (!adapterResult.ok) {
      const err = adapterResult.error;
      const statusMap: Record<string, number> = {
        not_found: 404,
        unauthorized: 401,
        forbidden: 403,
        rate_limited: 429,
        invalid_input: 400,
      };
      const status = statusMap[err.code] || 500;
      return NextResponse.json(
        {
          error: err.code.toUpperCase(),
          message: err.message,
        },
        { status }
      );
    }

    return NextResponse.json(
      { calendars: adapterResult.data },
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
        message: '캘린더 목록을 조회하는 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/marketing-connectors/google/calendars
 * 사장님이 선택한 캘린더 ID 목록을 F04 동의 원장(allowedSourceIds)에 영속화
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<NextResponse> {
  try {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const authResult = await authorizeWorkspaceManager(rawWorkspaceId);
    if (!authResult.ok) {
      return authResult.response;
    }

    const { workspaceId, userId } = authResult;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'INVALID_JSON',
          message: '유효한 JSON 요청 본문이 필요합니다.',
        },
        { status: 400 }
      );
    }

    const selectedCalendarIds = body?.selectedCalendarIds;

    // 1. 선택된 캘린더 ID 필수 검증
    if (!Array.isArray(selectedCalendarIds) || selectedCalendarIds.length === 0) {
      return NextResponse.json(
        {
          error: 'SELECTED_CALENDARS_REQUIRED',
          message: '하나 이상의 캘린더를 선택해야 합니다.',
        },
        { status: 400 }
      );
    }

    // 2. 명시적 선택 원칙 및 primary alias 자동 선택 차단 검증
    const sanitizedIds: string[] = [];
    for (const rawId of selectedCalendarIds) {
      if (typeof rawId !== 'string' || !rawId.trim()) {
        return NextResponse.json(
          {
            error: 'INVALID_CALENDAR_ID',
            message: '유효하지 않은 캘린더 식별자가 포함되어 있습니다.',
          },
          { status: 400 }
        );
      }
      const trimmed = rawId.trim();
      if (trimmed.toLowerCase() === 'primary') {
        return NextResponse.json(
          {
            error: 'EXPLICIT_CHOICE_REQUIRED',
            message:
              '기본 "primary" 별칭 대신 사장님이 명시적으로 선택한 실제 캘린더 ID가 필요합니다.',
          },
          { status: 400 }
        );
      }
      if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
        return NextResponse.json(
          {
            error: 'INVALID_CALENDAR_ID',
            message: '캘린더 식별자 형식이 올바르지 않습니다.',
          },
          { status: 400 }
        );
      }
      sanitizedIds.push(trimmed);
    }

    const aiProcessingApproved =
      typeof body.aiProcessingApproved === 'boolean'
        ? body.aiProcessingApproved
        : true;

    // 3. F04 동의 원장에 세대 갱신 및 allowedSourceIds 영속화
    const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const consent = await recordConsentGrant(
      {
        workspaceId,
        connectorId: 'google_calendar',
        allowedSourceIds: sanitizedIds,
        purpose: 'marketing',
        validUntil,
        aiProcessingApproved,
        actorUserId: userId,
      },
      defaultConsentGateway
    );

    // 4. marketing_connector_connections 연결 상태 동의 세대 갱신
    const adminSupabase = createAdminSupabaseClient();
    await (adminSupabase as any)
      .from('marketing_connector_connections')
      .update({
        consent_generation: consent.consentGeneration,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('connector_id', 'google_calendar');

    return NextResponse.json(
      {
        ok: true,
        consent,
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
        message: '캘린더 선택 동의를 저장하는 중 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
