import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  verifyAndRegisterDriveFiles,
  GoogleDrivePickerError,
  type DriveFileGateway,
} from '@/features/marketing-connectors/picker/google-picker-service';
import {
  DefaultConsentLedgerGateway,
} from '@/app/api/workspaces/[workspaceId]/marketing-connectors/google/calendars/route';
import { DefaultCredentialVaultGateway } from '@/app/api/marketing-connectors/google/callback/route';
import {
  loadConnectorCredential,
  type CredentialVaultGateway,
} from '@/features/marketing-connectors/credentials/credential-vault';
import type { ConnectorId } from '@/features/marketing-connectors/catalog';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * F03 Vault에서 Google 토큰을 조회한다.
 * google_drive -> google_docs -> google_sheets -> google_calendar 순으로 폴백 탐색
 */
async function resolveGoogleAccessToken(
  workspaceId: string,
  vaultGateway: CredentialVaultGateway
): Promise<string | null> {
  const candidateConnectors: ConnectorId[] = [
    'google_drive',
    'google_docs',
    'google_sheets',
    'google_calendar',
  ];

  for (const cid of candidateConnectors) {
    try {
      const cred = await vaultGateway.getCredential(workspaceId, cid);
      if (cred) {
        const loaded = await loadConnectorCredential(
          workspaceId,
          cid,
          cred.consentGeneration,
          vaultGateway
        );
        if (loaded?.accessToken) {
          return loaded.accessToken;
        }
      }
    } catch {
      // 다음 후보 탐색
    }
  }

  return null;
}

export function createProductionDriveFileGateway(): DriveFileGateway {
  return {
    getAccessToken: async (workspaceId: string) => {
      return resolveGoogleAccessToken(workspaceId, defaultVaultGateway);
    },
    consentLedgerGateway: defaultConsentGateway,
    updateConnectionGeneration: async (
      workspaceId: string,
      connectorId: ConnectorId,
      generation: number
    ) => {
      try {
        const adminSupabase = createAdminSupabaseClient();
        await (adminSupabase as any)
          .from('marketing_connector_connections')
          .update({
            consent_generation: generation,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', workspaceId)
          .eq('connector_id', connectorId);
      } catch {
        // 비치명적 갱신 실패 무시
      }
    },
  };
}

/**
 * POST /api/workspaces/[workspaceId]/marketing-connectors/google/drive/files
 * Google Picker에서 선택된 파일 ID를 서버 측에서 검증하고 F04 동의 원장에 등록한다.
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

    const rawFileIds = body?.fileIds ?? body?.selectedFileIds;
    if (!Array.isArray(rawFileIds) || rawFileIds.length === 0) {
      return NextResponse.json(
        {
          error: 'FILE_IDS_REQUIRED',
          message: '하나 이상의 파일 ID를 선택해야 합니다.',
        },
        { status: 400 }
      );
    }

    const aiProcessingApproved =
      typeof body.aiProcessingApproved === 'boolean'
        ? body.aiProcessingApproved
        : true;

    const gateway = createProductionDriveFileGateway();

    const result = await verifyAndRegisterDriveFiles(
      {
        workspaceId,
        actorUserId: userId,
        fileIds: rawFileIds,
        aiProcessingApproved,
        purpose: body.purpose ?? 'marketing',
      },
      gateway
    );

    return NextResponse.json(
      {
        ok: true,
        files: result.files,
        consent: result.consent,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof GoogleDrivePickerError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          fileId: err.fileId,
        },
        { status: err.status ?? 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Google Drive 파일 동의를 등록하는 중 서버 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
