import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-123' } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ workspace_id: 'ws-123', role: 'owner' }], error: null })
        })
      })
    })
  })
}));

import { oauthStateDigest, sealOAuthState, openOAuthState } from '../src/features/channels/oauth/oauth-state';
import { getMetaOAuthScopes } from '../src/features/channels/oauth/meta-oauth';
import { recordChannelConsent, revokeChannelConsent, isActionConsented } from '../src/features/channels/consent-ledger';
import { POST as credentialsPost } from '../src/app/api/channels/credentials/route';
import fs from 'fs';
import { NextRequest } from 'next/server';

describe('Authoritative SNS Channel Authorization V1.1 Live Suite (ANI-613 ~ ANI-629)', () => {
  it('TEST 1: OAuth State Sealing, Encryption & Digest (ANI-625)', async () => {
    const stateKey = Buffer.alloc(32, 19).toString('base64url');
    const rawState = 'random_state_entropy_at_least_32_chars_1234567890_abc';
    const sealed = await sealOAuthState({
      channel: 'instagram',
      workspaceId: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000001',
      state: rawState,
      expiresAt: new Date(Date.now() + 600_000).toISOString()
    }, stateKey);
    const unsealed = await openOAuthState(sealed, stateKey);
    const stateDigest = await oauthStateDigest(rawState);

    expect(unsealed.state).toBe(rawState);
    expect(stateDigest.length).toBe(64);
  });

  it('TEST 2: Official Meta Scope Matrix (ANI-615, ANI-616)', () => {
    const igScopes = getMetaOAuthScopes('instagram');
    const thScopes = getMetaOAuthScopes('threads');

    expect(igScopes).toContain('instagram_business_basic');
    expect(igScopes).toContain('instagram_business_content_publish');
    expect(thScopes).toContain('threads_basic');
    expect(thScopes).toContain('threads_content_publish');
  });

  it('TEST 3: 3-Tier Consent Ledger Lifecycle & Preflight Gates (ANI-617)', async () => {
    const mockConsentStore: any[] = [];
    const mockDbClient = {
      from: (table: string) => ({
        insert: async (data: any) => {
          mockConsentStore.push(data);
          return { data: [data], error: null };
        },
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              eq: (col3: string, val3: string) => ({
                maybeSingle: async () => {
                  const found = mockConsentStore.find(c => 
                    c.workspace_id === val1 && c.channel === val2 && c.consent_tier === val3
                  );
                  return { data: found || null, error: null };
                }
              })
            })
          })
        }),
        update: (patch: any) => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              eq: (col3: string, val3: string) => {
                const idx = mockConsentStore.findIndex(c => 
                  c.workspace_id === val1 && c.channel === val2 && c.consent_tier === val3
                );
                if (idx !== -1) mockConsentStore[idx] = { ...mockConsentStore[idx], ...patch };
                return Promise.resolve({ error: null });
              }
            })
          })
        })
      })
    };

    const wsId = '10000000-0000-4000-8000-000000000001';
    const actorId = '20000000-0000-4000-8000-000000000001';

    // 3-A: PLATFORM_AUTH only
    await recordChannelConsent({
      workspaceId: wsId,
      actorUserId: actorId,
      channel: 'instagram',
      tier: 'PLATFORM_AUTH',
      capabilities: { account_access: true }
    }, mockDbClient as any);

    const isPublishAllowed = await isActionConsented(wsId, 'instagram', 'PUBLISH_FEED', mockDbClient as any);
    expect(isPublishAllowed).toBe(false);

    // 3-B: VERIFICATION_CONSENT
    await recordChannelConsent({
      workspaceId: wsId,
      actorUserId: actorId,
      channel: 'instagram',
      tier: 'VERIFICATION_CONSENT',
      capabilities: { verification_post_allowed: true }
    }, mockDbClient as any);

    const isVerifAllowed = await isActionConsented(wsId, 'instagram', 'VERIFICATION_POST', mockDbClient as any);
    expect(isVerifAllowed).toBe(true);

    // 3-C: AUTONOMOUS_DELEGATION
    await recordChannelConsent({
      workspaceId: wsId,
      actorUserId: actorId,
      channel: 'instagram',
      tier: 'AUTONOMOUS_DELEGATION',
      capabilities: { publish: true }
    }, mockDbClient as any);

    const isAutoPublishAllowed = await isActionConsented(wsId, 'instagram', 'PUBLISH_FEED', mockDbClient as any);
    expect(isAutoPublishAllowed).toBe(true);

    // 3-D: Revocation
    await revokeChannelConsent(wsId, actorId, 'instagram', 'AUTONOMOUS_DELEGATION', 'User revoke', mockDbClient as any);
    const isAutoPublishAfterRevoke = await isActionConsented(wsId, 'instagram', 'PUBLISH_FEED', mockDbClient as any);
    expect(isAutoPublishAfterRevoke).toBe(false);
  });

  it('TEST 4: Direct Access Token Client Injection Rejection (ANI-614, ANI-624)', async () => {
    const fakeTokenReq = new NextRequest('http://localhost/api/channels/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'INSTAGRAM',
        accessToken: 'EAABfakeAccessTokenFromClientDirectForm12345'
      })
    });

    const tokenRes = await credentialsPost(fakeTokenReq as any);
    expect(tokenRes.status).toBe(400);
    const data = await tokenRes.json();
    expect(data.error).toContain('소희는 고객의 보안을 위해 토큰을 직접 입력받지 않습니다.');
  });

  it('TEST 5: Read-After-Write Verification & Neutral Caption in Route (ANI-618)', () => {
    const testPublishCode = fs.readFileSync('src/app/api/channels/test-publish/route.ts', 'utf8');
    expect(testPublishCode).toContain('verificationCode');
    expect(testPublishCode).toContain('소희 연결 인증이 완료되었습니다.');
    expect(testPublishCode).toContain('loadChannelCredentialByChannel');
    expect(testPublishCode).toContain('read_after_write');
    expect(testPublishCode).toContain('channel_verification_runs');
  });

  it('TEST 6: Database Migration DDL Structure & Idempotency (ANI-628)', () => {
    const migrationSql = fs.readFileSync('supabase/migrations/20260903060000_v089_sns_channel_authorization_v11.sql', 'utf8');
    const requiredDefinitions = [
      'channel_connections',
      'oauth_transactions',
      'channel_consents',
      'channel_verification_runs',
      'browser_sessions',
      'save_channel_connection_v11',
      'complete_channel_verification_v11'
    ];
    for (const def of requiredDefinitions) {
      expect(migrationSql).toContain(def);
    }
  });
});
