import 'server-only'

import type { MetaWebhookProvider, NormalizedMetaEvent } from './handler'
import { evaluateRiskPolicy } from '@/features/channels/responsive-employee-loop'
import { dmInputFromWebhookEvent } from '@/features/engagement/dm/webhook-adapter'
import type { IngestWebhookCommentParams } from '@/features/engagement/ingest'

type UntypedResult<T> = Promise<{ data: T | null; error: unknown }>

export type CommentSink = (params: Omit<IngestWebhookCommentParams, 'repo'>) => Promise<unknown>

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function commentParamsFromEvent(
  event: NormalizedMetaEvent,
  connection: { id: string; workspace_id: string; account_label?: string | null },
): Omit<IngestWebhookCommentParams, 'repo'> | null {
  const payload = asRecord(event.payload) ?? {}
  if (payload.isSelf === true || payload.isEcho === true || payload.isDeleted === true) {
    return null
  }

  if (
    event.externalSubjectId &&
    (event.externalSubjectId === event.externalAccountId ||
      (event.instagramAccountId !== null && event.externalSubjectId === event.instagramAccountId))
  ) {
    return null
  }

  const fromObj = asRecord(payload.from)
  const fromId = typeof fromObj?.id === 'string' ? fromObj.id : null
  if (
    fromId &&
    (fromId === event.externalAccountId ||
      (event.instagramAccountId !== null && fromId === event.instagramAccountId))
  ) {
    return null
  }

  const providerCommentId = event.providerEventId || (typeof payload.id === 'string' ? payload.id : null)
  if (!providerCommentId) return null

  const fromUsername = typeof fromObj?.username === 'string' ? fromObj.username : null
  const payloadAuthorHandle = typeof payload.authorHandle === 'string' ? payload.authorHandle : null
  const payloadUsername = typeof payload.username === 'string' ? payload.username : null

  const authorHandle =
    fromUsername ||
    payloadAuthorHandle ||
    payloadUsername ||
    event.externalSubjectId ||
    'unknown'

  const authorId = event.externalSubjectId || fromId || null
  const commentText =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.message === 'string'
        ? payload.message
        : ''
  const providerMediaId =
    event.providerPostReference || (typeof payload.targetId === 'string' ? payload.targetId : '')
  const commentCreatedAt = event.occurredAt || new Date().toISOString()

  return {
    workspaceId: connection.workspace_id,
    channelConnectionId: connection.id,
    channel: event.provider,
    providerCommentId,
    providerMediaId,
    authorHandle,
    authorId,
    commentText,
    commentCreatedAt,
    selfAccountId: event.instagramAccountId || event.externalAccountId || null,
    selfAccountHandle: connection.account_label || null,
    selfAccountUsername: connection.account_label || null,
  }
}

export type EventStoreGateway = Readonly<{
  findConnection(provider: MetaWebhookProvider, externalAccountId: string): UntypedResult<{
    id: string
    workspace_id: string
    account_label?: string | null
  }>
  insertEvent(row: Record<string, unknown>): UntypedResult<{ id: string }>
  updateHealth(workspaceId: string, connectionId: string, occurredAt: string): UntypedResult<unknown>
  insertResponseJob?(row: Record<string, unknown>): UntypedResult<unknown>
  findMissionByPostReference?(workspaceId: string, postRef: string): UntypedResult<{
    id: string
    content_id?: string | null
  }>
  recordCustomerConversation?(params: {
    workspaceId: string
    channel: 'instagram' | 'threads' | 'naver_blog' | 'naver_place'
    externalSubjectId: string
    displayLabel: string
    messageText: string
    relatedContentItemId?: string | null
    missionId?: string | null
  }): UntypedResult<unknown>
  recordDmMessage?(params: {
    workspaceId: string
    channelConnectionId: string
    event: NormalizedMetaEvent
  }): Promise<void>
  recordComment?(params: {
    workspaceId: string
    channelConnectionId: string
    event: NormalizedMetaEvent
    accountLabel?: string | null
  }): Promise<void>
  commentSink?: CommentSink
}>

export type MetaWebhookEventStoreOptions = Readonly<{
  commentSink?: CommentSink
}>

async function productionGateway(): Promise<EventStoreGateway> {
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  type ConnectionQuery = {
    select(columns: string): ConnectionQuery
    eq(column: string, value: string): ConnectionQuery
    contains(column: string, value: Record<string, unknown>): ConnectionQuery
    order(column: string, options: { ascending: boolean }): ConnectionQuery
    limit(count: number): ConnectionQuery
    maybeSingle(): UntypedResult<any>
    single(): UntypedResult<any>
  }
  type TableQuery = {
    select(columns: string): ConnectionQuery
    upsert(row: Record<string, unknown>, options: Record<string, unknown>): ConnectionQuery
    insert(row: Record<string, unknown>): UntypedResult<unknown>
  }
  const client = createAdminSupabaseClient() as unknown as {
    from(table: string): TableQuery
  }
  return {
    findConnection(provider, externalAccountId) {
      // Same-name workspace regression guard: directly resolves connection by provider and external account ID,
      // mapping strictly to immutable workspace_id UUID rather than workspace name or slug.
      return client.from('channel_connections').select('id, workspace_id, account_label')
        .eq('channel', provider).eq('external_account_id', externalAccountId)
        .eq('status', 'connected').maybeSingle()
    },
    insertEvent(row) {
      return client.from('provider_webhook_events').upsert(row, {
        onConflict: 'workspace_id,event_key',
        ignoreDuplicates: true,
      }).select('id').maybeSingle()
    },
    updateHealth(workspaceId, connectionId, occurredAt) {
      return (client as unknown as { rpc(name: string, args: Record<string, unknown>): UntypedResult<unknown> })
        .rpc('record_meta_webhook_health', {
          p_workspace_id: workspaceId,
          p_connection_id: connectionId,
          p_provider_event_at: occurredAt,
        })
    },
    insertResponseJob(row) {
      return client.from('channel_response_jobs').insert(row)
    },
    async findMissionByPostReference(workspaceId: string, postRef: string) {
      return client
        .from('marketing_missions')
        .select('id, content_id')
        .eq('workspace_id', workspaceId)
        .contains('metadata', { provider_post_reference: postRef })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    },
    async recordCustomerConversation(params) {
      const { CustomerConversationService } = await import(
        '@/features/customer-conversations/customer-conversation-service'
      )
      const convService = new CustomerConversationService(client as any)
      const data = await convService.recordCustomerInbound(params)
      return { data, error: null }
    },
    async recordDmMessage({ workspaceId, channelConnectionId, event }) {
      const { isEngagementFeatureOn } = await import('@/features/engagement/engagement-allowlist')
      if (!isEngagementFeatureOn('ENGAGEMENT_DM_INGEST_ENABLED', workspaceId)) return
      const { dmInputFromWebhookEvent } = await import('@/features/engagement/dm/webhook-adapter')
      const input = dmInputFromWebhookEvent(event, { workspaceId, channelConnectionId })
      if (!input) return
      const { SupabaseInstagramDmRepository } = await import('@/features/engagement/dm/repository')
      const { ingestDmMessage } = await import('@/features/engagement/dm/ingest')
      const { projectInboundMessageToRecovery } = await import('@/features/booking-recovery/inbound-projector')
      await ingestDmMessage(
        input,
        new SupabaseInstagramDmRepository(client as never),
        new Date(),
        async ({ workspaceId: wsId, threadId, message }) => {
          await projectInboundMessageToRecovery(client as any, {
            workspaceId: wsId,
            threadId,
            message: {
              id: message.id,
              sender_type: message.sender_type,
              sender_id: message.sender_id,
              text: message.text,
              sent_at: message.sent_at,
            },
          }).catch((projErr) => {
            console.warn('[MetaWebhookEventStore] Recovery projection notice:', projErr)
          })
        }
      )
    },
    async recordComment({ workspaceId, channelConnectionId, event, accountLabel }) {
      const { isEngagementFeatureOn } = await import('@/features/engagement/engagement-allowlist')
      if (!isEngagementFeatureOn('ENGAGEMENT_CYCLE_ENABLED', workspaceId)) return

      const params = commentParamsFromEvent(event, { id: channelConnectionId, workspace_id: workspaceId, account_label: accountLabel })
      if (!params) return

      const { SupabaseEngagementRepository } = await import('@/features/engagement/repository')
      const { ingestWebhookComment } = await import('@/features/engagement/ingest')
      const repo = new SupabaseEngagementRepository(client as never)

      await ingestWebhookComment({
        ...params,
        repo,
      })
    },
  }
}

async function forwardDmToSink(
  gateway: EventStoreGateway,
  connection: { id: string; workspace_id: string },
  event: NormalizedMetaEvent,
): Promise<void> {
  if (!gateway.recordDmMessage) return
  try {
    await gateway.recordDmMessage({
      workspaceId: connection.workspace_id,
      channelConnectionId: connection.id,
      event,
    })
  } catch (error) {
    // Never fail the webhook: Meta would retry-storm, and the polling path reconciles gaps.
    console.warn('[MetaWebhookEventStore] DM sink notice:', error)
  }
}

function isCommentCategory(category: string): boolean {
  return category === 'comment' || category === 'reply'
}

async function forwardCommentToSink(
  gateway: EventStoreGateway,
  connection: { id: string; workspace_id: string; account_label?: string | null },
  event: NormalizedMetaEvent,
  options?: MetaWebhookEventStoreOptions,
): Promise<void> {
  const params = commentParamsFromEvent(event, connection)
  if (!params) return

  try {
    const { isEngagementFeatureOn } = await import('@/features/engagement/engagement-allowlist')
    if (!isEngagementFeatureOn('ENGAGEMENT_CYCLE_ENABLED', connection.workspace_id)) return

    const sink = options?.commentSink ?? gateway.commentSink

    if (sink) {
      await sink(params)
      return
    }

    if (gateway.recordComment) {
      await gateway.recordComment({
        workspaceId: connection.workspace_id,
        channelConnectionId: connection.id,
        event,
        accountLabel: connection.account_label,
      })
    }
  } catch (error) {
    // Never fail the webhook: Meta would retry-storm, and the polling path reconciles gaps.
    // Disallow logging comment text or author handle (PII).
    console.warn('[webhook-comment-ingest]', {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function createMetaWebhookEventStore(
  providedGateway?: EventStoreGateway,
  options?: MetaWebhookEventStoreOptions,
) {
  const gateway = providedGateway ?? await productionGateway()
  return Object.freeze({
    async record(events: readonly NormalizedMetaEvent[]) {
      const connections = new Map<string, { id: string; workspace_id: string; account_label?: string | null }>()
      for (const event of events) {
        const connectionKey = `${event.provider}:${event.externalAccountId}`
        let connection = connections.get(connectionKey)
        if (!connection) {
          const result = await gateway.findConnection(event.provider, event.externalAccountId)
          if (result.error || !result.data) throw new Error('META_CONNECTION_NOT_FOUND')
          connection = result.data
          connections.set(connectionKey, connection)
        }
        const dmPayload = event.category === 'dm' ? (event.payload as Record<string, unknown>) : null
        if (dmPayload && (dmPayload.isSelf === true || dmPayload.isDeleted === true)) continue
        if (dmPayload && !dmInputFromWebhookEvent(event, {
          workspaceId: connection.workspace_id, channelConnectionId: connection.id,
        })) continue
        if (dmPayload && dmPayload.isEcho === true) {
          // Our own outbound DM echoing back: never a legacy inbound event or response job.
          const echoHealth = await gateway.updateHealth(connection.workspace_id, connection.id, event.occurredAt)
          if (echoHealth.error) throw new Error('META_WEBHOOK_HEALTH_FAILED')
          await forwardDmToSink(gateway, connection, event)
          continue
        }

        const inserted = await gateway.insertEvent({
          workspace_id: connection.workspace_id,
          channel_connection_id: connection.id,
          provider: event.provider,
          category: event.category,
          event_key: event.eventKey,
          provider_event_id: event.providerEventId,
          external_subject_id: event.externalSubjectId,
          provider_post_reference: event.providerPostReference,
          payload: event.payload,
          payload_sha256: event.payloadSha256,
          occurred_at: event.occurredAt,
        })
        if (inserted.error) throw new Error('META_EVENT_STORAGE_FAILED')
        const health = await gateway.updateHealth(connection.workspace_id, connection.id, event.occurredAt)
        if (health.error) throw new Error('META_WEBHOOK_HEALTH_FAILED')
        // Only the unique insert winner creates CRM/jobs. The message sink is independently idempotent.
        if (!inserted.data) {
          if (event.category === 'dm') await forwardDmToSink(gateway, connection, event)
          if (isCommentCategory(event.category)) await forwardCommentToSink(gateway, connection, event, options)
          continue
        }

        const isInteractiveEvent = ['comment', 'reply', 'mention', 'dm'].includes(event.category)
        if (isInteractiveEvent) {
          const payloadRecord = asRecord(event.payload) ?? {}
          const text = typeof payloadRecord.text === 'string'
            ? payloadRecord.text
            : typeof payloadRecord.message === 'string'
              ? payloadRecord.message
              : ''

          // 1. Resolve linked marketing mission if post reference is present
          let linkedMissionId: string | null = null
          let linkedContentItemId: string | null = null

          if (event.providerPostReference && gateway.findMissionByPostReference) {
            try {
              const mRes = await gateway.findMissionByPostReference(connection.workspace_id, event.providerPostReference)
              if (mRes?.data) {
                linkedMissionId = mRes.data.id
                linkedContentItemId = mRes.data.content_id || null
              }
            } catch (mErr) {
              console.warn('[MetaWebhookEventStore] Non-fatal mission lookup notice:', mErr)
            }
          }

          // 2. Ingest customer conversation & classify intent + advance mission lifecycle
          const effectiveSubjectId = event.externalSubjectId || event.providerEventId
          if (gateway.recordCustomerConversation && effectiveSubjectId) {
            try {
              const fromObj = asRecord(payloadRecord.from)
              const senderObj = asRecord(payloadRecord.sender)
              const displayLabel =
                (typeof fromObj?.username === 'string' ? fromObj.username : null) ||
                (typeof senderObj?.id === 'string' ? senderObj.id : null) ||
                effectiveSubjectId

              await gateway.recordCustomerConversation({
                workspaceId: connection.workspace_id,
                channel: event.provider,
                externalSubjectId: effectiveSubjectId,
                displayLabel,
                messageText: text,
                relatedContentItemId: linkedContentItemId,
                missionId: linkedMissionId,
              })
            } catch (cErr) {
              console.warn('[MetaWebhookEventStore] Non-fatal customer conversation ingestion notice:', cErr)
            }
          }

          // 3. Queue responsive employee loop job
          if (gateway.insertResponseJob) {
            const riskEval = evaluateRiskPolicy({
              channel: event.provider,
              category: event.category === 'dm' ? 'dm' : 'comment',
              text,
            })

            const responseKind = event.provider === 'instagram'
              ? (event.category === 'dm' ? 'instagram_dm' : 'instagram_comment_reply')
              : 'threads_reply'

            const targetId = event.externalSubjectId || event.providerPostReference || event.providerEventId || 'unknown-target'
            const inboundEventId = inserted.data?.id || `evt-${event.eventKey}`

            await gateway.insertResponseJob({
              workspace_id: connection.workspace_id,
              channel_connection_id: connection.id,
              inbound_event_id: inboundEventId,
              response_kind: responseKind,
              external_target_id: targetId,
              status: riskEval.policyAction === 'AUTONOMOUS_ALLOWED' ? 'queued' : 'waiting_for_approval',
              draft_text: null,
              draft_fingerprint: null,
              idempotency_key: event.payloadSha256,
            })
          }
        }
        if (event.category === 'dm') {
          await forwardDmToSink(gateway, connection, event)
        }
        if (isCommentCategory(event.category)) {
          await forwardCommentToSink(gateway, connection, event, options)
        }
      }
    },
  })
}
