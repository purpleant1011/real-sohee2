import { describe, expect, it, vi } from 'vitest'
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getMetaOAuthScopes,
  getMetaRequiredScopes,
  MetaOAuthError,
  ScopeVerificationUnavailableError,
  toSafeMetaOAuthCallbackCode,
  type MetaOAuthFetch,
} from './meta-oauth'

const redirectUri = 'https://example.com/api/channels/instagram/callback'

describe('Meta channel OAuth contract', () => {
  it('builds channel-specific official authorization URLs and exact minimum scopes', () => {
    const instagram = createAuthorizationRequest('instagram', {
      appId: 'instagram-app', redirectUri, state: 'opaque-state',
    })
    const threads = createAuthorizationRequest('threads', {
      appId: 'threads-app', redirectUri: redirectUri.replace('instagram', 'threads'), state: 'opaque-state',
    })

    expect(instagram.toString()).toBe(
      'https://www.instagram.com/oauth/authorize?client_id=instagram-app&redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fchannels%2Finstagram%2Fcallback&response_type=code&scope=instagram_business_basic%2Cinstagram_business_content_publish&state=opaque-state&force_reauth=true',
    )
    expect(threads.toString()).toBe(
      'https://threads.net/oauth/authorize?client_id=threads-app&redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fchannels%2Fthreads%2Fcallback&response_type=code&scope=threads_basic%2Cthreads_content_publish&state=opaque-state',
    )
  })

  it('provides base and extended scope sets according to the extended flag', () => {
    // Default / false: publish only
    expect(getMetaOAuthScopes('instagram')).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ])
    expect(getMetaOAuthScopes('instagram', { extended: false })).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
    ])
    expect(getMetaOAuthScopes('threads')).toEqual([
      'threads_basic',
      'threads_content_publish',
    ])
    expect(getMetaOAuthScopes('threads', { extended: false })).toEqual([
      'threads_basic',
      'threads_content_publish',
    ])

    // Extended: publish + comments/DM/insights (Instagram) / + replies/insights (Threads)
    expect(getMetaOAuthScopes('instagram', { extended: true })).toEqual([
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
      'instagram_business_manage_insights',
    ])
    expect(getMetaOAuthScopes('threads', { extended: true })).toEqual([
      'threads_basic',
      'threads_content_publish',
      'threads_read_replies',
      'threads_manage_replies',
      'threads_manage_insights',
    ])

    // Authorization request includes extended scopes when extended: true is passed
    const igExtendedUrl = createAuthorizationRequest('instagram', {
      appId: 'instagram-app',
      redirectUri,
      state: 'opaque-state',
      extended: true,
    })
    expect(igExtendedUrl.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages,instagram_business_manage_insights',
    )

    const thExtendedUrl = createAuthorizationRequest('threads', {
      appId: 'threads-app',
      redirectUri: redirectUri.replace('instagram', 'threads'),
      state: 'opaque-state',
      extended: true,
    })
    expect(thExtendedUrl.searchParams.get('scope')).toBe(
      'threads_basic,threads_content_publish,threads_read_replies,threads_manage_replies,threads_manage_insights',
    )
  })

  it('records only first-post Threads scopes while retaining the separate reply requirement', () => {
    const scopes = getMetaOAuthScopes('threads')
    expect(scopes).toEqual(['threads_basic', 'threads_content_publish'])
    const authorization = createAuthorizationRequest('threads', {
      appId: 'threads-app', redirectUri, state: 'opaque-state',
    })
    expect(authorization.searchParams.get('scope')).toBe(scopes.join(','))
    expect(getMetaRequiredScopes('threads', 'read')).toEqual(['threads_basic'])
    expect(getMetaRequiredScopes('threads', 'publish')).toEqual(['threads_basic', 'threads_content_publish'])
    expect(getMetaRequiredScopes('threads', 'reply')).toEqual([
      'threads_basic', 'threads_content_publish', 'threads_manage_replies',
    ])
  })

  it('exchanges an Instagram code, upgrades the token, and reads the connected account without exposing tokens', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'short-secret-token', user_id: 11,
        permissions: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_comments',
          'instagram_business_manage_messages',
          'instagram_business_manage_insights',
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-secret-token', token_type: 'bearer', expires_in: 5_183_944 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: '1789001', username: 'sohee.ai' }), { status: 200 }))

    await expect(exchangeAuthorizationCode('instagram', {
      appId: 'instagram-app', appSecret: 'instagram-secret', code: 'single-use-code', redirectUri,
    }, fetcher)).resolves.toEqual({
      accessToken: 'long-secret-token', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      expiresInSeconds: 5_183_944,
      grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_messages', 'instagram_business_manage_insights'],
    })

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.instagram.com/oauth/access_token')
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://graph.instagram.com/v21.0/me?fields=id,user_id,username,name,account_type')
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('authorization')).toBe('Bearer long-secret-token')
  })

  it('uses professional user_id as externalAccountId when present in profile response', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'short-secret-token', user_id: 11,
        permissions: ['instagram_business_basic', 'instagram_business_content_publish'],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-secret-token', token_type: 'bearer', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'app-scoped-99', user_id: 'prof-user-12345', username: 'mybiz' }), { status: 200 }))

    const result = await exchangeAuthorizationCode('instagram', {
      appId: 'instagram-app', appSecret: 'instagram-secret', code: 'single-use-code', redirectUri,
    }, fetcher)

    expect(result.externalAccountId).toBe('prof-user-12345')
    expect(result.accountLabel).toBe('@mybiz')
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://graph.instagram.com/v21.0/me?fields=id,user_id,username,name,account_type')
  })

  it('uses Threads token hosts and converts malformed provider responses to a secret-free stable error', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'threads-short-token', user_id: 22, scope: 'threads_basic' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'threads-long-token', token_type: 'bearer', expires_in: 5_183_944 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: null, username: 'sohee.ai' }), { status: 200 }))

    const promise = exchangeAuthorizationCode('threads', {
      appId: 'threads-app', appSecret: 'threads-secret', code: 'single-use-code',
      redirectUri: redirectUri.replace('instagram', 'threads'),
    }, fetcher)
    await expect(promise).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', stage: 'profile_lookup' })
    await expect(promise).rejects.not.toThrow(/threads-(short|long)-token|single-use-code/u)
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://graph.threads.net/oauth/access_token')
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST')
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(URLSearchParams)
    expect(fetcher.mock.calls[2]?.[0]).toBe('https://graph.threads.net/v1.0/me?fields=id%2Cusername')
  })

  it.each(['instagram', 'threads'] as const)('preserves a read-only %s grant without inventing publish permission', async (channel) => {
    const basic = channel === 'instagram' ? 'instagram_business_basic' : 'threads_basic'
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'short-secret-token', user_id: 11, permissions: basic,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'long-secret-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user_id: '11', id: '11', username: 'read-only' }), { status: 200 }))
    await expect(exchangeAuthorizationCode(channel, {
      appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
    }, fetcher)).resolves.toMatchObject({ grantedScopes: [basic] })
  })

  it('fails closed without instagram scope evidence', async () => {
    for (const permissions of [undefined, [], {}, ['unrelated_scope']]) {
      const fetcher = vi.fn<MetaOAuthFetch>().mockResolvedValue(new Response(JSON.stringify({
        access_token: 'short-secret-token', user_id: 11, permissions,
      }), { status: 200 }))
      await expect(exchangeAuthorizationCode('instagram', {
        appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
      }, fetcher)).rejects.toMatchObject({ code: 'SCOPE_MISSING' })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })

  it('fails closed with SCOPE_VERIFICATION_UNAVAILABLE when Threads authoritative source is unreachable or invalid', async () => {
    // Case 1: debug_token fetch throws or returns 500
    const failingFetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-token', user_id: 11,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    await expect(exchangeAuthorizationCode('threads', {
      appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
    }, failingFetcher)).rejects.toMatchObject({ code: 'SCOPE_VERIFICATION_UNAVAILABLE' })

    // Case 2: debug_token returns payload with is_valid: false or missing scopes
    const invalidFetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-token', user_id: 11,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { is_valid: false },
      }), { status: 200 }))

    await expect(exchangeAuthorizationCode('threads', {
      appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
    }, invalidFetcher)).rejects.toMatchObject({ code: 'SCOPE_VERIFICATION_UNAVAILABLE' })
  })

  it('fails closed with SCOPE_MISSING when Threads authoritative scopes lack required read scope', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-token', user_id: 11,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          is_valid: true,
          scopes: ['threads_content_publish'], // missing threads_basic
        },
      }), { status: 200 }))

    await expect(exchangeAuthorizationCode('threads', {
      appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
    }, fetcher)).rejects.toMatchObject({ code: 'SCOPE_MISSING' })
  })

  it('succeeds with partial grant when user declines optional scopes but grants required publish scopes', async () => {
    // User was asked for extended scopes, but unchecked replies/insights in consent dialog
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-short-token',
        token_type: 'bearer',
        user_id: 'th-user-456',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          is_valid: true,
          scopes: ['threads_basic', 'threads_content_publish'], // only publish scopes
          user_id: 'th-user-456',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-long-token',
        token_type: 'bearer',
        expires_in: 5_183_944,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'th-user-456',
        username: 'my_cafe',
      }), { status: 200 }))

    const result = await exchangeAuthorizationCode('threads', {
      appId: 'threads-app-id',
      appSecret: 'threads-app-secret',
      code: 'code-123',
      redirectUri: 'https://example.com/api/channels/threads/callback',
    }, fetcher)

    expect(result.grantedScopes).toEqual(['threads_basic', 'threads_content_publish'])
    expect(result.accountLabel).toBe('@my_cafe')
  })

  it('fails closed on OAuth 429 without proceeding to profile or persistence', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>().mockResolvedValue(new Response('{}', { status: 429 }))
    await expect(exchangeAuthorizationCode('threads', {
      appId: 'app', appSecret: 'secret', code: 'code', redirectUri,
    }, fetcher)).rejects.toMatchObject({ code: 'TEMPORARY_UNAVAILABLE' })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('classifies non-2xx token responses without returning provider bodies', async () => {
    const fetcher = vi.fn<MetaOAuthFetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: {
        message: 'token value leaked by provider', code: 190, error_subcode: 123456,
      } }), { status: 401 }),
    )
    const promise = exchangeAuthorizationCode('instagram', {
      appId: 'instagram-app', appSecret: 'instagram-secret', code: 'single-use-code', redirectUri,
    }, fetcher)
    await expect(promise).rejects.toBeInstanceOf(MetaOAuthError)
    await expect(promise).rejects.toMatchObject({
      code: 'AUTHORIZATION_REJECTED',
      stage: 'token_exchange',
      diagnosticCode: 'META_HTTP_401_C190_S123456',
    })
    await expect(promise).rejects.not.toThrow('token value leaked by provider')
  })

  it('maps provider and persistence failures to fixed secret-free callback codes', () => {
    expect(toSafeMetaOAuthCallbackCode(
      new MetaOAuthError('INVALID_PROVIDER_RESPONSE', 'token_exchange'),
      'META_OAUTH_INTERNAL',
    )).toBe('META_OAUTH_TOKEN_EXCHANGE')
    expect(toSafeMetaOAuthCallbackCode(
      new MetaOAuthError('AUTHORIZATION_REJECTED', 'profile_lookup'),
      'META_OAUTH_INTERNAL',
    )).toBe('META_OAUTH_ACCOUNT_LOOKUP')
    expect(toSafeMetaOAuthCallbackCode(
      new Error('database error containing a credential'),
      'META_OAUTH_PERSISTENCE',
    )).toBe('META_OAUTH_PERSISTENCE')
    expect(toSafeMetaOAuthCallbackCode(
      new ScopeVerificationUnavailableError(),
      'META_OAUTH_INTERNAL',
    )).toBe('SCOPE_VERIFICATION_UNAVAILABLE')
  })

  it('determines Threads granted scopes from debug_token endpoint when token response lacks scopes', async () => {
    // Official Threads token exchange response: only access_token, token_type, and user_id (no scope)
    const fetcher = vi.fn<MetaOAuthFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-short-token',
        token_type: 'bearer',
        user_id: 'th-user-123',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          is_valid: true,
          scopes: ['threads_basic', 'threads_content_publish'],
          user_id: 'th-user-123',
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'th-long-token',
        token_type: 'bearer',
        expires_in: 5_183_944,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'th-user-123',
        username: 'sohee_official',
      }), { status: 200 }))

    const result = await exchangeAuthorizationCode('threads', {
      appId: 'threads-app-id',
      appSecret: 'threads-app-secret',
      code: 'valid-oauth-code',
      redirectUri: 'https://example.com/api/channels/threads/callback',
    }, fetcher)

    expect(result).toEqual({
      accessToken: 'th-long-token',
      externalAccountId: 'th-user-123',
      accountLabel: '@sohee_official',
      expiresInSeconds: 5_183_944,
      grantedScopes: ['threads_basic', 'threads_content_publish'],
    })
    expect(fetcher.mock.calls[1]?.[0]).toContain('https://graph.threads.net/v1.0/debug_token')
  })
})
