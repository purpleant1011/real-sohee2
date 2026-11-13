import 'server-only'

import type { MetaOAuthChannel } from './oauth/meta-oauth'

export async function disconnectProviderAccount(input: Readonly<{
  channel: MetaOAuthChannel
  externalAccountId: string
  reason: 'provider_removal' | 'provider_deletion'
}>) {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminSupabaseClient()
  const result = await supabase.rpc('disconnect_meta_channel_by_provider_account' as never, {
    p_provider: input.channel,
    p_external_account_id: input.externalAccountId,
    p_reason: input.reason,
  } as never) as { data: unknown; error: unknown }
  if (result.error || result.data !== true) throw new Error('PROVIDER_DISCONNECT_FAILED')
}
