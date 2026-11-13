export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import {
  consumeMarketingOAuthTransaction,
  createSupabaseOAuthTransactionGateway,
  hashOAuthState,
  OAuthTransactionError,
} from '@/features/marketing-connectors/oauth/oauth-transaction';
import {
  saveConnectorCredential,
  type CredentialVaultGateway,
  type StoredCredentialRecord,
  type EncryptedToken,
} from '@/features/marketing-connectors/credentials/credential-vault';
import type { ConnectorId } from '@/features/marketing-connectors/catalog';

export class DefaultCredentialVaultGateway implements CredentialVaultGateway {
  private static store = new Map<string, StoredCredentialRecord>();

  async getCredential(
    workspaceId: string,
    connectorId: ConnectorId
  ): Promise<StoredCredentialRecord | null> {
    return (
      DefaultCredentialVaultGateway.store.get(
        `${workspaceId}:${connectorId}`
      ) ?? null
    );
  }

  async saveCredential(record: StoredCredentialRecord): Promise<void> {
    DefaultCredentialVaultGateway.store.set(
      `${record.workspaceId}:${record.connectorId}`,
      record
    );
  }

  async updateCredentialTokens(params: {
    workspaceId: string;
    connectorId: ConnectorId;
    encryptedAccessToken: EncryptedToken;
    encryptedRefreshToken: EncryptedToken | null;
    expiresAt: string | null;
    updatedAt: string;
  }): Promise<void> {
    const key = `${params.workspaceId}:${params.connectorId}`;
    const existing = DefaultCredentialVaultGateway.store.get(key);
    if (existing) {
      DefaultCredentialVaultGateway.store.set(key, {
        ...existing,
        encryptedAccessToken: params.encryptedAccessToken,
        encryptedRefreshToken: params.encryptedRefreshToken,
        expiresAt: params.expiresAt,
        updatedAt: params.updatedAt,
      });
    }
  }
}

const defaultVaultGateway = new DefaultCredentialVaultGateway();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://example.com';
  const cleanAppUrl = appUrl.trim().replace(/\/+$/, '');

  function redirectWithError(errorCode: string): NextResponse {
    const dest = new URL('/app/connectors', cleanAppUrl);
    dest.searchParams.set('error', errorCode);
    return NextResponse.redirect(dest);
  }

  // 1. Google OAuth 거부/취소 파라미터 방어
  if (error) {
    return redirectWithError(error);
  }

  // 2. 필수 code, state 파라미터 검증
  if (!code || !state) {
    return redirectWithError('INVALID_REQUEST');
  }

  try {
    // 3. 현재 세션 사용자 확인
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return redirectWithError('AUTH_REQUIRED');
    }

    // 4. State 해시 대조 및 트랜잭션 조회
    const adminSupabase = createAdminSupabaseClient();
    const oauthGateway = createSupabaseOAuthTransactionGateway(
      adminSupabase as any
    );
    const stateHash = hashOAuthState(state);
    const txRecord = await oauthGateway.findByStateHash(stateHash);

    if (!txRecord) {
      return redirectWithError('TRANSACTION_NOT_FOUND');
    }

    // 5. 테넌트 및 세션 사용자 일치 검증
    if (txRecord.userId !== user.id) {
      return redirectWithError('TENANT_MISMATCH');
    }

    // 6. 대상 워크스페이스 내 active owner/manager 권한 검증
    const { data: memberData, error: memberError } = await (supabase as any)
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', txRecord.workspaceId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (
      memberError ||
      !memberData ||
      memberData.status !== 'active' ||
      (memberData.role !== 'owner' && memberData.role !== 'manager')
    ) {
      return redirectWithError('FORBIDDEN');
    }

    // 7. F02 OAuth 트랜잭션 원자적 단일 소비 (재전송 및 만료 방어)
    let consumed;
    try {
      consumed = await consumeMarketingOAuthTransaction(
        state,
        { workspaceId: txRecord.workspaceId, userId: user.id },
        oauthGateway
      );
    } catch (consumeErr: any) {
      const errCode =
        consumeErr instanceof OAuthTransactionError
          ? consumeErr.code
          : 'CONSUME_FAILED';
      return redirectWithError(errCode);
    }

    // 8. Google OAuth 환경변수 확인
    const clientId = process.env.MARKETING_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.MARKETING_GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return redirectWithError('SERVER_MISCONFIGURED');
    }

    // 9. Google Token Endpoint 호출 (PKCE code_verifier 포함)
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: consumed.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: consumed.redirectUri,
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      return redirectWithError('TOKEN_EXCHANGE_FAILED');
    }

    const tokenData = await tokenRes.json();
    if (!tokenData || !tokenData.access_token) {
      return redirectWithError('TOKEN_EXCHANGE_FAILED');
    }

    // 10. 만료 시각 및 granted scopes 산출
    const expiresIn =
      typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const scopes: string[] = tokenData.scope
      ? typeof tokenData.scope === 'string'
        ? tokenData.scope.split(' ')
        : tokenData.scope
      : ['https://www.googleapis.com/auth/calendar.events.readonly'];

    // 11. 현재 커넥션 동의 세대(consent_generation) 조회
    const { data: existingConn } = await (adminSupabase as any)
      .from('marketing_connector_connections')
      .select('consent_generation')
      .eq('workspace_id', consumed.workspaceId)
      .eq('connector_id', 'google_calendar')
      .maybeSingle();

    const generation = existingConn?.consent_generation ?? 1;

    // 12. F03 Token Vault에 AES-GCM-256 암호화 저장
    await saveConnectorCredential(
      {
        workspaceId: consumed.workspaceId,
        connectorId: 'google_calendar',
        consentGeneration: generation,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        expiresAt,
        grantedScopes: scopes,
      },
      defaultVaultGateway
    );

    // 13. marketing_connector_connections 원장에 연결 상태 갱신
    const { error: upsertError } = await (adminSupabase as any)
      .from('marketing_connector_connections')
      .upsert(
        {
          workspace_id: consumed.workspaceId,
          connector_id: 'google_calendar',
          status: 'connected',
          consent_generation: generation,
          encrypted_credential_ref: `vault:google_calendar:${generation}`,
          capabilities: ['calendar_events_read'],
          metadata: {
            provider: 'google',
            connectedAt: new Date().toISOString(),
            scopes,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,connector_id' }
      );

    if (upsertError) {
      return redirectWithError('CONNECTION_SAVE_FAILED');
    }

    // 14. 연동 완료 안전 리다이렉트
    const successUrl = new URL('/app/connectors', cleanAppUrl);
    successUrl.searchParams.set('connected', 'google_calendar');
    return NextResponse.redirect(successUrl);
  } catch {
    return redirectWithError('CONNECTION_SAVE_FAILED');
  }
}
