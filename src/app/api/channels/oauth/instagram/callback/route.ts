export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveDeterministicWorkspace } from '@/features/auth/workspace-context';
import { verifyPostOAuthChannelCapability } from '@/features/channels/dual-channel-verification';
import { consumeOAuthTransaction, assertNoCrossWorkspaceBinding } from '@/lib/channels/oauth-transaction-manager';
import { grantConnectedSignupCredits } from '@/features/membership/grant-connected-signup-credits';
import { parseReturnPath } from '@/features/channels/oauth/return-paths';
import { subscribeInstagramWebhooks } from '@/features/channels/oauth/webhook-subscription';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const rawState = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl = process.env.APP_URL || 'https://example.com';
  const defaultReturnPath = '/app/settings/channels';

  if (error) {
    console.error('[Instagram OAuth Callback Rejected]:', { code: 'OAUTH_REJECTED' });
    const destination = new URL(parseReturnPath(defaultReturnPath), appUrl);
    destination.searchParams.set('channel', 'instagram');
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

    // 1. Get current workspace deterministically (ANI-1429)
    const workspaceResolution = await resolveDeterministicWorkspace({
      supabase,
      userId: user.id,
      userEmail: user.email,
    });
    if (!workspaceResolution.success) {
      return NextResponse.redirect(`${appUrl}${defaultReturnPath}?error=NO_WORKSPACE`);
    }
    const workspaceId = workspaceResolution.workspaceId;

    // 2. Consume OAuth Transaction (Replay & Single-Use Enforcement: ANI-625)
    tx = await consumeOAuthTransaction(supabase, rawState, workspaceId, user.id);

    const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '1568352131460103';
    const appSecret = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || '';
    const redirectUri = `${appUrl}/api/channels/oauth/instagram/callback`;

    // 3. Short-lived Access Token Exchange
    const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[Instagram Token Exchange Error]:', {
        status: tokenRes.status,
        code: 'TOKEN_EXCHANGE_FAILED',
      });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'instagram');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', 'TOKEN_EXCHANGE_FAILED');
      dest.searchParams.set('error', 'TOKEN_EXCHANGE_FAILED');
      return NextResponse.redirect(dest.toString());
    }

    // Granted Scope 사전 판정 (필수 게시 권한 누락 체크)
    const grantedScopesRaw = tokenData.permissions || tokenData.scope;
    if (grantedScopesRaw) {
      const grantedArray = Array.isArray(grantedScopesRaw)
        ? grantedScopesRaw
        : typeof grantedScopesRaw === 'string'
          ? grantedScopesRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [];
      if (grantedArray.length > 0) {
        const { normalizeInstagramScopes } = await import('@/features/channels/dual-channel-verification');
        const normalized = normalizeInstagramScopes(grantedArray);
        const hasPublish = normalized.includes('instagram_business_content_publish') || normalized.includes('instagram_content_publish');
        if (!hasPublish) {
          console.error('[Instagram Callback Scope Missing]:', { code: 'SCOPE_MISSING' });
          const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
          dest.searchParams.set('channel', 'instagram');
          dest.searchParams.set('connect', 'unavailable');
          dest.searchParams.set('connect_error', 'SCOPE_MISSING');
          dest.searchParams.set('error', 'SCOPE_MISSING');
          return NextResponse.redirect(dest.toString());
        }
      }
    }

    const shortLivedToken = tokenData.access_token;

    // 4. Long-lived Token Exchange (60일 토큰)
    const longTokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    longTokenUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longTokenUrl.searchParams.set('client_id', appId);
    longTokenUrl.searchParams.set('client_secret', appSecret);
    longTokenUrl.searchParams.set('fb_exchange_token', shortLivedToken);

    let finalAccessToken = shortLivedToken;
    let tokenExpiresIn = 60 * 24 * 60 * 60; // 60 days default

    try {
      const longRes = await fetch(longTokenUrl.toString(), { method: 'GET' });
      const longData = await longRes.json();
      if (longData.access_token) {
        finalAccessToken = longData.access_token;
        if (longData.expires_in) tokenExpiresIn = longData.expires_in;
      }
    } catch (err) {
      console.warn('[Instagram Long-lived token warning]:', err);
    }

    const tokenExpiresAt = new Date(Date.now() + tokenExpiresIn * 1000).toISOString();

    // 5. Discover Instagram Business Account via Facebook Pages
    const accountsUrl = `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&access_token=${finalAccessToken}`;
    const accountsRes = await fetch(accountsUrl);
    const accountsData = await accountsRes.json();

    let igAccountId: string | null = null;
    let igUsername: string | null = null;

    if (accountsData.data && Array.isArray(accountsData.data)) {
      for (const page of accountsData.data) {
        if (page.instagram_business_account?.id) {
          igAccountId = page.instagram_business_account.id;
          igUsername = page.instagram_business_account.username || page.instagram_business_account.name;
          break;
        }
      }
    }

    if (!igAccountId) {
      console.error('[Instagram Callback Error]:', { code: 'NO_INSTAGRAM_BUSINESS_ACCOUNT' });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'instagram');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', 'NO_INSTAGRAM_BUSINESS_ACCOUNT');
      dest.searchParams.set('error', 'NO_INSTAGRAM_BUSINESS_ACCOUNT');
      return NextResponse.redirect(dest.toString());
    }

    // 6. Cross-Tenant 바인딩 중복 차단 검증 (ANI-625)
    await assertNoCrossWorkspaceBinding(supabase, 'INSTAGRAM', igAccountId, workspaceId);

    // 7. Channel Connection Canonical Upsert (ANI-614, ANI-628)
    const { error: upsertErr } = await (supabase as any)
      .from('channel_connections')
      .upsert({
        workspace_id: workspaceId,
        channel: 'INSTAGRAM',
        status: 'connected',
        account_label: igUsername || igAccountId,
        provider_account_id: igAccountId,
        token_vault_ref: `vault:meta:${igAccountId}:${Date.now()}`,
        token_expires_at: tokenExpiresAt,
        last_refreshed_at: new Date().toISOString(),
        profile_metadata: {
          username: igUsername,
          pageId: accountsData.data?.[0]?.id,
          pageName: accountsData.data?.[0]?.name,
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
      console.error('[Instagram Upsert Connection Error]:', { code: errCode });
      const dest = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
      dest.searchParams.set('channel', 'instagram');
      dest.searchParams.set('connect', 'unavailable');
      dest.searchParams.set('connect_error', errCode);
      dest.searchParams.set('error', errCode);
      return NextResponse.redirect(dest.toString());
    }

    // Instagram Webhook 구독 등록 (best-effort)
    const webhookSubResult = await subscribeInstagramWebhooks({
      accessToken: finalAccessToken,
      igUserId: igAccountId,
    }).catch((subErr: unknown) => ({
      ok: false,
      reason: subErr instanceof Error ? subErr.message : 'UNEXPECTED_ERROR',
    }));
    console.warn('[webhook-subscribe]', {
      channel: 'instagram',
      ok: webhookSubResult.ok,
      reason: webhookSubResult.reason,
    });

    await grantConnectedSignupCredits(user.id, workspaceId);

    // 8. Autonomous Channel Consent Ledger 등록 (ANI-617)
    await (supabase as any)
      .from('channel_consents')
      .upsert([
        {
          workspace_id: workspaceId,
          channel: 'INSTAGRAM',
          consent_type: 'PUBLISH',
          is_granted: true,
          granted_at: new Date().toISOString()
        },
        {
          workspace_id: workspaceId,
          channel: 'INSTAGRAM',
          consent_type: 'COMMENT_DM',
          is_granted: true,
          granted_at: new Date().toISOString()
        }
      ], { onConflict: 'workspace_id,channel,consent_type' });

    // 9. Audit Event
    await (supabase as any).from('audit_events').insert({
      workspace_id: workspaceId,
      entity_type: 'channel_connection',
      entity_id: `INSTAGRAM:${igAccountId}`,
      event_type: 'oauth_connected',
      metadata: {
        channel: 'INSTAGRAM',
        username: igUsername,
        providerAccountId: igAccountId,
        expiresAt: tokenExpiresAt,
        correlationId: tx.correlationId
      }
    }).catch((e: any) => console.warn('[oauth callback] audit notice:', e));

    // 10. Post-OAuth Provider Capability Verification & Receipts (ANI-1429)
    await verifyPostOAuthChannelCapability({
      workspaceId,
      channel: 'instagram',
      accessToken: finalAccessToken,
      providerAccountId: igAccountId,
      accountLabel: igUsername || igAccountId,
    }).catch((e: any) => console.warn('[instagram callback] verification run notice:', e));

    const safePath = parseReturnPath(tx.returnPath || defaultReturnPath);
    const destination = new URL(safePath, appUrl);
    destination.searchParams.set('channel', 'instagram');
    destination.searchParams.set('status', 'connected');
    destination.searchParams.set('connect', 'authorized');
    destination.searchParams.set('account', igUsername || '');
    return NextResponse.redirect(destination.toString());

  } catch (err: any) {
    const msg = typeof err?.message === 'string' ? err.message : '';
    let errorCode = 'CONNECTION_SAVE_FAILED';
    if (msg.includes('DUPLICATE_BINDING') || msg.includes('이미 다른 매장') || msg.includes('다른 소희')) {
      errorCode = 'ACCOUNT_ALREADY_CONNECTED';
    } else if (msg.includes('SCOPE_MISSING') || msg.includes('content_publish') || msg.includes('권한이 누락')) {
      errorCode = 'SCOPE_MISSING';
    }
    console.error('[Instagram OAuth Callback Exception]:', { code: errorCode });
    const destination = new URL(parseReturnPath(tx?.returnPath || defaultReturnPath), appUrl);
    destination.searchParams.set('channel', 'instagram');
    destination.searchParams.set('connect', 'unavailable');
    destination.searchParams.set('connect_error', errorCode);
    destination.searchParams.set('error', errorCode);
    return NextResponse.redirect(destination.toString());
  }
}
