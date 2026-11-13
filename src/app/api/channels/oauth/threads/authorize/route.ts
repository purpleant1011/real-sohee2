export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createOAuthTransaction } from '@/lib/channels/oauth-transaction-manager';
import { getMetaOAuthScopes, isExtendedMetaScopeAllowed } from '@/features/channels/oauth/meta-oauth';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId');
    const returnPath = searchParams.get('returnPath') || '/app/settings/channels';

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId가 필요합니다.' }, { status: 400 });
    }

    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: '워크스페이스 접근 권한이 없습니다.' }, { status: 403 });
    }

    const appId = process.env.THREADS_APP_ID || '2253956925388481';
    const appUrl = process.env.APP_URL || 'https://example.com';
    const redirectUri = `${appUrl}/api/channels/oauth/threads/callback`;

    // Scopes: default publish vs extended (replies, insights)
    const extendedParam = searchParams.get('extended');
    const isExtended = isExtendedMetaScopeAllowed({
      workspaceId,
      role: member.role,
      env: process.env,
      extended: extendedParam === '1' || extendedParam === 'true',
    });
    const requestedScopes = [...getMetaOAuthScopes('threads', { extended: isExtended })];

    // Single-use transaction 생성 (ANI-625)
    const tx = await createOAuthTransaction(supabase, {
      workspaceId,
      userId: user.id,
      provider: 'META',
      channel: 'THREADS',
      requestedScopes,
      redirectUri,
      returnPath
    });

    const authUrl = new URL('https://threads.net/oauth/authorize');
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', tx.state);
    authUrl.searchParams.set('scope', requestedScopes.join(','));
    authUrl.searchParams.set('response_type', 'code');

    return NextResponse.redirect(authUrl.toString());
  } catch (err: any) {
    console.error('[Threads OAuth Authorize Error]:', err);
    return NextResponse.json({ error: err.message || '인증 시작 실패' }, { status: 500 });
  }
}
