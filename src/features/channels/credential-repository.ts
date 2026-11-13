import 'server-only'

import { z } from 'zod'
import type { WorkspaceRole } from '@/features/auth/workspace-context'
import { decryptChannelCredential, encryptChannelCredential } from '@/lib/security/channel-credential-crypto'
import { ScopeMissingError, DuplicateBindingError, getMetaRequiredScopes, type MetaCredentialCapability, type MetaOAuthChannel } from './oauth/meta-oauth'
import { normalizeChannelScopes } from './dual-channel-verification'

type RpcGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

const uuid = z.string().uuid()
const loadedCredential = z.object({
  workspace_id: uuid,
  connection_id: uuid,
  provider: z.enum(['instagram', 'threads']),
  external_account_id: z.string().min(1).max(255),
  encrypted_access_token: z.string().min(24).max(8192),
  access_token_iv: z.string().min(16).max(64),
  encryption_algorithm: z.literal('AES-GCM-256'),
  status: z.literal('active'),
  token_expires_at: z.string().datetime({ offset: true }).nullable(),
  granted_scopes: z.array(z.string().min(1).max(120)).max(30),
}).strict()
const loadedCredentialRows = z.array(loadedCredential).length(1)

async function productionGateway(): Promise<RpcGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as RpcGateway
}

export async function saveConnectedChannel(input: Readonly<{
  workspaceId: string
  actorUserId: string
  actorRole: WorkspaceRole
  channel: MetaOAuthChannel
  externalAccountId: string
  accountLabel: string
  accessToken: string
  grantedScopes: readonly string[]
  expiresAt: string | null
  refreshAfter: string | null
}>, providedGateway?: RpcGateway, encodedKey = process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? '') {
  if (input.actorRole !== 'owner' && input.actorRole !== 'manager') {
    throw new Error('채널을 연결할 권한이 없습니다.')
  }
  const normalizedGranted = normalizeChannelScopes(input.channel, input.grantedScopes)
  if (getMetaRequiredScopes(input.channel, 'read').some((scope) => !normalizedGranted.includes(scope))) {
    throw new ScopeMissingError(`SCOPE_MISSING: ${input.channel} 계정 조회 권한이 누락되었습니다.`)
  }
  const encrypted = await encryptChannelCredential(input.accessToken, encodedKey)

  const gateway = providedGateway ?? await productionGateway()
  {
    const result = await gateway.rpc('save_meta_channel_connection', {
      p_workspace_id: input.workspaceId,
      p_actor_user_id: input.actorUserId,
      p_provider: input.channel,
      p_external_account_id: input.externalAccountId,
      p_account_label: input.accountLabel,
      p_encrypted_access_token: encrypted.ciphertext,
      p_access_token_iv: encrypted.iv,
      p_granted_scopes: [...input.grantedScopes],
      p_token_expires_at: input.expiresAt,
      p_refresh_after: input.refreshAfter,
    })
    const connectionId = uuid.safeParse(result.data)
    if (!result.error && connectionId.success) {
      return Object.freeze({ connectionId: connectionId.data })
    }
    const errMsg = (result.error as any)?.message || ''
    if (errMsg.includes('DUPLICATE_BINDING')) {
      throw new DuplicateBindingError(errMsg)
    }
    throw new Error('채널 연결 정보를 저장하지 못했습니다.')
  }
}

export async function loadChannelCredential(
  workspaceId: string,
  connectionId: string,
  provider: MetaOAuthChannel,
  providedGateway?: RpcGateway,
  encodedKey = process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? '',
  capability: MetaCredentialCapability = 'publish',
) {
  let credential: any = null

  if (providedGateway) {
    const result = await providedGateway.rpc('load_meta_channel_credential', {
      p_workspace_id: workspaceId,
      p_connection_id: connectionId,
    })
    if (result.error) {
      console.warn('[credential-load]', { reason: 'RPC_ERROR', provider, capability })
      throw new Error('채널 연결 정보를 확인해 주세요.')
    }
    const parsed = loadedCredentialRows.safeParse(result.data)
    if (parsed.success) {
      credential = parsed.data[0]
    } else {
      const zodPaths = parsed.error.issues.map((i) => i.path.join('.'))
      console.warn('[credential-load]', { reason: 'RPC_MALFORMED', provider, capability, zodPaths })
      throw new Error('채널 연결 정보를 확인해 주세요.')
    }
  } else {
    const gateway = await productionGateway()
    const result = await gateway.rpc('load_meta_channel_credential', {
      p_workspace_id: workspaceId,
      p_connection_id: connectionId,
    })
    if (result.error) {
      console.warn('[credential-load]', { reason: 'RPC_ERROR', provider, capability })
      throw new Error('채널 연결 정보를 확인해 주세요.')
    }
    const parsed = loadedCredentialRows.safeParse(result.data)
    if (parsed.success) {
      credential = parsed.data[0]
    } else if (!Array.isArray(result.data) || result.data.length !== 0) {
      const zodPaths = parsed.error?.issues ? parsed.error.issues.map((i) => i.path.join('.')) : []
      console.warn('[credential-load]', { reason: 'RPC_MALFORMED', provider, capability, zodPaths })
      throw new Error('채널 연결 정보를 확인해 주세요.')
    }
    // The legacy RPC requires optional scopes too. Only an empty, successful result
    // may use the scoped direct read; errors and malformed responses fail closed.

    if (!credential) {
      const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
      const admin = createAdminSupabaseClient() as any
      const { data, error } = await admin
        .from('meta_channel_credentials')
        .select('workspace_id, channel_connection_id, provider, encrypted_access_token, access_token_iv, encryption_algorithm, status, token_expires_at, granted_scopes')
        .eq('workspace_id', workspaceId)
        .eq('channel_connection_id', connectionId)
        .maybeSingle()

      if (error || !data) {
        console.warn('[credential-load]', { reason: 'RPC_EMPTY_FALLBACK', provider, capability })
        throw new Error('채널 연결 정보를 확인해 주세요.')
      }

      const { data: conn, error: connectionError } = await admin
        .from('channel_connections')
        .select('external_account_id, status')
        .eq('workspace_id', workspaceId)
        .eq('channel', provider)
        .eq('id', connectionId)
        .maybeSingle()
      if (connectionError || !conn || !['connected', 'authorized', 'configured'].includes(conn.status)) {
        console.warn('[credential-load]', { reason: 'CONNECTION_STATUS', provider, capability })
        throw new Error('채널 연결 정보를 확인해 주세요.')
      }

      credential = {
        workspace_id: data.workspace_id,
        connection_id: data.channel_connection_id,
        provider: data.provider,
        external_account_id: conn?.external_account_id || '',
        encrypted_access_token: data.encrypted_access_token,
        access_token_iv: data.access_token_iv,
        encryption_algorithm: data.encryption_algorithm,
        status: data.status,
        token_expires_at: data.token_expires_at,
        granted_scopes: data.granted_scopes || [],
      }
    }
  }

  const parsedCredential = loadedCredential.safeParse(credential)
  if (!parsedCredential.success) {
    const zodPaths = parsedCredential.error.issues.map((i) => i.path.join('.'))
    console.warn('[credential-load]', { reason: 'RPC_MALFORMED', provider, capability, zodPaths })
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }
  credential = parsedCredential.data

  if (
    credential.workspace_id !== workspaceId
    || credential.connection_id !== connectionId
    || credential.provider !== provider
  ) {
    console.warn('[credential-load]', { reason: 'WORKSPACE_MISMATCH', provider, capability })
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }

  if (
    credential.token_expires_at !== null
    && (Number.isNaN(Date.parse(credential.token_expires_at))
      || Date.parse(credential.token_expires_at) <= Date.now() + 5 * 60_000)
  ) {
    console.warn('[credential-load]', { reason: 'TOKEN_EXPIRING', provider, capability })
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }

  const normalizedScopes = normalizeChannelScopes(provider, credential.granted_scopes)
  const missingScopes = getMetaRequiredScopes(provider, capability).filter((scope) => !normalizedScopes.includes(scope))
  if (missingScopes.length > 0) {
    const reason = `SCOPE_MISSING:${capability}:${missingScopes.join(',')}`
    console.warn('[credential-load]', { reason, provider, capability })
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }

  let accessToken: string
  try {
    accessToken = await decryptChannelCredential({
      ciphertext: credential.encrypted_access_token,
      iv: credential.access_token_iv,
      algorithm: credential.encryption_algorithm,
    }, encodedKey)
  } catch {
    console.warn('[credential-load]', { reason: 'DECRYPT_FAILED', provider, capability })
    throw new Error('채널 연결 정보를 확인해 주세요.')
  }

  return Object.freeze({
    accessToken,
    provider: credential.provider,
    externalAccountId: credential.external_account_id,
    expiresAt: credential.token_expires_at,
    grantedScopes: credential.granted_scopes || [],
  })
}

export async function loadChannelCredentialByChannel(
  workspaceId: string,
  provider: MetaOAuthChannel,
  providedGateway?: RpcGateway,
  encodedKey = process.env.META_CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? '',
  capability: MetaCredentialCapability = 'publish',
) {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const client = createAdminSupabaseClient()
  const { data: conn, error } = await client
    .from('channel_connections')
    .select('id, status, external_account_id')
    .eq('workspace_id', workspaceId)
    .eq('channel', provider)
    .maybeSingle()

  if (error || !conn || (conn.status !== 'connected' && conn.status !== 'authorized' && conn.status !== 'configured')) {
    console.warn('[credential-load]', { reason: 'CONNECTION_STATUS', provider, capability })
    throw new Error('채널 연결 정보를 확인할 수 없습니다.')
  }
  const credential = await loadChannelCredential(workspaceId, conn.id, provider, providedGateway, encodedKey, capability)
  if (!conn.external_account_id || credential.externalAccountId !== conn.external_account_id) {
    console.warn('[credential-load]', { reason: 'WORKSPACE_MISMATCH', provider, capability })
    throw new Error('채널 계정이 변경되었습니다. 다시 확인해 주세요.')
  }
  return credential
}

export async function disconnectChannelConnection(
  workspaceId: string,
  actorUserId: string,
  actorRole: WorkspaceRole,
  channel: MetaOAuthChannel | string,
) {
  if (actorRole !== 'owner' && actorRole !== 'manager') {
    throw new Error('채널을 해제할 권한이 없습니다.')
  }
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const client = createAdminSupabaseClient()
  const { error } = await client
    .from('channel_connections')
    .update({
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)

  if (error) {
    throw new Error('채널 연결 해제에 실패했습니다.')
  }
  return { success: true }
}

