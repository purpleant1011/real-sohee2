/**
 * Microsoft Graph Outlook OAuth 및 권한 정책 게이트 (ANI-2167 / MC-O01)
 *
 * Microsoft identity platform v2.0 보안 원칙:
 * 1. 발송/삭제/쓰기 등 비인가 scope (Mail.Send, Mail.ReadWrite, MailboxSettings 등) 원천 차단
 * 2. 오직 delegated 읽기 전용 scope (https://graph.microsoft.com/Mail.Read) 및 offline_access 만 허용
 * 3. 빈 scope 또는 비인가 scope 요청 시 fail-closed 예외 송출
 * 4. PKCE S256 및 tenant 기반 토큰 교환/갱신 계약 준수
 */

export const MICROSOFT_MAIL_READ_SCOPE =
  'https://graph.microsoft.com/Mail.Read' as const;

export const MICROSOFT_OFFLINE_ACCESS_SCOPE = 'offline_access' as const;

export const ALLOWED_MICROSOFT_SCOPES = [
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_OFFLINE_ACCESS_SCOPE,
] as const;

export const PROHIBITED_MICROSOFT_SCOPES = [
  'Mail.Send',
  'https://graph.microsoft.com/Mail.Send',
  'Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'MailboxSettings.ReadWrite',
  'https://graph.microsoft.com/MailboxSettings.ReadWrite',
  'Mail.ReadWrite.Shared',
  'https://graph.microsoft.com/Mail.ReadWrite.Shared',
  'Mail.Send.Shared',
  'https://graph.microsoft.com/Mail.Send.Shared',
  'MailboxSettings.Read',
  'https://graph.microsoft.com/MailboxSettings.Read',
] as const;

export type MicrosoftPolicyErrorCode = 'MISSING_SCOPE' | 'PROHIBITED_SCOPE';

export class MicrosoftPolicyViolationError extends Error {
  readonly code: MicrosoftPolicyErrorCode;
  readonly scope?: string;

  constructor(code: MicrosoftPolicyErrorCode, message: string, scope?: string) {
    super(message);
    this.name = 'MicrosoftPolicyViolationError';
    this.code = code;
    this.scope = scope;
  }
}

/**
 * 요청된 Microsoft Graph OAuth scope 목록을 검증하여 읽기 전용 scope만 엄격히 허용합니다.
 */
export function validateMicrosoftScopeRequest(
  requestedScopes: readonly string[]
): readonly string[] {
  if (!requestedScopes || !Array.isArray(requestedScopes) || requestedScopes.length === 0) {
    throw new MicrosoftPolicyViolationError(
      'MISSING_SCOPE',
      '요청된 Microsoft OAuth scope 목록이 비어 있습니다.'
    );
  }

  const cleanedScopes = requestedScopes
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);

  if (cleanedScopes.length === 0) {
    throw new MicrosoftPolicyViolationError(
      'MISSING_SCOPE',
      '유효한 Microsoft OAuth scope가 제공되지 않았습니다.'
    );
  }

  const normalizedScopes: string[] = [];

  for (const rawScope of cleanedScopes) {
    // Mail.Read 축약형 정규화
    let scope = rawScope;
    if (scope === 'Mail.Read') {
      scope = MICROSOFT_MAIL_READ_SCOPE;
    }

    if (!ALLOWED_MICROSOFT_SCOPES.includes(scope as any)) {
      throw new MicrosoftPolicyViolationError(
        'PROHIBITED_SCOPE',
        `비인가 또는 쓰기 권한이 포함된 Microsoft Graph scope는 허용되지 않습니다: ${rawScope}`,
        rawScope
      );
    }

    if (!normalizedScopes.includes(scope)) {
      normalizedScopes.push(scope);
    }
  }

  if (!normalizedScopes.includes(MICROSOFT_MAIL_READ_SCOPE)) {
    throw new MicrosoftPolicyViolationError(
      'MISSING_SCOPE',
      '필수 읽기 권한(https://graph.microsoft.com/Mail.Read)이 누락되었습니다.'
    );
  }

  return Object.freeze(normalizedScopes);
}

export type BuildMicrosoftAuthorizeUrlParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
  tenantId?: string;
  prompt?: string;
};

/**
 * Microsoft identity platform v2.0 Authorize URL 구성
 */
export function buildMicrosoftAuthorizeUrl(
  params: BuildMicrosoftAuthorizeUrlParams
): string {
  const tenant = params.tenantId?.trim() || 'common';
  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
  );

  const scopeString =
    params.scopes && params.scopes.length > 0
      ? params.scopes.join(' ')
      : `${MICROSOFT_MAIL_READ_SCOPE} ${MICROSOFT_OFFLINE_ACCESS_SCOPE}`;

  authorizeUrl.searchParams.set('client_id', params.clientId.trim());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('redirect_uri', params.redirectUri);
  authorizeUrl.searchParams.set('response_mode', 'query');
  authorizeUrl.searchParams.set('scope', scopeString);
  authorizeUrl.searchParams.set('state', params.state);
  authorizeUrl.searchParams.set('code_challenge', params.codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('prompt', params.prompt ?? 'consent');

  return authorizeUrl.toString();
}

export type MicrosoftTokenResponse = {
  token_type: string;
  scope: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  ext_expires_in?: number;
  id_token?: string;
};

export type ExchangeMicrosoftCodeParams = {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tenantId?: string;
  fetchFn?: typeof fetch;
};

/**
 * Microsoft v2.0 token endpoint에 authorization_code 교환 요청
 */
export async function exchangeMicrosoftAuthorizationCode(
  params: ExchangeMicrosoftCodeParams
): Promise<MicrosoftTokenResponse> {
  const tenant = params.tenantId?.trim() || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const bodyParams = new URLSearchParams({
    client_id: params.clientId.trim(),
    client_secret: params.clientSecret.trim(),
    code: params.code.trim(),
    code_verifier: params.codeVerifier.trim(),
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri.trim(),
  });

  const fetcher = params.fetchFn ?? fetch;
  const res = await fetcher(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  });

  if (!res.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson.error_description || errJson.error || '';
    } catch {
      // ignore
    }
    throw new Error(
      `Microsoft token exchange failed (${res.status})${errDetail ? `: ${errDetail}` : ''}`
    );
  }

  const tokenData = (await res.json()) as MicrosoftTokenResponse;
  return tokenData;
}

export type RefreshMicrosoftTokenParams = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tenantId?: string;
  scopes?: readonly string[];
  fetchFn?: typeof fetch;
};

/**
 * Microsoft v2.0 token endpoint에 refresh_token 기반 갱신 요청
 */
export async function refreshMicrosoftAccessToken(
  params: RefreshMicrosoftTokenParams
): Promise<MicrosoftTokenResponse> {
  const tenant = params.tenantId?.trim() || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const bodyParams = new URLSearchParams({
    client_id: params.clientId.trim(),
    client_secret: params.clientSecret.trim(),
    refresh_token: params.refreshToken.trim(),
    grant_type: 'refresh_token',
  });

  if (params.scopes && params.scopes.length > 0) {
    bodyParams.set('scope', params.scopes.join(' '));
  }

  const fetcher = params.fetchFn ?? fetch;
  const res = await fetcher(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  });

  if (!res.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson.error_description || errJson.error || '';
    } catch {
      // ignore
    }
    throw new Error(
      `Microsoft token refresh failed (${res.status})${errDetail ? `: ${errDetail}` : ''}`
    );
  }

  const tokenData = (await res.json()) as MicrosoftTokenResponse;
  return tokenData;
}
