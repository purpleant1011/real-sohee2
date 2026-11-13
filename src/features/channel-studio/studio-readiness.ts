import { hasUsableFacts } from './generate'
import { createSupabaseKnowledgeGateway, loadGroundedBusinessContext } from './knowledge-context'
import { ChannelDraftError } from './types'

export type StudioReadiness =
  | { state: 'ready' }
  | { state: 'missing' }
  | { state: 'error'; message: string }

/** Uses the exact loader and fact rule that generation uses. A read failure is never reported as 'missing'. */
export async function getStudioReadiness(client: unknown, workspaceId: string): Promise<StudioReadiness> {
  try {
    const ctx = await loadGroundedBusinessContext(workspaceId, createSupabaseKnowledgeGateway(client))
    return hasUsableFacts(ctx) ? { state: 'ready' } : { state: 'missing' }
  } catch (error) {
    if (error instanceof ChannelDraftError && error.code === 'KNOWLEDGE_MISSING') return { state: 'missing' }
    return { state: 'error', message: '가게 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }
  }
}
