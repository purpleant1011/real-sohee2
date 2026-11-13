import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GroundedBusinessContext } from '@/features/channel-studio/types'
import { generatePlannedContent, selectNextTheme } from './theme-generator'
import type { PlannedContentItem, PlannerThemeKey } from './types'

export interface CalculateSlotsParams {
  baseDate: Date
  count?: number
  targetDays?: number[] // default [2, 4, 6] (Tue, Thu, Sat)
  targetHour?: number // default 19
}

export interface PersistPlannedItemOptions {
  workspaceId: string
  item: PlannedContentItem
  actorUserId?: string
  approved?: boolean
  channelConnectionId?: string
}

export interface PersistPlannedItemResult {
  success: boolean
  id?: string
  versionId?: string
  isDuplicate?: boolean
  scheduleId?: string
  error?: string
}

export class AutonomousPlannerService {
  constructor(private readonly client: SupabaseClient | any) {}

  calculateUpcomingSlots(params: CalculateSlotsParams): Date[] {
    const { baseDate, count = 3, targetDays = [2, 4, 6], targetHour = 19 } = params
    const slots: Date[] = []
    const cursor = new Date(baseDate)

    while (slots.length < count) {
      cursor.setDate(cursor.getDate() + 1)
      if (targetDays.includes(cursor.getDay())) {
        const slot = new Date(cursor)
        slot.setHours(targetHour, 0, 0, 0)
        slots.push(slot)
      }
    }

    return slots
  }

  async planUpcomingPosts(params: {
    workspaceId: string
    context: GroundedBusinessContext
    count?: number
    now?: Date
    tone?: 'witty' | 'polite' | 'friendly'
  }): Promise<PlannedContentItem[]> {
    const { workspaceId, context, count = 3, now = new Date(), tone = 'friendly' } = params
    const slots = this.calculateUpcomingSlots({ baseDate: now, count })

    const plannedItems: PlannedContentItem[] = []
    const usedThemes: PlannerThemeKey[] = []

    for (const slot of slots) {
      const theme = selectNextTheme(usedThemes)
      usedThemes.push(theme)

      const item = generatePlannedContent({
        theme,
        context,
        tone,
        scheduledSlot: slot.toISOString(),
      })
      plannedItems.push(item)
    }

    return plannedItems
  }

  /**
   * Computes a tenant composite idempotency key for a planned slot item.
   */
  public computeSlotIdempotencyKey(workspaceId: string, item: PlannedContentItem): string {
    return createHash('sha256')
      .update(`${workspaceId}:${item.scheduledSlot}:${item.themeTitle}:instagram`)
      .digest('hex')
  }

  /**
   * Persists planned content items into vault storage for autonomous posting.
   * Enforces:
   * 1. Unapproved plans are saved strictly as unapproved 'draft' status with content_versions via atomic RPC.
   * 2. Atomic duplicate prevention across tenant composite scope (workspaceId + slot + theme).
   * 3. No synthetic rights_confirmed or automatic approvals without explicit user context.
   * 4. Fail-closed: Direct non-atomic insertion fallback is strictly prohibited to guarantee race-free deduplication.
   */
  async persistPlannedItem(params: PersistPlannedItemOptions): Promise<PersistPlannedItemResult> {
    const { workspaceId, item, actorUserId } = params
    if (!actorUserId) {
      return { success: false, error: 'ACTOR_USER_REQUIRED' }
    }

    if (typeof this.client?.rpc !== 'function') {
      // Direct insertion without atomic lock and idempotency fence is strictly forbidden (fail-closed)
      return { success: false, error: 'ATOMIC_RPC_UNAVAILABLE' }
    }

    const slotKey = this.computeSlotIdempotencyKey(workspaceId, item)
    const caption = item.instagramCaption || item.threadsText || item.themeTitle
    const fingerprint = createHash('sha256')
      .update(`${item.themeTitle}:${caption}:${(item.hashtags || []).join(',')}`)
      .digest('hex')

    try {
      const rpcRes = await this.client.rpc('persist_planned_content_draft', {
        p_workspace_id: workspaceId,
        p_title: item.themeTitle,
        p_channel: 'instagram',
        p_caption: caption,
        p_hashtags: item.hashtags || [],
        p_slot_time: item.scheduledSlot,
        p_slot_idempotency_key: slotKey,
        p_fingerprint: fingerprint,
        p_actor_user_id: actorUserId,
      })

      if (rpcRes.error || !rpcRes.data) {
        console.error('[autonomous-planner] persist_planned_content_draft RPC failed:', rpcRes.error)
        return { success: false, error: rpcRes.error?.message || 'RPC_FAILED' }
      }

      const data = rpcRes.data as any
      if (data.is_duplicate) {
        return { success: true, id: data.content_id, isDuplicate: true }
      }

      return {
        success: true,
        id: data.content_id,
        versionId: data.version_id,
        isDuplicate: false,
      }
    } catch (err: any) {
      console.error('[autonomous-planner] persistPlannedItem exception:', err)
      return { success: false, error: err?.message || 'INTERNAL_ERROR' }
    }
  }
}
