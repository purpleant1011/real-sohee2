import { loadChannelCredentialByChannel } from '@/features/channels/credential-repository'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { ProfilePlatform } from '../types'

export type ConnectedIdentity = Readonly<{ accountId: string; accessToken: string; ownHandle: string | null }>

/** 작업공간에 연결된 계정의 토큰과 내 핸들. 연결이 없으면 사용자에게 보여줄 문구와 함께 던진다. */
export async function loadConnectedIdentity(workspaceId: string, platform: ProfilePlatform): Promise<ConnectedIdentity> {
  let credential: Awaited<ReturnType<typeof loadChannelCredentialByChannel>>
  try {
    credential = await loadChannelCredentialByChannel(workspaceId, platform, undefined, undefined, 'read')
  } catch {
    throw new Error(platform === 'instagram' ? 'INSTAGRAM_NOT_CONNECTED' : 'THREADS_NOT_CONNECTED')
  }
  const { data } = await createAdminSupabaseClient()
    .from('channel_connections')
    .select('account_label')
    .eq('workspace_id', workspaceId)
    .eq('channel', platform)
    .maybeSingle()
  const label = typeof data?.account_label === 'string' ? data.account_label.replace(/^@/, '').trim().toLowerCase() : ''
  return {
    accountId: credential.externalAccountId,
    accessToken: credential.accessToken,
    ownHandle: /^[a-z0-9._]{1,30}$/.test(label) ? label : null,
  }
}
