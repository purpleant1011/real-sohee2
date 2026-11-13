import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { OperationEvent, OperationEventType } from './event-schema'

export type ServerSupabaseClient = SupabaseClient<Database>

export type WorkItemType =
  | 'content'
  | 'customer_followup'
  | 'knowledge_review'
  | 'recovery'
  | 'campaign'
  | 'report_review'

export type WorkItemStatus =
  | 'idea'
  | 'researching'
  | 'drafting'
  | 'review_required'
  | 'revision_requested'
  | 'revising'
  | 'approved'
  | 'schedule_required'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'blocked'
  | 'publish_failed'
  | 'recovery_required'
  | 'cancelled'
  | 'archived'

export type WorkItem = Readonly<{
  id: string
  workspaceId: string
  type: WorkItemType
  title: string
  summary: string | null
  status: WorkItemStatus
  priority: 'low' | 'normal' | 'high' | 'urgent'
  ownerType: 'sohee' | 'user' | 'shared'
  ownerUserId: string | null
  dueAt: string | null
  sourceThreadId: string | null
  sourceMessageId: string | null
  contentItemId: string | null
  createdAt: string
  updatedAt: string
}>

export type WorkItemPage = Readonly<{
  items: readonly WorkItem[]
  total: number
}>

export type { OperationEvent, OperationEventType }
