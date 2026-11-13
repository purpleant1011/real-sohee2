import 'server-only'

import type { MetaOAuthChannel } from './meta-oauth'
import { oauthStateDigest } from './oauth-state'

type RpcGateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

async function productionGateway(): Promise<RpcGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as RpcGateway
}

export async function registerOAuthNonce(input: Readonly<{
  state: string
  workspaceId: string
  actorUserId: string
  channel: MetaOAuthChannel
  expiresAt: string
}>, providedGateway?: RpcGateway): Promise<void> {
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('register_oauth_state_nonce', {
    p_nonce_sha256: await oauthStateDigest(input.state),
    p_workspace_id: input.workspaceId,
    p_actor_user_id: input.actorUserId,
    p_provider: input.channel,
    p_expires_at: input.expiresAt,
  })
  if (result.error || result.data !== true) throw new Error('채널 연결 요청을 만들지 못했습니다.')
}

export async function consumeOAuthNonce(input: Readonly<{
  state: string
  workspaceId: string
  actorUserId: string
  channel: MetaOAuthChannel
}>, providedGateway?: RpcGateway): Promise<void> {
  const gateway = providedGateway ?? await productionGateway()
  const result = await gateway.rpc('consume_oauth_state_nonce', {
    p_nonce_sha256: await oauthStateDigest(input.state),
    p_workspace_id: input.workspaceId,
    p_actor_user_id: input.actorUserId,
    p_provider: input.channel,
  })
  if (result.error || result.data !== true) {
    throw new Error('채널 연결 요청이 이미 사용되었거나 만료되었습니다.')
  }
}
