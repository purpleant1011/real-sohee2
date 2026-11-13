import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { listActiveHarnessRules, listApprovedKnowledgeFacts } from '@/features/harness/repository'
import { listGoals } from '@/features/sohee-studio/repository'
import { buildSoheeContext, type SoheeContextBundle } from './context-builder'
import { listConversationMessages } from './repository'
import { loadWorkspaceBusinessContext } from './workspace-business-context.server'
import { loadKnowledgeJournal } from '@/features/sohee-studio/knowledge-journal.server'

const uuidSchema = z.string().uuid()

/**
 * 대화 컨텍스트 로더 (Service-Role Read 계약)
 * - sohee_goals 테이블을 포함한 워크스페이스 컨텍스트는 service-role 클라이언트(createAdminSupabaseClient)를 통해 조회됩니다.
 * - 호출자(messages/route.ts 등)는 반드시 service-role 권한 클라이언트를 주입해야 합니다.
 */
export async function loadSoheeContext(input: {
  client: ServerSupabaseClient
  workspaceId: string
  threadId: string
  strict?: boolean
}): Promise<SoheeContextBundle> {
  const workspaceId = uuidSchema.parse(input.workspaceId)
  const threadId = uuidSchema.parse(input.threadId)

  const [workspace, facts, rules, work, schedules, messages, activeGoals, businessContext, knowledgeJournal] = await Promise.all([
    input.client.from('workspaces').select('id, name, timezone').eq('id', workspaceId).single(),
    listApprovedKnowledgeFacts({ client: input.client, workspaceId }),
    listActiveHarnessRules({ client: input.client, workspaceId }),
    input.client.from('work_items')
      .select('id, workspace_id, title, summary, status, priority, due_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(100),
    input.client.from('schedules')
      .select('id, workspace_id, content_id, publish_at, timezone, status')
      .eq('workspace_id', workspaceId)
      .order('publish_at', { ascending: true })
      .limit(100),
    listConversationMessages({ client: input.client, workspaceId, threadId, limit: 30 }),
    listGoals(workspaceId, { status: 'active' }, input.client).catch(error => { if (input.strict) throw error; return [] }),
    loadWorkspaceBusinessContext({ client: input.client, workspaceId }),
    loadKnowledgeJournal({ client: input.client, workspaceId, limit: 12 }),
  ])

  const workRows = work.data
  const scheduleRows = schedules.data
  if (workspace.error || !workspace.data || work.error || schedules.error
    || !Array.isArray(workRows) || !Array.isArray(scheduleRows)) {
    throw new Error('chat_context_unavailable')
  }

  return buildSoheeContext({
    workspace: workspace.data,
    businessContext,
    knowledgeJournal,
    threadId,
    knowledgeFacts: facts.map((fact) => ({
      id: fact.id,
      workspaceId: fact.workspaceId,
      category: fact.category,
      content: fact.content,
      status: fact.status,
      validFrom: fact.validFrom,
      validUntil: fact.validUntil,
    })),
    harnessRules: rules.map((rule) => ({
      id: rule.id,
      workspaceId: rule.workspaceId,
      ruleKey: rule.ruleKey,
      title: rule.title,
      description: rule.description,
      status: rule.status,
      version: rule.version,
    })),
    workItems: workRows.map((item) => ({
      id: item.id,
      workspaceId: item.workspace_id,
      title: item.title,
      summary: item.summary,
      status: item.status,
      priority: item.priority,
      dueAt: item.due_at,
    })),
    schedules: scheduleRows.map((schedule) => ({
      id: schedule.id,
      workspaceId: schedule.workspace_id,
      contentId: schedule.content_id,
      publishAt: schedule.publish_at,
      timezone: schedule.timezone,
      status: schedule.status,
    })),
    recentMessages: messages.map(message => ({
      id: message.id, workspaceId: message.workspaceId, threadId: message.threadId, role: message.role,
      content: message.content, status: message.status, workItemId: message.workItemId,
      createdAt: message.createdAt, completedAt: message.completedAt,
      ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
      ...(message.clarification ? { clarification: message.clarification } : {}),
      ...(message.artifact ? { artifact: message.artifact } : {}),
      ...(message.artifacts ? { artifacts: message.artifacts } : {}),
    })),
    activeGoals: activeGoals.slice(0, 20).map((goal) => ({
      id: goal.id,
      workspaceId: goal.workspaceId,
      title: goal.title,
      desiredOutcome: goal.desiredOutcome,
      priority: goal.priority,
      status: goal.status,
    })),
  })
}
