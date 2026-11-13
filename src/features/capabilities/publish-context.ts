import { evaluateCapability, type CapabilityEnvironment, type CapabilityProvider } from './registry'

interface ChannelContext { channel: string; status: string; account_label?: string | null }

/** Read-only capability projection; never probes providers or decrypts credentials. */
export async function filterPublishReadyChannels<T extends ChannelContext>(
  client: any,
  workspaceId: string,
  channels: readonly T[],
  options: { now?: Date; env?: CapabilityEnvironment } = {},
): Promise<T[]> {
  if (!channels.length) return []
  const [credentials, verifications] = await Promise.all([
    client.from('meta_channel_credentials')
      .select('provider,status,granted_scopes,token_expires_at')
      .eq('workspace_id', workspaceId).in('provider', ['instagram', 'threads']),
    client.from('channel_verification_runs')
      .select('channel,status,read_after_write_at')
      .eq('workspace_id', workspaceId).in('status', ['VERIFIED', 'success'])
      .order('created_at', { ascending: false }),
  ])
  if (credentials.error || verifications.error) throw new Error('CHANNEL_CAPABILITY_QUERY_FAILED')
  return channels.filter(channel => {
    if (channel.channel !== 'instagram' && channel.channel !== 'threads') return false
    const credential = credentials.data?.find((row: any) => row.provider === channel.channel && row.status === 'active')
    const verification = verifications.data?.find((row: any) => row.channel === channel.channel && ['VERIFIED', 'success'].includes(row.status))
    return evaluateCapability({
      workspaceId, action: 'publish', provider: channel.channel as CapabilityProvider,
      permission: {
        workspaceId, provider: channel.channel as CapabilityProvider,
        connected: ['connected', 'verified'].includes(channel.status) && Boolean(credential),
        grantedScopes: Array.isArray(credential?.granted_scopes) ? credential.granted_scopes : [],
        expiresAt: credential?.token_expires_at,
        verifiedAt: verification?.read_after_write_at ?? null,
      },
      ...options,
    }).ready
  })
}
