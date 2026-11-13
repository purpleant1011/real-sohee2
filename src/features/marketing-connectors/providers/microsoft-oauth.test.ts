import { describe, expect, it, vi } from 'vitest';
import {
  validateMicrosoftScopeRequest,
  MicrosoftPolicyViolationError,
  MICROSOFT_MAIL_READ_SCOPE,
  MICROSOFT_OFFLINE_ACCESS_SCOPE,
  buildMicrosoftAuthorizeUrl,
  exchangeMicrosoftAuthorizationCode,
  refreshMicrosoftAccessToken,
  type MicrosoftTokenResponse,
} from './microsoft-oauth';

describe('validateMicrosoftScopeRequest (Microsoft Graph Scope Gate)', () => {
  describe('Valid readonly requests', () => {
    it('allows https://graph.microsoft.com/Mail.Read and offline_access', () => {
      const result = validateMicrosoftScopeRequest([
        'https://graph.microsoft.com/Mail.Read',
        'offline_access',
      ]);
      expect(result).toEqual([
        MICROSOFT_MAIL_READ_SCOPE,
        MICROSOFT_OFFLINE_ACCESS_SCOPE,
      ]);
    });

    it('allows https://graph.microsoft.com/Mail.Read alone', () => {
      const result = validateMicrosoftScopeRequest([
        'https://graph.microsoft.com/Mail.Read',
      ]);
      expect(result).toEqual([MICROSOFT_MAIL_READ_SCOPE]);
    });

    it('normalizes Mail.Read to full Graph scope URI', () => {
      const result = validateMicrosoftScopeRequest([
        'Mail.Read',
        'offline_access',
      ]);
      expect(result).toEqual([
        MICROSOFT_MAIL_READ_SCOPE,
        MICROSOFT_OFFLINE_ACCESS_SCOPE,
      ]);
    });

    it('trims whitespace and deduplicates scopes', () => {
      const result = validateMicrosoftScopeRequest([
        '  https://graph.microsoft.com/Mail.Read  ',
        'offline_access',
        'https://graph.microsoft.com/Mail.Read',
      ]);
      expect(result).toEqual([
        MICROSOFT_MAIL_READ_SCOPE,
        MICROSOFT_OFFLINE_ACCESS_SCOPE,
      ]);
    });
  });

  describe('Missing or empty scope lists (MISSING_SCOPE)', () => {
    it('throws MISSING_SCOPE for empty array', () => {
      expect(() => validateMicrosoftScopeRequest([])).toThrow(
        MicrosoftPolicyViolationError
      );
      try {
        validateMicrosoftScopeRequest([]);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });

    it('throws MISSING_SCOPE for array with only empty/whitespace strings', () => {
      expect(() => validateMicrosoftScopeRequest(['', '   '])).toThrow(
        MicrosoftPolicyViolationError
      );
      try {
        validateMicrosoftScopeRequest(['', '   ']);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });

    it('throws MISSING_SCOPE for null or non-array input', () => {
      expect(() => validateMicrosoftScopeRequest(null as any)).toThrow(
        MicrosoftPolicyViolationError
      );
      expect(() => validateMicrosoftScopeRequest(undefined as any)).toThrow(
        MicrosoftPolicyViolationError
      );
    });

    it('throws MISSING_SCOPE when Mail.Read is missing from requested scopes', () => {
      expect(() => validateMicrosoftScopeRequest(['offline_access'])).toThrow(
        MicrosoftPolicyViolationError
      );
      try {
        validateMicrosoftScopeRequest(['offline_access']);
      } catch (err: any) {
        expect(err.code).toBe('MISSING_SCOPE');
      }
    });
  });

  describe('Prohibited scopes (PROHIBITED_SCOPE)', () => {
    const prohibitedScopes = [
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
      'User.ReadWrite',
      'Files.ReadWrite.All',
    ];

    prohibitedScopes.forEach((prohibitedScope) => {
      it(`rejects prohibited scope: ${prohibitedScope}`, () => {
        expect(() =>
          validateMicrosoftScopeRequest([
            'https://graph.microsoft.com/Mail.Read',
            prohibitedScope,
          ])
        ).toThrow(MicrosoftPolicyViolationError);

        try {
          validateMicrosoftScopeRequest([
            'https://graph.microsoft.com/Mail.Read',
            prohibitedScope,
          ]);
        } catch (err: any) {
          expect(err.code).toBe('PROHIBITED_SCOPE');
          expect(err.scope).toBe(prohibitedScope);
        }
      });
    });

    it('rejects prohibited scope when requested alone', () => {
      expect(() => validateMicrosoftScopeRequest(['Mail.Send'])).toThrow(
        MicrosoftPolicyViolationError
      );
      try {
        validateMicrosoftScopeRequest(['Mail.Send']);
      } catch (err: any) {
        expect(err.code).toBe('PROHIBITED_SCOPE');
        expect(err.scope).toBe('Mail.Send');
      }
    });
  });
});

describe('buildMicrosoftAuthorizeUrl', () => {
  it('builds authorize URL with common tenant by default', () => {
    const urlString = buildMicrosoftAuthorizeUrl({
      clientId: 'ms-client-123',
      redirectUri: 'http://localhost:3000/api/marketing-connectors/microsoft/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
    });

    const url = new URL(urlString);
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('ms-client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/marketing-connectors/microsoft/callback'
    );
    expect(url.searchParams.get('response_mode')).toBe('query');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(
      'https://graph.microsoft.com/Mail.Read offline_access'
    );
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('supports custom tenant ID and custom scopes', () => {
    const urlString = buildMicrosoftAuthorizeUrl({
      clientId: 'ms-client-123',
      redirectUri: 'http://localhost:3000/api/marketing-connectors/microsoft/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
      tenantId: 'my-tenant-id-456',
      scopes: ['https://graph.microsoft.com/Mail.Read'],
      prompt: 'select_account',
    });

    const url = new URL(urlString);
    expect(url.pathname).toBe('/my-tenant-id-456/oauth2/v2.0/authorize');
    expect(url.searchParams.get('scope')).toBe(
      'https://graph.microsoft.com/Mail.Read'
    );
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('exchangeMicrosoftAuthorizationCode', () => {
  it('calls token endpoint and returns parsed tokens', async () => {
    const mockResponse: MicrosoftTokenResponse = {
      token_type: 'Bearer',
      scope: 'https://graph.microsoft.com/Mail.Read offline_access',
      expires_in: 3600,
      access_token: 'ms-access-token-123',
      refresh_token: 'ms-refresh-token-456',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await exchangeMicrosoftAuthorizationCode({
      clientId: 'client-id-xyz',
      clientSecret: 'client-secret-xyz',
      code: 'auth-code-123',
      codeVerifier: 'verifier-456',
      redirectUri: 'http://localhost:3000/api/marketing-connectors/microsoft/callback',
      tenantId: 'common',
      fetchFn: fetchMock as any,
    });

    expect(result).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );

    const callBody = fetchMock.mock.calls[0][1].body;
    const bodyParams = new URLSearchParams(callBody);
    expect(bodyParams.get('client_id')).toBe('client-id-xyz');
    expect(bodyParams.get('client_secret')).toBe('client-secret-xyz');
    expect(bodyParams.get('code')).toBe('auth-code-123');
    expect(bodyParams.get('code_verifier')).toBe('verifier-456');
    expect(bodyParams.get('grant_type')).toBe('authorization_code');
    expect(bodyParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/marketing-connectors/microsoft/callback'
    );
  });

  it('throws error when token endpoint returns error status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Code expired' }),
    });

    await expect(
      exchangeMicrosoftAuthorizationCode({
        clientId: 'client-id-xyz',
        clientSecret: 'client-secret-xyz',
        code: 'auth-code-123',
        codeVerifier: 'verifier-456',
        redirectUri: 'http://localhost:3000/api/marketing-connectors/microsoft/callback',
        fetchFn: fetchMock as any,
      })
    ).rejects.toThrow('Microsoft token exchange failed (400)');
  });
});

describe('refreshMicrosoftAccessToken', () => {
  it('calls token endpoint with refresh_token grant and returns new tokens', async () => {
    const mockResponse: MicrosoftTokenResponse = {
      token_type: 'Bearer',
      scope: 'https://graph.microsoft.com/Mail.Read offline_access',
      expires_in: 3600,
      access_token: 'ms-refreshed-access-token',
      refresh_token: 'ms-new-refresh-token',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await refreshMicrosoftAccessToken({
      clientId: 'client-id-xyz',
      clientSecret: 'client-secret-xyz',
      refreshToken: 'current-refresh-token',
      tenantId: 'custom-tenant',
      fetchFn: fetchMock as any,
    });

    expect(result).toEqual(mockResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/custom-tenant/oauth2/v2.0/token',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const callBody = fetchMock.mock.calls[0][1].body;
    const bodyParams = new URLSearchParams(callBody);
    expect(bodyParams.get('client_id')).toBe('client-id-xyz');
    expect(bodyParams.get('client_secret')).toBe('client-secret-xyz');
    expect(bodyParams.get('refresh_token')).toBe('current-refresh-token');
    expect(bodyParams.get('grant_type')).toBe('refresh_token');
  });
});
