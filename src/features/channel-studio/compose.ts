import { createGeminiTextGenerator } from '@/features/vault/transform/adapters/gemini'
import { buildBaseDraft } from './base-draft'
import { checkBusinessClaims } from './claim-guard'
import { generateChannelDraft } from './generate'
import { editChannelDraftVariant } from './edit'
import { maybeGenerateStudioImage } from './image-option'
import { createSupabaseKnowledgeGateway, loadGroundedBusinessContext } from './knowledge-context'
import { createStudioCredits } from './studio-credits'
import { SupabaseChannelDraftRepository } from './supabase-repository'
import { createSupabaseConsumerGate, validateLearningResult } from '@/features/channel-learning/consumer-gate'

/** Server-only composition root; never expose the privileged client or provider to the UI. */
export function createChannelDraftService(admin: Parameters<typeof createSupabaseKnowledgeGateway>[0]) {
  const repo = new SupabaseChannelDraftRepository(admin)
  const gateway = createSupabaseKnowledgeGateway(admin)
  const consumerGate = createSupabaseConsumerGate(admin)
  const deps = {
    loadContext: (workspaceId: string) => loadGroundedBusinessContext(workspaceId, gateway),
    validateLearning: (input: { workspaceId: string; epoch: number; dependencies: any[]; purpose?: 'content' | 'conversation' | 'image' }) =>
      validateLearningResult({ ...input, purpose: input.purpose ?? 'content' }, consumerGate),
    buildBaseDraft,
    checkClaims: checkBusinessClaims,
    text: createGeminiTextGenerator(),
    image: (params: Omit<Parameters<typeof maybeGenerateStudioImage>[0], 'admin'>) => maybeGenerateStudioImage({ ...params, admin }),
    repo,
    credits: createStudioCredits(admin as never),
  }
  return {
    generate: (request: Parameters<typeof generateChannelDraft>[0]) => generateChannelDraft(request, deps),
    edit: (request: Parameters<typeof editChannelDraftVariant>[0]) => editChannelDraftVariant(request, deps),
    listRecent: (workspaceId: string, limit: number) => repo.listRecent(workspaceId, limit),
  }
}
