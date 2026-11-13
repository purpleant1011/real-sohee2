import { NextRequest, NextResponse } from 'next/server';
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  disconnectMarketingConnector,
  loadConnectorHubSnapshot,
  MarketingConnectorError,
  type MarketingConnectorGateway,
} from '@/features/marketing-connectors/server/connection-service';

function createSupabaseGateway(supabase: any): MarketingConnectorGateway {
  return {
    async getMarketingConnections(workspaceId: string) {
      const { data, error } = await supabase
        .from('marketing_connector_connections')
        .select('workspace_id, connector_id, status, last_sync_at, capabilities')
        .eq('workspace_id', workspaceId);
      return { data, error };
    },
    async getChannelConnections(workspaceId: string) {
      const { data, error } = await supabase
        .from('channel_connections')
        .select('id, workspace_id, channel, status, updated_at')
        .eq('workspace_id', workspaceId);
      return { data, error };
    },
    async getMetaCredentials(workspaceId: string) {
      // meta_channel_credentials is service-role only in production DB (RLS revokes authenticated select)
      // Query privileged metadata after verifying owner/manager active membership, strictly scoped by workspaceId
      try {
        const adminSupabase = createAdminSupabaseClient();
        const { data, error } = await (adminSupabase as any)
          .from('meta_channel_credentials')
          .select('workspace_id, channel_connection_id, provider, status, granted_scopes, token_expires_at')
          .eq('workspace_id', workspaceId);

        if (error) {
          return { data: null, error: { code: error.code, message: 'DATABASE_QUERY_ERROR' } };
        }

        const scopedData = Array.isArray(data)
          ? data.filter((row: any) => row.workspace_id === workspaceId)
          : [];

        return { data: scopedData, error: null };
      } catch {
        return { data: null, error: { code: 'PRIVILEGED_CLIENT_ERROR', message: 'DATABASE_QUERY_ERROR' } };
      }
    },
    async disconnectConnectorRpc(params: {
      p_workspace_id: string;
      p_connector_id: string;
      p_actor_user_id: string;
    }) {
      const { data, error } = await supabase.rpc('disconnect_marketing_connector', params);
      return { data, error };
    },
    async getDeletionJobs(workspaceId: string) {
      const { data, error } = await supabase
        .from('marketing_connector_deletion_jobs')
        .select('workspace_id, connector_id, consent_generation, status')
        .eq('workspace_id', workspaceId);
      return { data, error };
    },
    async checkWorkspaceRole(workspaceId: string, userId: string) {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('role, status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (error || !data) {
        return { ok: false };
      }
      return { ok: true, role: data.role };
    },
  };
}

function verifySameOrigin(request: NextRequest): boolean {
  const originHeader = request.headers.get('origin');
  if (!originHeader) return true; // Non-browser / same-process

  try {
    const requestUrlOrigin = new URL(request.url).origin;
    return originHeader === requestUrlOrigin;
  } catch {
    return false;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<NextResponse> {
  try {
    const { workspaceId } = await context.params;

    const auth = await requireWorkspaceMembership(workspaceId, { allowDemoBypass: false });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      );
    }

    // Strict role check: owner/manager only (general staff/member is forbidden from reading connector management)
    const supabase = await createServerSupabaseClient();
    const { data: memberData, error: memberError } = await (supabase as any)
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError || !memberData || (memberData.role !== 'owner' && memberData.role !== 'manager')) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: '작업공간 접근 권한이 없습니다.' },
        { status: 403 }
      );
    }

    const gateway = createSupabaseGateway(supabase);
    const snapshot = await loadConnectorHubSnapshot(workspaceId, gateway);

    return NextResponse.json(snapshot, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: any) {
    const status = err instanceof MarketingConnectorError ? err.status : 500;
    const code = err instanceof MarketingConnectorError ? err.code : 'INTERNAL_SERVER_ERROR';
    const message = status === 500 ? '요청을 처리하는 중 오류가 발생했습니다.' : err.message;
    return NextResponse.json({ error: code, message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> }
): Promise<NextResponse> {
  try {
    if (!verifySameOrigin(request)) {
      return NextResponse.json(
        { error: 'FORBIDDEN_ORIGIN', message: '허용되지 않은 요청 출처입니다.' },
        { status: 403 }
      );
    }

    const { workspaceId } = await context.params;

    const auth = await requireWorkspaceMembership(workspaceId, { allowDemoBypass: false });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, message: auth.message },
        { status: auth.status }
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data: memberData, error: memberError } = await (supabase as any)
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', workspaceId)
      .eq('user_id', auth.userId)
      .eq('status', 'active')
      .maybeSingle();

    if (memberError || !memberData || (memberData.role !== 'owner' && memberData.role !== 'manager')) {
      return NextResponse.json(
        { error: 'FORBIDDEN', message: '커넥터 연결 해제 권한이 없습니다.' },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'INVALID_JSON', message: '유효한 JSON 본문이 필요합니다.' },
        { status: 400 }
      );
    }

    if (
      !body ||
      typeof body !== 'object' ||
      !('connectorId' in body) ||
      typeof (body as any).connectorId !== 'string'
    ) {
      return NextResponse.json(
        { error: 'INVALID_CONNECTOR_ID', message: 'connectorId가 필요합니다.' },
        { status: 400 }
      );
    }

    const connectorId = (body as any).connectorId;

    // Social connectors must direct to /app/channels
    if (
      connectorId === 'instagram' ||
      connectorId === 'threads' ||
      connectorId === 'instagram_messages'
    ) {
      return NextResponse.json(
        {
          error: 'SOCIAL_CHANNEL_MANAGEMENT_REQUIRED',
          message: '소셜 채널 연결 해제는 기존 채널 관리(/app/channels)에서 진행해야 합니다.',
        },
        { status: 400 }
      );
    }

    const gateway = createSupabaseGateway(supabase);
    const result = await disconnectMarketingConnector(
      {
        workspaceId,
        connectorId,
        actorUserId: auth.userId,
      },
      gateway
    );

    return NextResponse.json({
      ok: true,
      connectorId: result.connectorId,
      consentGeneration: result.consentGeneration,
      pendingDeletion: result.pendingDeletion,
    });
  } catch (err: any) {
    const status = err instanceof MarketingConnectorError ? err.status : 500;
    const code = err instanceof MarketingConnectorError ? err.code : 'INTERNAL_SERVER_ERROR';
    const message = status === 500 ? '요청을 처리하는 중 오류가 발생했습니다.' : err.message;
    return NextResponse.json({ error: code, message }, { status });
  }
}
