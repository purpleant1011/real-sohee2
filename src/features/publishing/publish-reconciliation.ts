import 'server-only'

import { z } from 'zod'
import { loadChannelCredential } from '@/features/channels/credential-repository'
import {
  listRecentPublishedMetaPosts,
  type RecentPublishedMetaPost,
} from '@/lib/providers/meta-api'
import { loadReconciledPublishMaterial } from './approved-publish-repository'

const reconciliationRows = z.array(z.object({
  attempt_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  channel_connection_id: z.string().uuid(),
  channel: z.enum(['instagram', 'threads']),
  provider_request_id: z.string().min(1).max(255).nullable(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }),
}).strict()).length(1)

type Gateway = Readonly<{
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}>

type Credential = Awaited<ReturnType<typeof loadChannelCredential>>

type Dependencies = Readonly<{
  rpc: Gateway['rpc']
  loadMaterial: typeof loadReconciledPublishMaterial
  loadCredential(
    workspaceId: string,
    connectionId: string,
    channel: 'instagram' | 'threads',
  ): Promise<Credential>
  listPosts(input: Readonly<{
    channel: 'instagram' | 'threads'
    accountId: string
    accessToken: string
  }>): Promise<readonly RecentPublishedMetaPost[]>
  now(): Date
}>

export type ReconciledPublishOutcome = Readonly<{
  attemptId: string
  status: 'published' | 'failed' | 'unknown'
  providerPostId: string | null
  errorCode: 'RECONCILED_NO_POST' | 'RESULT_UNKNOWN' | null
}>

const PROVIDER_CLOCK_SKEW_MS = 60_000

async function productionDependencies(): Promise<Dependencies> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  const gateway = createAdminSupabaseClient() as unknown as Gateway
  return {
    rpc: gateway.rpc.bind(gateway),
    loadMaterial: loadReconciledPublishMaterial,
    loadCredential: loadChannelCredential,
    listPosts: listRecentPublishedMetaPosts,
    now: () => new Date(),
  }
}

export async function reconcileUnknownPublish(
  input: Readonly<{ workspaceId: string; attemptId: string; actorUserId: string }>,
  providedDependencies?: Dependencies,
): Promise<ReconciledPublishOutcome> {
  if (
    !z.string().uuid().safeParse(input.workspaceId).success
    || !z.string().uuid().safeParse(input.attemptId).success
    || !z.string().uuid().safeParse(input.actorUserId).success
  ) throw new Error('PUBLISH_RECONCILIATION_INVALID')

  const dependencies = providedDependencies ?? await productionDependencies()
  const loaded = await dependencies.rpc('load_publish_reconciliation', {
    p_workspace_id: input.workspaceId,
    p_attempt_id: input.attemptId,
  })
  const parsed = reconciliationRows.safeParse(loaded.data)
  if (loaded.error || !parsed.success) throw new Error('PUBLISH_RECONCILIATION_UNAVAILABLE')
  const context = parsed.data[0]
  if (context.attempt_id !== input.attemptId) throw new Error('PUBLISH_RECONCILIATION_STALE')
  const material = await dependencies.loadMaterial(input.workspaceId, context.schedule_id)
  const payload = material.payload
  if (
    payload.workspaceId !== input.workspaceId
    || payload.scheduleId !== context.schedule_id
    || payload.channel !== context.channel
  ) throw new Error('PUBLISH_RECONCILIATION_STALE')

  const credential = await dependencies.loadCredential(
    input.workspaceId,
    context.channel_connection_id,
    context.channel,
  )
  if (
    credential.provider !== context.channel
    || credential.externalAccountId !== payload.externalAccountId
    || (credential.expiresAt !== null && Date.parse(credential.expiresAt) <= dependencies.now().getTime())
  ) throw new Error('PUBLISH_RECONCILIATION_CONNECTION_INVALID')

  const posts = await dependencies.listPosts({
    channel: context.channel,
    accountId: payload.externalAccountId,
    accessToken: credential.accessToken,
  })
  const startedAt = Date.parse(context.started_at)
  const checkedAt = dependencies.now().getTime()
  const matches = posts.filter((post) => {
    const timestamp = Date.parse(post.timestamp)
    return post.text === payload.text
      && timestamp >= startedAt - PROVIDER_CLOCK_SKEW_MS
      && timestamp <= checkedAt + PROVIDER_CLOCK_SKEW_MS
  })

  // A request/container ID is not a published post ID. Only account-scoped
  // recent post evidence can identify a candidate; never select among duplicates.
  if (matches.length === 1 && matches[0]!.id.trim() && matches[0]!.id.trim().toLowerCase() !== 'unknown') {
    const resolved = await dependencies.rpc('resolve_reconciled_publish', {
      p_workspace_id: input.workspaceId,
      p_attempt_id: input.attemptId,
      p_actor_user_id: input.actorUserId,
      p_status: 'succeeded',
      p_provider_reference: matches[0]!.id,
      p_error_code: null,
    })
    if (resolved.error || resolved.data !== input.attemptId) {
      throw new Error('PUBLISH_RECONCILIATION_RECORDING_FAILED')
    }
    return Object.freeze({
      attemptId: input.attemptId,
      status: 'published',
      providerPostId: matches[0]!.id,
      errorCode: null,
    })
  }

  // Recent lists may be delayed or truncated: absence, even after a timeout,
  // is not proof of failure and must not unlock another external write.
  return Object.freeze({
    attemptId: input.attemptId,
    status: 'unknown',
    providerPostId: null,
    errorCode: 'RESULT_UNKNOWN',
  })
}
