import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const adminMocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: () => adminMocks }))

import { loadChannelCredential, loadChannelCredentialByChannel, saveConnectedChannel } from './credential-repository'
import { ScopeMissingError, DuplicateBindingError } from './oauth/meta-oauth'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const connectionId = '30000000-0000-4000-8000-000000000001'
const key = Buffer.alloc(32, 21).toString('base64url')

describe('channel credential repository', () => {
  beforeEach(() => {
    adminMocks.rpc.mockReset()
    adminMocks.from.mockReset()
  })

  it('reads basic-only credentials through the scoped production fallback and rejects writes', async () => {
    const saveRpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'read-only-production-token', grantedScopes: ['threads_basic'], expiresAt: null, refreshAfter: null,
    }, { rpc: saveRpc }, key)
    const saved = saveRpc.mock.calls[0]![1]
    adminMocks.rpc.mockResolvedValue({ data: [], error: null })
    const queries: Record<string, any> = {}
    adminMocks.from.mockImplementation((table: string) => {
      const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn().mockResolvedValue({
        data: table === 'channel_connections' ? { id: connectionId, external_account_id: '1789001', status: 'authorized' } : {
          workspace_id: workspaceId, channel_connection_id: connectionId, provider: 'threads',
          encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
          encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null, granted_scopes: ['threads_basic'],
        }, error: null,
      }) }
      queries[table] = query
      return query
    })
    await expect(loadChannelCredentialByChannel(workspaceId, 'threads', undefined, key, 'read'))
      .resolves.toMatchObject({ accessToken: 'read-only-production-token', externalAccountId: '1789001' })
    expect(queries.meta_channel_credentials.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(queries.meta_channel_credentials.eq).toHaveBeenCalledWith('channel_connection_id', connectionId)
    expect(queries.channel_connections.eq).toHaveBeenCalledWith('workspace_id', workspaceId)
    expect(queries.channel_connections.eq).toHaveBeenCalledWith('channel', 'threads')
    await expect(loadChannelCredentialByChannel(workspaceId, 'threads', undefined, key)).rejects.toThrow()
  })

  it.each([
    { data: [], error: { code: '08006' } },
    { data: null, error: null },
    { data: [{}], error: null },
  ])('does not fall back after an RPC error or malformed result %j', async (result) => {
    adminMocks.rpc.mockResolvedValue(result)
    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', undefined, key)).rejects.toThrow()
    expect(adminMocks.from).not.toHaveBeenCalled()
  })

  it('rejects a connection-account mismatch before returning an otherwise valid credential', async () => {
    const saveRpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: 'old-account', accountLabel: '@sohee.ai',
      accessToken: 'previous-account-token', grantedScopes: ['threads_basic', 'threads_content_publish'], expiresAt: null, refreshAfter: null,
    }, { rpc: saveRpc }, key)
    const saved = saveRpc.mock.calls[0]![1]
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({
      data: { id: connectionId, external_account_id: 'new-account', status: 'connected' }, error: null,
    }) }
    adminMocks.from.mockReturnValue(query)
    const rpc = vi.fn().mockResolvedValue({ data: [{
      workspace_id: workspaceId, connection_id: connectionId, provider: 'threads', external_account_id: 'old-account',
      encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null,
      granted_scopes: ['threads_basic', 'threads_content_publish'],
    }], error: null })
    await expect(loadChannelCredentialByChannel(workspaceId, 'threads', { rpc }, key)).rejects.toThrow('채널 계정이 변경되었습니다.')
  })

  it('never falls back to non-atomic writes when production credential persistence fails', async () => {
    adminMocks.rpc.mockResolvedValue({ data: null, error: { message: 'membership check failed' } })
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'instagram', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      expiresAt: null, refreshAfter: null,
    }, undefined, key)).rejects.toThrow('채널 연결 정보를 저장하지 못했습니다.')
    expect(adminMocks.from).not.toHaveBeenCalled()
  })

  it('encrypts a token and persists only ciphertext through the atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'manager',
      channel: 'instagram', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      expiresAt: '2026-10-12T04:00:00.000Z', refreshAfter: '2026-09-12T04:00:00.000Z',
    }, { rpc }, key)).resolves.toEqual({ connectionId })

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(rpc.mock.calls[0]?.[0]).toBe('save_meta_channel_connection')
    expect(args.p_encrypted_access_token).not.toBe('provider-access-token')
    expect(JSON.stringify(args)).not.toContain('provider-access-token')
    expect(args).toMatchObject({ p_workspace_id: workspaceId, p_provider: 'instagram', p_external_account_id: '1789001' })
  })

  it('rejects non-operators before persisting', async () => {
    const rpc = vi.fn()
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'reviewer',
      channel: 'instagram', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: ['instagram_business_basic', 'instagram_business_content_publish'],
      expiresAt: null, refreshAfter: null,
    }, { rpc }, key)).rejects.toThrow('채널을 연결할 권한이 없습니다.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('stores and reads a basic-only connection but refuses publishing with that credential', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: ['threads_basic'],
      expiresAt: null, refreshAfter: null,
    }, { rpc }, key)).resolves.toEqual({ connectionId })
    const saved = rpc.mock.calls[0]![1]
    rpc.mockResolvedValue({ data: [{
      workspace_id: workspaceId, connection_id: connectionId, provider: 'threads', external_account_id: '1789001',
      encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null, granted_scopes: ['threads_basic'],
    }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', { rpc }, key, 'read'))
      .resolves.toMatchObject({ accessToken: 'provider-access-token', grantedScopes: ['threads_basic'] })
    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', { rpc }, key)).rejects.toThrow()
  })

  it.each([
    ['instagram', 'comment_reply', 'instagram_business_manage_comments'],
    ['instagram', 'message', 'instagram_business_manage_messages'],
    ['threads', 'reply', 'threads_manage_replies'],
  ] as const)('checks %s %s permissions independently of publishing', async (provider, capability, scope) => {
    const saveRpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    const basic = provider === 'instagram' ? 'instagram_business_basic' : 'threads_basic'
    await saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: provider, externalAccountId: 'account-1', accountLabel: '@sohee.ai',
      accessToken: 'response-only-token', grantedScopes: [basic, scope], expiresAt: null, refreshAfter: null,
    }, { rpc: saveRpc }, key)
    const saved = saveRpc.mock.calls[0]![1]
    const row = {
      workspace_id: workspaceId, connection_id: connectionId, provider, external_account_id: 'account-1',
      encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null,
      granted_scopes: [basic, scope],
    }
    // Threads replies use the publishing endpoint as well as reply management.
    if (provider === 'threads') row.granted_scopes.push('threads_content_publish')
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, provider, { rpc }, key, capability))
      .resolves.toMatchObject({ accessToken: 'response-only-token' })
    rpc.mockResolvedValue({ data: [{ ...row, granted_scopes: [basic, provider === 'instagram' ? 'instagram_business_content_publish' : 'threads_content_publish'] }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, provider, { rpc }, key, capability)).rejects.toThrow()
  })

  it('rejects saving a connection without basic read permission', async () => {
    const rpc = vi.fn()
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: [], expiresAt: null, refreshAfter: null,
    }, { rpc }, key)).rejects.toThrowError(ScopeMissingError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('propagates DuplicateBindingError when RPC reports cross-workspace duplication', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'DUPLICATE_BINDING: Account 1789001 is already connected to another workspace' },
    })
    await expect(saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789001', accountLabel: '@sohee.ai',
      accessToken: 'provider-access-token', grantedScopes: ['threads_basic', 'threads_content_publish'],
      expiresAt: null, refreshAfter: null,
    }, { rpc }, key)).rejects.toThrowError(DuplicateBindingError)
  })

  it('decrypts a server-only credential and rejects workspace/provider mismatches', async () => {
    const saveRpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789002', accountLabel: '@sohee.ai',
      accessToken: 'threads-provider-token', grantedScopes: [
        'threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies',
        'threads_manage_insights',
      ], expiresAt: null, refreshAfter: null,
    }, { rpc: saveRpc }, key)
    const saved = saveRpc.mock.calls[0]?.[1] as Record<string, unknown>
    const loadedRow = {
      workspace_id: workspaceId, connection_id: connectionId, provider: 'threads', external_account_id: '1789002',
      encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null,
      granted_scopes: ['threads_basic', 'threads_content_publish', 'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights'],
    }
    const rpc = vi.fn().mockResolvedValue({ data: [loadedRow], error: null })

    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', { rpc }, key)).resolves.toMatchObject({
      accessToken: 'threads-provider-token', externalAccountId: '1789002', provider: 'threads',
    })
    rpc.mockResolvedValueOnce({ data: [{ ...loadedRow, provider: 'instagram' }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', { rpc }, key)).rejects.toThrow('채널 연결 정보를 확인해 주세요.')
  })

  it('loads a credential that only has the minimized first-post scopes (basic + content_publish)', async () => {
    const saveRpc = vi.fn().mockResolvedValue({ data: connectionId, error: null })
    await saveConnectedChannel({
      workspaceId, actorUserId: '40000000-0000-4000-8000-000000000001', actorRole: 'owner',
      channel: 'threads', externalAccountId: '1789003', accountLabel: '@sohee.ai',
      accessToken: 'minimal-scope-token', grantedScopes: ['threads_basic', 'threads_content_publish'],
      expiresAt: null, refreshAfter: null,
    }, { rpc: saveRpc }, key)
    const saved = saveRpc.mock.calls[0]?.[1] as Record<string, unknown>
    const rpc = vi.fn().mockResolvedValue({ data: [{
      workspace_id: workspaceId, connection_id: connectionId, provider: 'threads', external_account_id: '1789003',
      encrypted_access_token: saved.p_encrypted_access_token, access_token_iv: saved.p_access_token_iv,
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null,
      granted_scopes: ['threads_basic', 'threads_content_publish'],
    }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'threads', { rpc }, key)).resolves.toMatchObject({
      accessToken: 'minimal-scope-token', provider: 'threads',
    })
  })

  it.each([
    { workspace_id: '20000000-0000-4000-8000-000000000002' },
    { connection_id: '30000000-0000-4000-8000-000000000002' },
    { provider: 'threads' },
    { status: 'revoked' },
    { token_expires_at: 'invalid-date' },
    { token_expires_at: '2000-01-01T00:00:00.000Z' },
    { granted_scopes: ['instagram_business_basic'] },
  ])('rejects changed or unverifiable credential state %j', async (change) => {
    const rpc = vi.fn().mockResolvedValue({ data: [{
      workspace_id: workspaceId, connection_id: connectionId, provider: 'instagram', external_account_id: '1789001',
      encrypted_access_token: 'encrypted-value-that-is-long-enough', access_token_iv: 'initial-vector-long',
      encryption_algorithm: 'AES-GCM-256', status: 'active', token_expires_at: null,
      granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'], ...change,
    }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key)).rejects.toThrow('채널 연결 정보를 확인해 주세요.')
  })

  it('fails closed for near-expiry credentials or missing required permissions', async () => {
    const base = {
      workspace_id: workspaceId, connection_id: connectionId, provider: 'instagram', external_account_id: '1789001',
      encrypted_access_token: 'encrypted-value-that-is-long-enough', access_token_iv: 'initial-vector-long',
      encryption_algorithm: 'AES-GCM-256', status: 'active',
      granted_scopes: ['instagram_business_basic'], token_expires_at: null,
    }
    const rpc = vi.fn().mockResolvedValue({ data: [base], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
      .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
    rpc.mockResolvedValueOnce({ data: [{
      ...base,
      granted_scopes: [
        'instagram_business_basic', 'instagram_business_content_publish',
        'instagram_business_manage_comments', 'instagram_business_manage_messages',
        'instagram_business_manage_insights',
      ],
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }], error: null })
    await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
      .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
  })

  describe('structured internal reason code logging', () => {
    it('logs RPC_ERROR when gateway rpc fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'relation not found' } })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'RPC_ERROR',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs RPC_MALFORMED with zodPaths when rpc returns malformed data', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({
        data: [{ workspace_id: 'not-a-uuid', provider: 'invalid-provider' }],
        error: null,
      })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'RPC_MALFORMED',
          provider: 'instagram',
          capability: 'publish',
          zodPaths: expect.any(Array),
        })
      )
      const call = warnSpy.mock.calls.find((c) => c[0] === '[credential-load]' && c[1]?.reason === 'RPC_MALFORMED')
      expect(call?.[1]?.zodPaths.length).toBeGreaterThan(0)
      warnSpy.mockRestore()
    })

    it('logs RPC_EMPTY_FALLBACK when rpc is empty and direct fallback finds no credentials', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      adminMocks.rpc.mockResolvedValue({ data: [], error: null })
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      adminMocks.from.mockReturnValue(query)

      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', undefined, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'RPC_EMPTY_FALLBACK',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs CONNECTION_STATUS when fallback connection status is not connected/authorized', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      adminMocks.rpc.mockResolvedValue({ data: [], error: null })
      adminMocks.from.mockImplementation((table: string) => {
        const query: any = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn().mockResolvedValue(
            table === 'meta_channel_credentials'
              ? {
                  data: {
                    workspace_id: workspaceId,
                    channel_connection_id: connectionId,
                    provider: 'instagram',
                    encrypted_access_token: 'valid-ciphertext-length-at-least-24-bytes',
                    access_token_iv: 'valid-initialization-vector',
                    encryption_algorithm: 'AES-GCM-256',
                    status: 'active',
                    token_expires_at: null,
                    granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
                  },
                  error: null,
                }
              : {
                  data: { external_account_id: '1789001', status: 'disconnected' },
                  error: null,
                }
          ),
        }
        return query
      })

      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', undefined, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'CONNECTION_STATUS',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs WORKSPACE_MISMATCH when credential fields do not match requested IDs', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({
        data: [{
          workspace_id: '99999999-9999-4999-8999-999999999999',
          connection_id: connectionId,
          provider: 'instagram',
          external_account_id: '1789001',
          encrypted_access_token: 'valid-ciphertext-length-at-least-24-bytes',
          access_token_iv: 'valid-initialization-vector',
          encryption_algorithm: 'AES-GCM-256',
          status: 'active',
          token_expires_at: null,
          granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        }],
        error: null,
      })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'WORKSPACE_MISMATCH',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs TOKEN_EXPIRING when token expiration is within 5 minutes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({
        data: [{
          workspace_id: workspaceId,
          connection_id: connectionId,
          provider: 'instagram',
          external_account_id: '1789001',
          encrypted_access_token: 'valid-ciphertext-length-at-least-24-bytes',
          access_token_iv: 'valid-initialization-vector',
          encryption_algorithm: 'AES-GCM-256',
          status: 'active',
          token_expires_at: new Date(Date.now() + 60_000).toISOString(),
          granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        }],
        error: null,
      })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'TOKEN_EXPIRING',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs SCOPE_MISSING:<capability>:<missing scope names> when scopes are insufficient', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({
        data: [{
          workspace_id: workspaceId,
          connection_id: connectionId,
          provider: 'instagram',
          external_account_id: '1789001',
          encrypted_access_token: 'valid-ciphertext-length-at-least-24-bytes',
          access_token_iv: 'valid-initialization-vector',
          encryption_algorithm: 'AES-GCM-256',
          status: 'active',
          token_expires_at: null,
          granted_scopes: ['instagram_business_basic'],
        }],
        error: null,
      })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key, 'publish'))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'SCOPE_MISSING:publish:instagram_business_content_publish',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs DECRYPT_FAILED when decryption fails', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rpc = vi.fn().mockResolvedValue({
        data: [{
          workspace_id: workspaceId,
          connection_id: connectionId,
          provider: 'instagram',
          external_account_id: '1789001',
          encrypted_access_token: 'invalid-corrupted-ciphertext-content-here',
          access_token_iv: 'valid-initialization-vector',
          encryption_algorithm: 'AES-GCM-256',
          status: 'active',
          token_expires_at: null,
          granted_scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
        }],
        error: null,
      })
      await expect(loadChannelCredential(workspaceId, connectionId, 'instagram', { rpc }, key))
        .rejects.toThrow('채널 연결 정보를 확인해 주세요.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'DECRYPT_FAILED',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })

    it('logs CONNECTION_STATUS in loadChannelCredentialByChannel when connection is disconnected', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: connectionId, status: 'disconnected', external_account_id: '1789001' },
          error: null,
        }),
      }
      adminMocks.from.mockReturnValue(query)
      await expect(loadChannelCredentialByChannel(workspaceId, 'instagram', undefined, key))
        .rejects.toThrow('채널 연결 정보를 확인할 수 없습니다.')
      expect(warnSpy).toHaveBeenCalledWith(
        '[credential-load]',
        expect.objectContaining({
          reason: 'CONNECTION_STATUS',
          provider: 'instagram',
          capability: 'publish',
        })
      )
      warnSpy.mockRestore()
    })
  })
})
