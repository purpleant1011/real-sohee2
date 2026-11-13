import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { loadKnowledgeJournal } from '@/features/sohee-studio/knowledge-journal.server'
import { createKnowledgeJournalGetHandler } from '@/features/sohee-studio/knowledge-journal-request.server'
export const dynamic = 'force-dynamic'
export const GET = createKnowledgeJournalGetHandler({
  authorize: async workspaceId => {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'reviewer' })
    return isResponse(auth) ? auth : { workspaceId: auth.workspaceId, client: auth.admin }
  },
  load: loadKnowledgeJournal,
})
