export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context';
import { verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification';
import { consumeOAuthTransaction, assertNoCrossWorkspaceBinding } from '@/lib/channels/oauth-transaction-manager';
import { grantConnectedSignupCredits } from '@/features/membership/grant-connected-signup-credits';
import { parseReturnPath } from '@/features/channels/oauth/return-paths';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const rawState = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl = process.env.APP_URL || 'https://example.com';
  const defaultReturnPath = '/app/settings/channels';

  if (error) {
    console.error('[Threads OAuth Callback Rejected]:', { code: 'OAUTH_REJECTED' });
    const destination = new URL(parseReturnPath(defaultReturnPath), appUrl);
    destination.searchParams.set('channel', 'threads');
    destination.searchParams.set('connect', 'cancelled');
    destination.searchParams.set('error', 'OAUTH_REJECTED');
    return NextResponse.redirect(destination.toString());
  }

  if (!code || !rawState) {
    return NextResponse.redirect(`${appUrl}${defaultReturnPath}?error=MISSING_CODE_OR_STATE`);
  }

  let tx: any = null;

  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${appUrl}/login?error=AUTH_REQUIRED`);
    }

    // Deterministic canonical workspace resolution (ANI-1429)
    const workspaceResolution = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
    });
    if (!workspaceResolution.success) {
      return NextResponse.redirect(`${appUrl}${defaultReturnPath}?error=NO_WORKSPACE`);
    }
    const workspaceId = workspaceResolution.workspaceId;

    // 1. Consume OAuth Transaction (Single-Use Enforcement: ANI-625)
    tx = await consumeOAuthTransaction(supabase, rawState, workspaceId, user.id);

    const appId = process.env.THREADS_APP_ID || '2253956925388481';
    const appSecret = process.env.THREADS_APP_SECRET || process.env.META_APP_SECRET || '';
    const redirectUri = `${appUrl}/api/channels/oauth/threads/callback`;

    // 2. Token Exchange (POST https://graph.threads.net/oauth/access_token)
    const tokenForm = new URLSearchParams();
    tokenForm.append('client_id', appId);
    tokenForm.append('client_secret', appSecret);
    tokenForm.append('grant_type', 'authorization_code');
    tokenForm.append('redirect_uri', redirectUri);
    tokenForm.append('code', code);

    const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[Threads Token Exchange Error]:', {
        status: tokenRes.status,
        code: 'TOKEN_EXCHANGE_FAILED',
      });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'threads');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', 'TOKEN_EXCHANGE_FAILED');
      dest.searchParams.set('error', 'TOKEN_EXCHANGE_FAILED');
      return NextResponse.redirect(dest.toString());
    }

    // Granted Scope 사전 판정 (게시 권한 누락 체크)
    const grantedScopesRaw = tokenData.scope || tokenData.permissions;
    let grantedArray: string[] = [];
    if (grantedScopesRaw) {
      grantedArray = Array.isArray(grantedScopesRaw)
        ? grantedScopesRaw
        : typeof grantedScopesRaw === 'string'
          ? grantedScopesRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
    } else {
      // Authoritative token inspection via debug_token endpoint (Threads API official contract)
      try {
        const appAccessToken = appId.startsWith('TH|') ? appId : `TH|${appId}|${appSecret}`;
        const debugRes = await fetch(
          `https://graph.threads.net/v1.0/debug_token?access_token=${encodeURIComponent(appAccessToken)}&input_token=${encodeURIComponent(tokenData.access_token)}`
        );
        const debugData = await debugRes.json();
        if (debugRes.ok && Array.isArray(debugData?.data?.scopes)) {
          grantedArray = debugData.data.scopes;
        } else {
          console.error('[Threads Callback Scope Verification Unavailable]:', { code: 'SCOPE_VERIFICATION_UNAVAILABLE' });
          const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
          dest.searchParams.set('channel', 'threads');
          dest.searchParams.set('connect', 'unavailable');
          dest.searchParams.set('connect_error', 'SCOPE_VERIFICATION_UNAVAILABLE');
          dest.searchParams.set('error', 'SCOPE_VERIFICATION_UNAVAILABLE');
          return NextResponse.redirect(dest.toString());
        }
      } catch {
        console.error('[Threads Callback Scope Verification Failed]:', { code: 'SCOPE_VERIFICATION_UNAVAILABLE' });
        const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
        dest.searchParams.set('channel', 'threads');
        dest.searchParams.set('connect', 'unavailable');
        dest.searchParams.set('connect_error', 'SCOPE_VERIFICATION_UNAVAILABLE');
        dest.searchParams.set('error', 'SCOPE_VERIFICATION_UNAVAILABLE');
        return NextResponse.redirect(dest.toString());
      }
    }
    if (grantedArray.length > 0 && !grantedArray.includes('threads_content_publish')) {
      console.error('[Threads Callback Scope Missing]:', { code: 'SCOPE_MISSING' });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'threads');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', 'SCOPE_MISSING');
      dest.searchParams.set('error', 'SCOPE_MISSING');
      return NextResponse.redirect(dest.toString());
    }

    const shortLivedToken = tokenData.access_token;
    const threadsUserId = tokenData.user_id;

    // 3. Long-lived Token Exchange (60 days)
    const longTokenUrl = new URL('https://graph.threads.net/access_token');
    longTokenUrl.searchParams.set('grant_type', 'th_exchange_token');
    longTokenUrl.searchParams.set('client_secret', appSecret);
    longTokenUrl.searchParams.set('access_token', shortLivedToken);

    let finalAccessToken = shortLivedToken;
    let tokenExpiresIn = 60 * 24 * 60 * 60;

    try {
      const longRes = await fetch(longTokenUrl.toString(), { method: 'GET' });
      const longData = await longRes.json();
      if (longData.access_token) {
        finalAccessToken = longData.access_token;
        if (longData.expires_in) tokenExpiresIn = longData.expires_in;
      }
    } catch (err) {
      console.warn('[Threads Long Token Exchange Warning]:', err);
    }

    const tokenExpiresAt = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();

    // 4. Fetch Profile & Username
    let username = `user_${threadsUserId}`;
    try {
      const profileRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url&access_token=${finalAccessToken}`);
      const profileData = await profileRes.json();
      if (profileData.username) {
        username = profileData.username;
      }
    } catch (err) {
      console.warn('[Threads Profile Fetch Warning]:', err);
    }

    // 5. Cross-Tenant 중복 바인딩 차단 (ANI-625)
    await assertNoCrossWorkspaceBinding(supabase, 'THREADS', threadsUserId, workspaceId);

    // 6. Channel Connection Canonical Upsert (ANI-614, ANI-628)
    const { error: upsertErr } = await (supabase as any)
      .from('channel_connections')
      .upsert({
        workspace_id: workspaceId,
        channel: 'THREADS',
        status: 'connected',
        account_label: username,
        provider_account_id: threadsUserId,
        token_vault_ref: `vault:threads:${threadsUserId}:${Date.now()}`,
        token_expires_at: tokenExpiresAt,
        last_refreshed_at: new Date().toISOString(),
        profile_metadata: {
          username,
          threadsUserId,
          connectedAt: new Date().toISOString()
        },
        verification_status: 'UNVERIFIED',
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id,channel' });

    if (upsertErr) {
      const upsertMsg = upsertErr.message || '';
      const errCode = upsertMsg.includes('DUPLICATE_BINDING') || upsertMsg.includes('duplicate key')
        ? 'ACCOUNT_ALREADY_CONNECTED'
        : 'CONNECTION_SAVE_FAILED';
      console.error('[Threads Upsert Error]:', { code: errCode });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'threads');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', errCode);
      dest.searchParams.set('error', errCode);
      return NextResponse.redirect(dest.toString());
    }
    await grantConnectedSignupCredits(user.id, workspaceId);

    // 7. Channel Consents Ledger (ANI-617)
    await (supabase as any)
      .from('channel_consents')
      .upsert([
        {
          workspace_id: workspaceId,
          channel: 'THREADS',
          consent_type: 'PUBLISH',
          is_granted: true,
          granted_at: new Date().toISOString()
        },
        {
          workspace_id: workspaceId,
          channel: 'THREADS',
          consent_type: 'COMMENT_DM',
          is_granted: true,
          granted_at: new Date().toISOString()
        }
      ], { onConflict: 'workspace_id,channel,consent_type' });

    // 8. Audit Event
    await (supabase as any).from('audit_events').insert({
      workspace_id: workspaceId,
      entity_type: 'channel_connection',
      entity_id: `THREADS:${threadsUserId}`,
      event_type: 'oauth_connected',
      metadata: {
        channel: 'THREADS',
        username,
        providerAccountId: threadsUserId,
        expiresAt: tokenExpiresAt,
        correlationId: tx.correlationId
      }
    }).catch((e: any) => console.warn('[threads callback] audit notice:', e));

    // 9. Post-OAuth Provider Capability Verification & Receipts (ANI-1429)
    await verifyPostOAuthChannelCapability({
      workspaceId,
      channel: 'threads',
      accessToken: finalAccessToken,
      providerAccountId: threadsUserId,
      accountLabel: username,
    }).catch((e: any) => console.warn('[threads callback] verification run notice:', e));

    const safePath = parseReturnPath(tx.returnPath || defaultReturnPath);
    const destination = new URL(safePath, appUrl);
    destination.searchParams.set('channel', 'threads');
    destination.searchParams.set('status', 'connected');
    destination.searchParams.set('connect', 'authorized');
    destination.searchParams.set('account', username);
    return NextResponse.redirect(destination.toString());

  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : '';
    let errorCode = 'CONNECTION_SAVE_FAILED';
    if (msg.includes('DUPLICATE_BINDING') || msg.includes('이미 다른 매장') || msg.includes('다른 소희')) {
      errorCode = 'ACCOUNT_ALREADY_CONNECTED';
    } else if (msg.includes('SCOPE_VERIFICATION_UNAVAILABLE')) {
      errorCode = 'SCOPE_VERIFICATION_UNAVAILABLE';
    } else if (msg.includes('SCOPE_MISSING') || msg.includes('threads_content_publish') || msg.includes('권한이 누락')) {
      errorCode = 'SCOPE_MISSING';
    }
    console.error('[Threads OAuth Callback Exception]:', { code: errorCode });
    const destination = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
    destination.searchParams.set('channel', 'threads');
    destination.searchParams.set('connect', 'unavailable');
    destination.searchParams.set('connect_error', errorCode);
    destination.searchParams.set('error', errorCode);
    return NextResponse.redirect(destination.toString());
  }
}
