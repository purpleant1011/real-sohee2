import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { HarnessRule, KnowledgeFact } from './types'

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const harnessRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    rule_key: z.string().min(2).max(80),
    rule_type: z.string().min(1).max(120),
    title: z.string().min(1).max(200),
    description: z.string().max(4_000).nullable(),
    structured_rule: z.record(z.string(), z.unknown()),
    applies_to_channels: z.array(z.enum(['instagram', 'threads', 'naver_blog', 'naver_place'])),
    status: z.literal('active'),
    version: z.number().int().positive(),
    approved_by_user_id: uuidSchema,
    approved_at: timestampSchema,
  })
  .strict()
const factRowSchema = z
  .object({
    id: uuidSchema,
    workspace_id: uuidSchema,
    category: z.string().min(1).max(120),
    content: z.string().min(1).max(12_000),
    status: z.literal('active'),
    source_candidate_id: uuidSchema,
    approved_at: timestampSchema,
    valid_from: timestampSchema,
    valid_until: timestampSchema.nullable(),
  })
  .strict()

export async function listActiveHarnessRules(input: {
  client: ServerSupabaseClient
  workspaceId: string
}): Promise<readonly HarnessRule[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const result = await input.client
    .from('harness_rules')
    .select(
      'id, workspace_id, rule_key, rule_type, title, description, structured_rule, applies_to_channels, status, version, approved_by_user_id, approved_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('rule_key', { ascending: true })
  const rows = z.array(harnessRowSchema).safeParse(result.data)
  if (
    result.error ||
    !rows.success ||
    rows.data.some((row) => row.workspace_id !== workspaceId)
  ) {
    throw new Error('active_harness_rules_unavailable')
  }

  return Object.freeze(
    rows.data.map((row) =>
      Object.freeze({
        id: row.id,
        workspaceId: row.workspace_id,
        ruleKey: row.rule_key,
        ruleType: row.rule_type,
        title: row.title,
        description: row.description,
        structuredRule: Object.freeze({ ...row.structured_rule }),
        appliesToChannels: Object.freeze([...row.applies_to_channels]),
        status: row.status,
        version: row.version,
        approvedByUserId: row.approved_by_user_id,
        approvedAt: row.approved_at,
      }),
    ),
  )
}

export async function listApprovedKnowledgeFacts(input: {
  client: ServerSupabaseClient
  workspaceId: string
}): Promise<readonly KnowledgeFact[]> {
  const workspaceId = uuidSchema.parse(input.workspaceId)

  // Channel Learning Grounding (ANI-2206)
  if (process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1' && typeof (input.client as any)?.rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (input.client as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId,
        p_purpose: 'content',
        p_max_facts: 100,
        p_query: '',
      })
      if (!rpcError && rpcData) {
        const items = Array.isArray(rpcData.items) ? rpcData.items : Array.isArray(rpcData) ? rpcData : []
        const now = new Date().toISOString()
        return Object.freeze(
          items.map((item: any) =>
            Object.freeze({
              id: item.id,
              workspaceId,
              category: item.category,
              content: item.content,
              status: 'active' as const,
              sourceCandidateId: item.source_candidate_id || item.id,
              approvedAt: item.created_at || now,
              validFrom: item.created_at || now,
              validUntil: null,
            })
          )
        )
      }
    } catch {
      // safe fallback to table query
    }
  }

  const result = await input.client
    .from('knowledge_facts')
    .select(
      'id, workspace_id, category, content, status, source_candidate_id, approved_at, valid_from, valid_until',
    )
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('approved_at', { ascending: false })
  const rows = z.array(factRowSchema).safeParse(result.data)
  if (
    result.error ||
    !rows.success ||
    rows.data.some((row) => row.workspace_id !== workspaceId)
  ) {
    throw new Error('approved_knowledge_facts_unavailable')
  }

  return Object.freeze(
    rows.data.map((row) =>
      Object.freeze({
        id: row.id,
        workspaceId: row.workspace_id,
        category: row.category,
        content: row.content,
        status: row.status,
        sourceCandidateId: row.source_candidate_id,
        approvedAt: row.approved_at,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
      }),
    ),
  )
}
