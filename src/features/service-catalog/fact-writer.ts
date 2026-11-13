import { createCustomFact, findFactByContent, updateFactContent } from '@/features/sohee-knowledge/facts-service'
import type { FactWriter } from './catalog-service'

/** Reuses the existing approved-Fact flow so a catalog edit invalidates drafts built on the old snapshot. */
export function createApprovedFactWriter(userId: string): FactWriter {
  return {
    async create({ workspaceId, category, content }) {
      const fact = await createCustomFact({ workspaceId, userId, category, content })
      return { id: fact.id }
    },
    async update({ workspaceId, factId, content }) {
      const fact = await updateFactContent({ workspaceId, userId, factId, content })
      return { id: fact.id }
    },
    async findByContent({ workspaceId, category, content }) {
      const fact = await findFactByContent({ workspaceId, category, content })
      return fact ? { id: fact.id } : null
    },
  }
}
