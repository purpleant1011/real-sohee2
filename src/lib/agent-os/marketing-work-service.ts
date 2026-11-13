/**
 * Marketing WorkItem SSOT Service (ANI-1040)
 *
 * Promotes actionable marketing commands from chat/interview into durable,
 * workspace-scoped WorkItem rows (work_items table) before content generation.
 * Enforces idempotency per user turn (source_thread_id + source_message_id).
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { InteractionIntentMode } from './executors/interaction-executor'
import { isOperationalControlCommand } from '@/lib/ai/conversation-brain'

export interface CanonicalWorkItem {
  id: string
  workspace_id: string
  type: string
  title: string
  summary: string | null
  status: string
  priority: string
  owner_type: string
  owner_user_id: string | null
  due_at: string | null
  source_thread_id: string | null
  source_message_id: string | null
  content_item_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface EnsureMarketingWorkParams {
  workspaceId: string
  threadId: string
  messageId: string
  userPrompt: string
  actorId?: string
  client?: any
}

const MARKETING_INTENT_KEYWORDS = [
  '피드',
  '게시',
  '스토리',
  '콘텐츠',
  '원고',
  '홍보',
  '카피',
  '문구',
  '시안',
  '룩북',
  '인스타',
  '인스타그램',
  '쓰레드',
  '당근',
  '블로그',
  '이벤트',
  '프로모션',
  '작성',
  '만들어',
  '써줘',
  '올려줘',
  '발행',
  '제작',
]

const SMALL_TALK_EXACT_MATCHES = [
  '안녕',
  '안녕하세요',
  '반가워',
  '고마워',
  '고맙습니다',
  '감사합니다',
  '수고했어',
  '수고하셨습니다',
  '잘했어',
  '날씨',
]

/**
 * Checks if the user message is an actionable marketing command
 * that should be elevated to a durable WorkItem.
 */
export function shouldCreateWorkItem(userPrompt: string, intentMode?: InteractionIntentMode): boolean {
  const trimmed = userPrompt.trim()
  if (!trimmed) return false

  // 1. Filter out operational control commands
  if (isOperationalControlCommand(trimmed)) {
    return false
  }

  // 2. Filter out pure small talk
  const normalized = trimmed.replace(/[?!. ]/g, '')
  if (SMALL_TALK_EXACT_MATCHES.some(st => normalized === st)) {
    return false
  }

  // 3. Match marketing action keywords
  const hasMarketingKeyword = MARKETING_INTENT_KEYWORDS.some(kw => trimmed.includes(kw))
  const isActionIntent = intentMode === 'DRAFT' || intentMode === 'EXECUTE'

  return hasMarketingKeyword && isActionIntent
}

export class MarketingWorkService {
  /**
   * Resolves or creates a durable WorkItem for the current user command.
   * Idempotent per (workspaceId, threadId, messageId).
   */
  public static async ensureMarketingWorkItem(
    params: EnsureMarketingWorkParams
  ): Promise<{ workItem: CanonicalWorkItem; created: boolean }> {
    const { workspaceId, threadId, messageId, userPrompt, actorId } = params
    const supabase = params.client || (await createServerSupabaseClient())

    // 1. Idempotency Check: Existing WorkItem for this turn
    const existing = await supabase
      .from('work_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('source_thread_id', threadId)
      .eq('source_message_id', messageId)
      .eq('type', 'content')
      .limit(1)
      .maybeSingle()

    if (existing?.data) {
      return {
        workItem: existing.data as CanonicalWorkItem,
        created: false,
      }
    }

    // 2. Resolve Valid Actor UUID (created_by)
    let effectiveActorId = actorId
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveActorId || '')

    if (!isUuid) {
      try {
        const memberRes = await supabase
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', workspaceId)
          .in('role', ['owner', 'manager'])
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (memberRes?.data?.user_id) {
          effectiveActorId = memberRes.data.user_id
        }
      } catch {
        // Continue to fallback
      }
    }

    if (!effectiveActorId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(effectiveActorId)) {
      effectiveActorId = '00000000-0000-0000-0000-000000000000'
    }

    // 3. Derive Clean Work Title
    const truncatedPrompt = userPrompt.length > 35 ? `${userPrompt.slice(0, 35)}...` : userPrompt
    const title = `마케팅 콘텐츠 작성: ${truncatedPrompt}`

    const insertPayload = {
      workspace_id: workspaceId,
      type: 'content',
      title,
      summary: userPrompt,
      status: 'drafting',
      priority: 'normal',
      owner_type: 'sohee',
      source_thread_id: threadId,
      source_message_id: messageId,
      content_item_id: null,
      created_by: effectiveActorId,
    }

    const inserted = await supabase
      .from('work_items')
      .insert(insertPayload)
      .select('*')
      .single()

    if (inserted.error || !inserted.data) {
      throw new Error(`Failed to create marketing work_item: ${inserted.error?.message || 'unknown error'}`)
    }

    return {
      workItem: inserted.data as CanonicalWorkItem,
      created: true,
    }
  }

  /**
   * Links a created Canonical ContentItem to the WorkItem, updating its status.
   */
  public static async linkContentToWorkItem(params: {
    workspaceId: string
    workItemId: string
    contentItemId: string
    status?: string
    client?: any
  }): Promise<void> {
    const { workspaceId, workItemId, contentItemId, status = 'review_required' } = params
    const supabase = params.client || (await createServerSupabaseClient())

    await supabase
      .from('work_items')
      .update({
        content_item_id: contentItemId,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', workItemId)
  }
}
