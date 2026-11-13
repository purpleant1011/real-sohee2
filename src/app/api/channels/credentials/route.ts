export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { disconnectChannelConnection } from '@/features/channels/credential-repository';
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId: req.nextUrl.searchParams.get('workspaceId') || req.nextUrl.searchParams.get('workspace_id'),
    });
    if (!resolved.success) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.statusCode });
    }
    const workspaceId = resolved.workspaceId;

    const { data: connections, error } = await supabase
      .from('channel_connections')
      .select('channel, status, account_label, updated_at, webhook_status, last_webhook_at, external_account_id')
      .eq('workspace_id', workspaceId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      connections: connections || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 });
    }

    const body = await req.json();
    const resolved = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
      requestedWorkspaceId: body.workspaceId || body.workspace_id
        || req.nextUrl.searchParams.get('workspaceId') || req.nextUrl.searchParams.get('workspace_id'),
    });
    if (!resolved.success) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.statusCode });
    }
    const { workspaceId, role } = resolved;
    if (role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: '채널 연결을 변경할 권한이 없습니다.' }, { status: 403 });
    }

    const { channelId, accountLabel, accessToken, action } = body;
    const cleanLabel = (accountLabel || '').trim();

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }

    // Manual tokens do not prove account ownership, granted scopes, or expiry.
    // Only the server-owned OAuth transaction may create a connected credential.
    if (action === 'bind_provider_token') {
      return NextResponse.json({
        code: 'OAUTH_REQUIRED',
        error: '공식 연동을 통해 계정과 사용 권한을 확인해 주세요.',
      }, { status: 400 });
    }

    // [ANI-614 / ANI-624] 보안 철칙: 일반 클라이언트에서 임의의 Access Token 직접 주입 시도 전면 거부
    if (accessToken) {
      return NextResponse.json({
        error: '소희는 고객의 보안을 위해 토큰을 직접 입력받지 않습니다. 공식 OAuth 연결을 이용해 주세요.'
      }, { status: 400 });
    }

    // Disconnect Action (Server-Owned)
    if (action === 'disconnect') {
      await disconnectChannelConnection(
        workspaceId,
        user.id,
        role || 'owner',
        channelId.toLowerCase()
      );
      return NextResponse.json({
        success: true,
        channelId,
        status: 'DISCONNECTED',
        message: `${channelId} 채널 연결이 안전하게 해제되었습니다.`
      });
    }

    const adminSupabase = createAdminSupabaseClient();

    if (channelId === 'INSTAGRAM' || channelId === 'THREADS') {
      const provider = channelId.toLowerCase();
      const { data: existing } = await adminSupabase
        .from('channel_connections')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('channel', provider)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await adminSupabase
          .from('channel_connections')
          .update({
            account_label: cleanLabel || `${provider}_account`,
            status: 'not_connected',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await adminSupabase
          .from('channel_connections')
          .insert({
            workspace_id: workspaceId,
            channel: provider,
            account_label: cleanLabel || `${provider}_account`,
            status: 'not_connected',
            updated_at: new Date().toISOString()
          });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        channelId,
        status: 'NOT_CONNECTED',
        accountLabel: cleanLabel,
        message: `${channelId} 계정 식별자가 등록되었습니다. [공식 연동]을 통해 OAuth 승인을 완료해 주세요.`
      });
    }

    if (channelId === 'NAVER_BLOG') {
      const blogId = cleanLabel || 'my_naver_blog';
      
      const { data: existingB } = await (adminSupabase as any)
        .from('browser_channel_connections')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'NAVER_BLOG')
        .maybeSingle();

      if (existingB?.id) {
        const { error } = await (adminSupabase as any)
          .from('browser_channel_connections')
          .update({
            external_account_label: blogId,
            target_external_id: blogId,
            target_url: `https://blog.naver.com/${blogId}`,
            status: 'connected',
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existingB.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      } else {
        const { error } = await (adminSupabase as any)
          .from('browser_channel_connections')
          .insert({
            workspace_id: workspaceId,
            channel: 'NAVER_BLOG',
            external_account_label: blogId,
            device_id: 'browser-default',
            environment: 'web',
            target_external_id: blogId,
            target_fingerprint: `naver-${blogId}`,
            target_url: `https://blog.naver.com/${blogId}`,
            status: 'connected',
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const { data: existingConn } = await adminSupabase
        .from('channel_connections')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('channel', 'naver_blog')
        .maybeSingle();

      if (existingConn?.id) {
        await adminSupabase
          .from('channel_connections')
          .update({
            account_label: `@${blogId}`,
            status: 'authorized',
            updated_at: new Date().toISOString()
          })
          .eq('id', existingConn.id);
      } else {
        await adminSupabase
          .from('channel_connections')
          .insert({
            workspace_id: workspaceId,
            channel: 'naver_blog',
            account_label: `@${blogId}`,
            status: 'authorized',
            updated_at: new Date().toISOString()
          });
      }

      return NextResponse.json({
        success: true,
        channelId,
        status: 'AUTHORIZED',
        accountLabel: `@${blogId}`,
        message: '네이버 블로그 계정이 안전하게 등록되었습니다. 스마트에디터 ONE 원클릭 브릿지가 가동됩니다.'
      });
    }

    return NextResponse.json({ error: '지원하지 않는 채널입니다.' }, { status: 400 });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
