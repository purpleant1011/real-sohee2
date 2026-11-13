import 'server-only'

import type { MetaOAuthChannel } from './meta-oauth'
import { oauthStateDigest } from './oauth-state'
import { registerOAuthNonce, consumeOAuthNonce } from './oauth-nonce-repository'

export interface RegisterOAuthTransactionInput {
  state: string
  workspaceId: string
  actorUserId: string
  channel: MetaOAuthChannel
  requestedScopes?: readonly string[]
  returnPath?: string
  correlationId: string
  expiresAt: string
}

export interface ConsumeOAuthTransactionInput {
  state: string
  workspaceId: string
  actorUserId: string
  channel: MetaOAuthChannel
}

type DatabaseClient = {
  from(table: string): any
  rpc?(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

async function productionAdminClient(): Promise<DatabaseClient> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as DatabaseClient
}

export async function registerOAuthTransaction(
  input: RegisterOAuthTransactionInput,
  providedClient?: DatabaseClient,
): Promise<void> {
  const client = providedClient ?? (await productionAdminClient())
  const stateHash = await oauthStateDigest(input.state)

  try {
    const { error } = await client.from('oauth_transactions').insert({
      workspace_id: input.workspaceId,
      user_id: input.actorUserId,
      channel: input.channel,
      state_hash: stateHash,
      requested_scopes: input.requestedScopes ?? [],
      return_path: input.returnPath ?? '/app/settings/channels',
      correlation_id: input.correlationId,
      expires_at: input.expiresAt,
    })
    if (error) {
      if (client.rpc) {
        await registerOAuthNonce({
          state: input.state,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          channel: input.channel,
          expiresAt: input.expiresAt,
        }, { rpc: client.rpc.bind(client) })
        return
      }
      throw new Error('채널 연결 요청을 만들지 못했습니다.')
    }
  } catch (err: any) {
    if (err.message === '채널 연결 요청을 만들지 못했습니다.') throw err
    if (client.rpc) {
      await registerOAuthNonce({
        state: input.state,
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        channel: input.channel,
        expiresAt: input.expiresAt,
      }, { rpc: client.rpc.bind(client) })
      return
    }
    throw new Error('채널 연결 요청을 만들지 못했습니다.')
  }
}

export async function consumeOAuthTransaction(
  input: ConsumeOAuthTransactionInput,
  providedClient?: DatabaseClient,
): Promise<void> {
  const client = providedClient ?? (await productionAdminClient())
  const stateHash = await oauthStateDigest(input.state)
  const now = new Date().toISOString()

  let tableSuccess = false
  try {
    let query: any = client
      .from('oauth_transactions')
      .update({ consumed_at: now }, { count: 'exact' })
      .eq('state_hash', stateHash)
      .eq('workspace_id', input.workspaceId)
      .eq('user_id', input.actorUserId)
      .eq('channel', input.channel)
      .is('consumed_at', null)
      .gt('expires_at', now)

    if (typeof query?.select === 'function') {
      query = query.select('id')
    }

    const updateResult = await query

    if (!updateResult?.error && ((updateResult?.data && updateResult.data.length > 0) || (updateResult?.count ?? 0) > 0)) {
      tableSuccess = true
    }
  } catch {
    // Safe ignore for table error
  }

  if (tableSuccess) {
    if (client.rpc) {
      try {
        await consumeOAuthNonce({
          state: input.state,
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          channel: input.channel,
        }, { rpc: client.rpc.bind(client) })
      } catch {
        // Safe ignore
      }
    }
    return
  }

  if (client.rpc) {
    await consumeOAuthNonce({
      state: input.state,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      channel: input.channel,
    }, { rpc: client.rpc.bind(client) })
    return
  }

  throw new Error('채널 연결 요청이 이미 사용되었거나 만료되었습니다.')
}
