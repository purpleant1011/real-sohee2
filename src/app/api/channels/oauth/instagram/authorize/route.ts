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

    // 워크스페이스 소속 검증
    const { data: member } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ error: '워크스페이스 접근 권한이 없습니다.' }, { status: 403 });
    }

    const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '1568352131460103';
    const appUrl = process.env.APP_URL || 'https://example.com';
    const redirectUri = `${appUrl}/api/channels/oauth/instagram/callback`;

    // Scopes: default publish vs extended (comments, DM, insights)
    const extendedParam = searchParams.get('extended');
    const isExtended = isExtendedMetaScopeAllowed({
      workspaceId,
      role: member.role,
      env: process.env,
      extended: extendedParam === '1' || extendedParam === 'true',
    });
    const requestedScopes = [...getMetaOAuthScopes('instagram', { extended: isExtended })];

    // Single-use state 트랜잭션 생성 (ANI-625)
    const tx = await createOAuthTransaction(supabase, {
      workspaceId,
      userId: user.id,
      provider: 'META',
      channel: 'INSTAGRAM',
      requestedScopes,
      redirectUri,
      returnPath
    });

    // Meta Official OAuth URL 구성
    const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', tx.state);
    authUrl.searchParams.set('scope', requestedScopes.join(','));
    authUrl.searchParams.set('response_type', 'code');

    return NextResponse.redirect(authUrl.toString());
  } catch (err: any) {
    console.error('[Instagram OAuth Authorize Error]:', err);
    return NextResponse.json({ error: err.message || '인증 시작 실패' }, { status: 500 });
  }
}
