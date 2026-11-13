import 'server-only'

import { z } from 'zod'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import type { MetaOAuthChannel } from '@/features/channels/oauth/meta-oauth'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { getPublishedMetaPostPermalink } from '@/lib/providers/meta-api'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  channelConnectionId: z.string().uuid(),
  channel: z.enum(['instagram', 'threads']),
  attemptId: z.string().uuid(),
  providerPostId: z.string().regex(/^[A-Za-z0-9._-]{1,255}$/u),
}).strict()

type Credential = Readonly<{
  accessToken: string
  provider: MetaOAuthChannel
  externalAccountId: string
  expiresAt: string | null
}>

type BackfillDependencies = Readonly<{
  loadCredential(workspaceId: string, connectionId: string, channel: MetaOAuthChannel): Promise<Credential>
  lookupPermalink(input: Readonly<{
    channel: MetaOAuthChannel
    providerPostId: string
    accessToken: string
  }>): Promise<string | null>
  recordDestination(input: Readonly<{
    workspaceId: string
    attemptId: string
    destinationUrl: string
  }>): Promise<{ error: unknown }>
}>

async function productionDependencies(): Promise<BackfillDependencies> {
  const supabase = createAdminSupabaseClient()
  return {
    loadCredential: loadChannelCredential,
    lookupPermalink: getPublishedMetaPostPermalink,
    recordDestination: async ({ workspaceId, attemptId, destinationUrl }) => {
      const result = await supabase
        .from('social_post_tracking')
        .update({ destination_url: destinationUrl })
        .eq('workspace_id', workspaceId)
        .eq('publish_attempt_id', attemptId)
      return { error: result.error }
    },
  }
}

export async function backfillPublishedDestination(
  input: unknown,
  providedDependencies?: BackfillDependencies,
): Promise<string | null> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return null
  try {
    const dependencies = providedDependencies ?? await productionDependencies()
    const credential = await dependencies.loadCredential(
      parsed.data.workspaceId,
      parsed.data.channelConnectionId,
      parsed.data.channel,
    )
    if (credential.provider !== parsed.data.channel) return null
    const destinationUrl = await dependencies.lookupPermalink({
      channel: parsed.data.channel,
      providerPostId: parsed.data.providerPostId,
      accessToken: credential.accessToken,
    })
    if (!destinationUrl) return null
    const recorded = await dependencies.recordDestination({
      workspaceId: parsed.data.workspaceId,
      attemptId: parsed.data.attemptId,
      destinationUrl,
    })
    return recorded.error ? null : destinationUrl
  } catch {
    return null
  }
}
