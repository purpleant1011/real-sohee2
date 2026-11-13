import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InstagramDmAudit,
  InstagramDmDirectionOption,
  InstagramDmDraft,
  InstagramDmMessage,
  InstagramDmStatus,
  InstagramDmThread,
} from './types'

export interface InstagramDmRepository {
  findThreadById(workspaceId: string, threadId: string): Promise<InstagramDmThread | null>
  listThreads(
    workspaceId: string,
    options?: {
      status?: InstagramDmStatus
      limit?: number
      cursor?: string
      strict?: boolean
      readOnly?: boolean
    }
  ): Promise<{ threads: InstagramDmThread[]; nextCursor?: string }>
  updateThreadStatus(
    workspaceId: string,
    threadId: string,
    status: InstagramDmStatus
  ): Promise<void>
  listMessages(workspaceId: string, threadId: string): Promise<InstagramDmMessage[]>
  insertMessage(
    message: Omit<InstagramDmMessage, 'id' | 'created_at'>
  ): Promise<InstagramDmMessage>
  upsertThread(
    thread: Omit<InstagramDmThread, 'id' | 'created_at' | 'updated_at'>
  ): Promise<InstagramDmThread>
  findThreadByProviderThreadId(
    workspaceId: string,
    providerThreadId: string
  ): Promise<InstagramDmThread | null>
  insertMessageIfAbsent(
    message: Omit<InstagramDmMessage, 'id' | 'created_at'>
  ): Promise<{ inserted: boolean }>
  findExistingProviderMessageIds(
    workspaceId: string,
    providerMessageIds: readonly string[]
  ): Promise<Set<string>>
  latestThreadActivityAt(workspaceId: string, channelConnectionId: string): Promise<string | null>
  findDraftByThreadId(workspaceId: string, threadId: string): Promise<InstagramDmDraft | null>
  saveDraft(
    workspaceId: string,
    threadId: string,
    options: InstagramDmDirectionOption[],
    selectedOptionId: string | null,
    draftText: string,
    approvedFingerprint?: string | null,
    writeOptions?: { ifAbsent?: boolean }
  ): Promise<InstagramDmDraft>
  updateDraft(
    workspaceId: string,
    threadId: string,
    draftText: string,
    selectedOptionId?: string | null,
    expectedUpdatedAt?: string
  ): Promise<InstagramDmDraft>
  approveDraft(
    workspaceId: string,
    threadId: string,
    fingerprint: string,
    approvedBy: string
  ): Promise<InstagramDmDraft>
  /**
   * Returns whether the audit row was durably written instead of throwing: callers such as
   * draft/dismiss routes have already committed their primary mutation, so an audit outage
   * must not be reported to the client as a failed operation.
   */
  recordAudit(audit: Omit<InstagramDmAudit, 'id' | 'created_at'>): Promise<{ recorded: boolean }>
}

export class SupabaseInstagramDmRepository implements InstagramDmRepository {
  constructor(public readonly client: SupabaseClient) {}

  async findThreadById(workspaceId: string, threadId: string): Promise<InstagramDmThread | null> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_threads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', threadId)
      .maybeSingle()

    if (error || !data) return null
    return data as InstagramDmThread
  }

  async listThreads(
    workspaceId: string,
    options?: {
      status?: InstagramDmStatus
      limit?: number
      cursor?: string
      strict?: boolean
      readOnly?: boolean
    }
  ): Promise<{ threads: InstagramDmThread[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100)
    let query = (this.client as any)
      .from('instagram_dm_threads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1)

    if (options?.status) {
      query = query.eq('status', options.status)
    }
    if (options?.cursor) {
      query = query.lt('last_message_at', options.cursor)
    }

    const { data, error } = await query
    if (error || !Array.isArray(data)) {
      if (options?.strict) throw new Error('DM_THREADS_READ_UNAVAILABLE')
      return { threads: [] }
    }
    if (options?.strict && data.some(row => row.workspace_id !== workspaceId)) throw new Error('DM_THREADS_SCOPE_MISMATCH')

    const rows = data as InstagramDmThread[]
    let nextCursor: string | undefined
    if (rows.length > limit) {
      const extra = rows.pop()!
      nextCursor = extra.last_message_at
    }

    // Auto-check 24h window expiration for NEEDS_REPLY threads
    const now = new Date()
    for (const thread of rows) {
      if (!options?.readOnly && thread.status === 'NEEDS_REPLY') {
        const expiresAt = new Date(thread.expires_at)
        if (now.getTime() >= expiresAt.getTime()) {
          thread.status = 'EXPIRED'
          // Async update in background
          void (this.client as any)
            .from('instagram_dm_threads')
            .update({ status: 'EXPIRED', updated_at: now.toISOString() })
            .eq('workspace_id', workspaceId)
            .eq('id', thread.id)
        }
      }
    }

    return { threads: rows, nextCursor }
  }

  async updateThreadStatus(
    workspaceId: string,
    threadId: string,
    status: InstagramDmStatus
  ): Promise<void> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_threads')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', threadId)
      .select('id')

    if (error || !Array.isArray(data) || data.length === 0) {
      throw new Error(`대화 상태 변경에 실패했거나 대상을 찾을 수 없습니다: ${error?.message || '0 rows affected'}`)
    }
  }

  async listMessages(workspaceId: string, threadId: string): Promise<InstagramDmMessage[]> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_messages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true })

    if (error || !data) return []
    return data as InstagramDmMessage[]
  }

  async insertMessage(
    message: Omit<InstagramDmMessage, 'id' | 'created_at'>
  ): Promise<InstagramDmMessage> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_messages')
      .insert({
        workspace_id: message.workspace_id,
        thread_id: message.thread_id,
        provider_message_id: message.provider_message_id,
        sender_type: message.sender_type,
        sender_id: message.sender_id,
        text: message.text,
        sent_at: message.sent_at,
      })
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`메시지 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as InstagramDmMessage
  }

  async findThreadByProviderThreadId(
    workspaceId: string,
    providerThreadId: string
  ): Promise<InstagramDmThread | null> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_threads')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('provider_thread_id', providerThreadId)
      .maybeSingle()

    if (error || !data) return null
    return data as InstagramDmThread
  }

  async insertMessageIfAbsent(
    message: Omit<InstagramDmMessage, 'id' | 'created_at'>
  ): Promise<{ inserted: boolean }> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_messages')
      .upsert(
        {
          workspace_id: message.workspace_id,
          thread_id: message.thread_id,
          provider_message_id: message.provider_message_id,
          sender_type: message.sender_type,
          sender_id: message.sender_id,
          text: message.text,
          sent_at: message.sent_at,
        },
        { onConflict: 'workspace_id,provider_message_id', ignoreDuplicates: true }
      )
      .select('id')

    if (error) {
      throw new Error(`메시지 저장에 실패했습니다: ${error.message || '알 수 없는 오류'}`)
    }
    return { inserted: Array.isArray(data) && data.length > 0 }
  }

  async findExistingProviderMessageIds(
    workspaceId: string,
    providerMessageIds: readonly string[]
  ): Promise<Set<string>> {
    if (providerMessageIds.length === 0) return new Set()
    const { data, error } = await (this.client as any)
      .from('instagram_dm_messages')
      .select('provider_message_id')
      .eq('workspace_id', workspaceId)
      .in('provider_message_id', [...providerMessageIds])

    if (error || !Array.isArray(data)) return new Set()
    return new Set(data.map((row: { provider_message_id: string }) => row.provider_message_id))
  }

  async latestThreadActivityAt(
    workspaceId: string,
    channelConnectionId: string
  ): Promise<string | null> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_threads')
      .select('last_message_at')
      .eq('workspace_id', workspaceId)
      .eq('channel_connection_id', channelConnectionId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    return (data as { last_message_at: string }).last_message_at
  }

  async upsertThread(
    thread: Omit<InstagramDmThread, 'id' | 'created_at' | 'updated_at'>
  ): Promise<InstagramDmThread> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_threads')
      .upsert(
        {
          workspace_id: thread.workspace_id,
          channel_connection_id: thread.channel_connection_id,
          channel: 'instagram',
          provider_thread_id: thread.provider_thread_id,
          customer_id: thread.customer_id,
          customer_handle: thread.customer_handle,
          customer_name: thread.customer_name,
          last_message_at: thread.last_message_at,
          expires_at: thread.expires_at,
          status: thread.status,
          last_message_text: thread.last_message_text,
        },
        {
          onConflict: 'workspace_id,provider_thread_id',
        }
      )
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`대화 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as InstagramDmThread
  }

  async findDraftByThreadId(
    workspaceId: string,
    threadId: string
  ): Promise<InstagramDmDraft | null> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_drafts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('thread_id', threadId)
      .maybeSingle()

    if (error || !data) return null
    return data as InstagramDmDraft
  }

  async saveDraft(
    workspaceId: string,
    threadId: string,
    options: InstagramDmDirectionOption[],
    selectedOptionId: string | null,
    draftText: string,
    approvedFingerprint?: string | null,
    writeOptions?: { ifAbsent?: boolean }
  ): Promise<InstagramDmDraft> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_drafts')
      .upsert(
        {
          workspace_id: workspaceId,
          thread_id: threadId,
          options,
          selected_option_id: selectedOptionId,
          draft_text: draftText,
          approved_fingerprint: approvedFingerprint ?? null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'workspace_id,thread_id',
          ...(writeOptions?.ifAbsent ? { ignoreDuplicates: true } : {}),
        }
      )
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`답장 초안 저장에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as InstagramDmDraft
  }

  async updateDraft(
    workspaceId: string,
    threadId: string,
    draftText: string,
    selectedOptionId?: string | null,
    expectedUpdatedAt?: string
  ): Promise<InstagramDmDraft> {
    const updatePayload: Record<string, unknown> = {
      draft_text: draftText,
      // Any text update invalidates prior approval
      approved_fingerprint: null,
      approved_by: null,
      approved_at: null,
      updated_at: new Date().toISOString(),
    }
    if (selectedOptionId !== undefined) {
      updatePayload.selected_option_id = selectedOptionId
    }

    let query = (this.client as any)
      .from('instagram_dm_drafts')
      .update(updatePayload)
      .eq('workspace_id', workspaceId)
      .eq('thread_id', threadId)
    if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt)
    const { data, error } = await query.select('*').single()

    if (error || !data) {
      throw new Error(`답장 문안 수정에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as InstagramDmDraft
  }

  async approveDraft(
    workspaceId: string,
    threadId: string,
    fingerprint: string,
    approvedBy: string
  ): Promise<InstagramDmDraft> {
    const { data, error } = await (this.client as any)
      .from('instagram_dm_drafts')
      .update({
        approved_fingerprint: fingerprint,
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('thread_id', threadId)
      .select('*')
      .single()

    if (error || !data) {
      throw new Error(`답장 초안 승인에 실패했습니다: ${error?.message || '알 수 없는 오류'}`)
    }
    return data as InstagramDmDraft
  }

  async recordAudit(audit: Omit<InstagramDmAudit, 'id' | 'created_at'>): Promise<{ recorded: boolean }> {
    const { error } = await (this.client as any)
      .from('instagram_dm_audit')
      .insert({
        workspace_id: audit.workspace_id,
        thread_id: audit.thread_id,
        actor: audit.actor,
        actor_user_id: audit.actor_user_id,
        action: audit.action,
        provider_message_id: audit.provider_message_id,
        readback_verified: audit.readback_verified,
        details: audit.details || {},
      })

    if (error) {
      console.error('[SupabaseInstagramDmRepository] Failed to record audit log:', error)
      return { recorded: false }
    }
    return { recorded: true }
  }
}
