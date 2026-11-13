import { DM_POLICY_WINDOW_HOURS } from './constants'
import type { InstagramDmRepository } from './repository'
import type { InstagramDmMessage, InstagramDmStatus, InstagramDmThread } from './types'

export const DM_NON_TEXT_PLACEHOLDER = '[텍스트가 아닌 메시지입니다]'
const DM_MAX_STORED_TEXT = 4000
const WINDOW_MS = DM_POLICY_WINDOW_HOURS * 3_600_000
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export type DmIngestRepository = Pick<
  InstagramDmRepository,
  'findThreadByProviderThreadId' | 'upsertThread' | 'insertMessageIfAbsent' | 'listMessages'
>

export type IngestHook = (params: {
  workspaceId: string
  threadId: string
  message: InstagramDmMessage
}) => Promise<void>

export interface IngestDmMessageInput {
  workspaceId: string
  channelConnectionId: string
  /** Instagram professional account id of the connected business. */
  businessIgId: string
  /** Provider message id (webhook `message.mid` / conversations API message id). */
  mid: string
  fromId: string
  toId: string
  fromUsername?: string | null
  text?: string | null
  /** ISO-8601 timestamp the message was created. */
  createdAt: string
  isEcho?: boolean
  isSelf?: boolean
  isDeleted?: boolean
}

export type IngestDmResult =
  | { status: 'ingested'; threadId: string }
  | { status: 'duplicate'; threadId: string }
  | { status: 'ignored'; reason: string }

export function dmProviderThreadId(businessIgId: string, customerId: string): string {
  return `${businessIgId}:${customerId}`
}

export function sanitizeDmText(text: string | null | undefined): string {
  const cleaned = (text ?? '').replace(CONTROL_CHARS, '').trim()
  if (!cleaned) return DM_NON_TEXT_PLACEHOLDER
  return cleaned.length > DM_MAX_STORED_TEXT ? cleaned.slice(0, DM_MAX_STORED_TEXT) : cleaned
}

interface DerivedThreadState {
  status: InstagramDmStatus
  lastMessageAt: string
  lastMessageText: string
  expiresAt: string
}

/**
 * Pure: recompute the thread state from its stored messages so redelivery, out-of-order
 * arrival and webhook/polling races all converge to the same result.
 */
export function deriveThreadState(
  messages: readonly InstagramDmMessage[],
  existing: Pick<InstagramDmThread, 'status' | 'last_message_at'> | null,
  now: Date,
): DerivedThreadState {
  const sorted = [...messages].sort((a, b) => a.sent_at.localeCompare(b.sent_at))
  const last = sorted[sorted.length - 1]
  const lastCustomer = [...sorted].reverse().find((m) => m.sender_type === 'customer')
  const anchor = lastCustomer?.sent_at ?? last.sent_at
  const expiresAt = new Date(Date.parse(anchor) + WINDOW_MS).toISOString()
  const windowClosed = Date.parse(expiresAt) <= now.getTime()
  const previousLastAt = existing?.last_message_at ?? ''

  let status: InstagramDmStatus
  // NEEDS_CHECK is a durable reconciliation quarantine. It is set when an outbound send could not
  // be fully settled locally (ledger/audit/message write failed), and it is the only durable
  // marker of that fact. A provider echo proves delivery — not that those local writes were
  // repaired — so ingestion must never clear it. Only an explicit reconciliation may.
  if (existing?.status === 'NEEDS_CHECK') {
    status = 'NEEDS_CHECK'
  } else if (last.sender_type === 'business') {
    status = 'SENT'
  } else if (existing?.status === 'DISMISSED' && previousLastAt >= last.sent_at) {
    status = 'DISMISSED'
  } else if (windowClosed) {
    status = 'EXPIRED'
  } else {
    status = 'NEEDS_REPLY'
  }

  return { status, lastMessageAt: last.sent_at, lastMessageText: last.text, expiresAt }
}

export async function ingestDmMessage(
  input: IngestDmMessageInput,
  repo: DmIngestRepository,
  now: Date = new Date(),
  hook?: IngestHook,
): Promise<IngestDmResult> {
  if (input.isSelf) return { status: 'ignored', reason: 'self_test_message' }
  if (input.isDeleted) return { status: 'ignored', reason: 'deleted_message' }
  if (!input.mid) return { status: 'ignored', reason: 'missing_message_id' }

  const sentAtMs = Date.parse(input.createdAt)
  if (!Number.isFinite(sentAtMs)) return { status: 'ignored', reason: 'invalid_timestamp' }
  const sentAt = new Date(sentAtMs).toISOString()

  const fromBusiness = input.isEcho === true || input.fromId === input.businessIgId
  const customerId = fromBusiness ? input.toId : input.fromId
  const involvesBusiness = fromBusiness
    ? input.fromId === input.businessIgId || input.isEcho === true
    : input.toId === input.businessIgId
  if (!customerId || customerId === input.businessIgId || !involvesBusiness) {
    return { status: 'ignored', reason: 'unrelated_participants' }
  }

  const providerThreadId = dmProviderThreadId(input.businessIgId, customerId)
  const existing = await repo.findThreadByProviderThreadId(input.workspaceId, providerThreadId)
  const knownUsername = !fromBusiness && input.fromUsername ? input.fromUsername : null
  const handle = knownUsername
    ?? (existing && existing.customer_handle !== existing.customer_id ? existing.customer_handle : customerId)
  const text = sanitizeDmText(input.text)

  // Ensure the thread row exists (FK target) with provisional values; recomputed below.
  const thread = existing ?? await repo.upsertThread({
    workspace_id: input.workspaceId,
    channel_connection_id: input.channelConnectionId,
    channel: 'instagram',
    provider_thread_id: providerThreadId,
    customer_id: customerId,
    customer_handle: handle,
    customer_name: null,
    last_message_at: sentAt,
    expires_at: new Date(sentAtMs + WINDOW_MS).toISOString(),
    status: 'NEEDS_REPLY',
    last_message_text: text,
  })

  const { inserted } = await repo.insertMessageIfAbsent({
    workspace_id: input.workspaceId,
    thread_id: thread.id,
    provider_message_id: input.mid,
    sender_type: fromBusiness ? 'business' : 'customer',
    sender_id: fromBusiness ? input.businessIgId : customerId,
    text,
    sent_at: sentAt,
  })

  const messages = await repo.listMessages(input.workspaceId, thread.id)
  if (messages.length > 0) {
    const derived = deriveThreadState(messages, existing, now)
    await repo.upsertThread({
      workspace_id: input.workspaceId,
      channel_connection_id: thread.channel_connection_id,
      channel: 'instagram',
      provider_thread_id: providerThreadId,
      customer_id: customerId,
      customer_handle: handle,
      customer_name: thread.customer_name,
      last_message_at: derived.lastMessageAt,
      expires_at: derived.expiresAt,
      status: derived.status,
      last_message_text: derived.lastMessageText,
    })
  }

  if (inserted && hook) {
    const insertedMsg = messages.find((m) => m.provider_message_id === input.mid)
    if (insertedMsg) {
      await hook({
        workspaceId: input.workspaceId,
        threadId: thread.id,
        message: insertedMsg,
      }).catch((err) => {
        console.error('[ingestDmMessage] Post-ingest hook error:', err)
      })
    }
  }

  return { status: inserted ? 'ingested' : 'duplicate', threadId: thread.id }
}
