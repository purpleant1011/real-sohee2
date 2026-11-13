import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import type { ToolExecutionResult } from '@/features/tool-runtime/types'
import { redactAuditValue } from '@/features/operator-audit/redact-audit-value'
import { saveProposal } from './repository'
import { conversationKnowledgeRequestSchema, conversationKnowledgeSnapshotSchema, type ConversationKnowledgeRequest } from './conversation-knowledge-contract'

const uuid = z.string().uuid()
const scopeSchema = z.object({ workspaceId: uuid, userId: uuid, threadId: uuid, userMessageId: uuid, jobId: uuid })
const sourceSchema = z.object({ id: uuid, workspace_id: uuid, thread_id: uuid, role: z.literal('user'), status: z.literal('completed'), created_by_user_id: uuid })

/** Saves only the existing unapproved Studio proposal. Never confirms knowledge or changes a rule. */
export function createConversationKnowledgeProposer(input: {
  client: ServerSupabaseClient; workspaceId: string; userId: string; threadId: string; userMessageId: string; jobId: string
  authorize(): Promise<'owner' | 'manager' | null>
}) {
  const scope = scopeSchema.parse(input)
  const authorized = async () => {
    const role = await input.authorize()
    return role === 'owner' || role === 'manager'
  }
  return async (raw: ConversationKnowledgeRequest): Promise<ToolExecutionResult> => {
    const toolId = 'knowledge.propose'
    const failure = (code: string, message: string, status: 'BLOCKED' | 'FAILED' | 'RESULT_UNKNOWN' = 'BLOCKED'): ToolExecutionResult =>
      ({ success: false, toolId, status, error: { code, message } })
    const parsed = conversationKnowledgeRequestSchema.safeParse(raw)
    if (!parsed.success) return failure('MALFORMED_ARGUMENTS', '저장할 지식 후보의 주제와 내용을 확인해 주세요.')
    const { subject, factContent } = parsed.data
    const preview = `${subject} ${factContent}`.replace(/\s+/gu, ' ')
    if (redactAuditValue(preview) !== preview) return failure('KNOWLEDGE_SENSITIVE_CONTENT', '인증정보 등 민감한 내용은 지식 후보에 복사하지 않아요.')
    let writeStarted = false
    try {
      if (!await authorized()) return failure('UNAUTHORIZED_SCOPE', '지식 후보 저장은 현재 가게의 관리자 권한이 필요해요.')
      const read = await input.client.from('messages').select('id,workspace_id,thread_id,role,status,created_by_user_id')
        .eq('workspace_id', scope.workspaceId).eq('thread_id', scope.threadId).eq('id', scope.userMessageId).maybeSingle()
      const source = sourceSchema.safeParse(read.data)
      if (read.error || !source.success || source.data.id !== scope.userMessageId || source.data.workspace_id !== scope.workspaceId
        || source.data.thread_id !== scope.threadId || source.data.created_by_user_id !== scope.userId) {
        return failure('KNOWLEDGE_SOURCE_UNAVAILABLE', '현재 가게에서 지시한 원문을 확인하지 못해 저장하지 않았어요.')
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ subject, factContent })))
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
      if (!await authorized()) return failure('UNAUTHORIZED_SCOPE', '현재 저장 권한을 확인하지 못해 작업을 멈췄어요.')
      writeStarted = true
      const stored = await saveProposal({ workspaceId: scope.workspaceId, userId: scope.userId, sourceMessageId: scope.userMessageId,
        kind: 'fact', category: subject, content: factContent, idempotencyKey: `conversation:${scope.jobId}:knowledge:${hash}` }, input.client)
      if (stored.workspaceId !== scope.workspaceId || stored.sourceMessageId !== scope.userMessageId || stored.kind !== 'fact'
        || stored.category !== subject || stored.proposedContent !== factContent) throw new Error('KNOWLEDGE_WRITE_MISMATCH')
      if (!await authorized()) throw new Error('KNOWLEDGE_AUTHORITY_LOST')
      const data = conversationKnowledgeSnapshotSchema.parse({ kind: 'knowledge_proposal', workspaceId: scope.workspaceId,
        proposalId: stored.id, sourceMessageId: stored.sourceMessageId, category: stored.category, content: stored.proposedContent,
        status: stored.status, requiresUserApproval: true, href: '/app/sohee?tab=studio' })
      return { success: true, toolId, status: 'COMPLETED', data,
        logs: ['원본 대화에 연결된 지식 검토 기록을 확인했어요. 이 요청에서 확정·활성화하지 않았어요.'] }
    } catch {
      return writeStarted
        ? failure('KNOWLEDGE_PROPOSAL_RESULT_UNKNOWN', '후보 저장 결과를 확인 중이에요. 중복 생성하지 말고 지식 일지의 원본 기록을 확인해 주세요.', 'RESULT_UNKNOWN')
        : failure('KNOWLEDGE_PROPOSAL_UNAVAILABLE', '원문과 현재 권한을 확인하지 못해 후보를 저장하지 않았어요.', 'FAILED')
    }
  }
}
