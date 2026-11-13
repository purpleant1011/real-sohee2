import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { loadInteractionDraftReview } from '@/features/chat/interaction-draft-review.server'
import { createInteractionDraftReviewGetHandler } from '@/features/chat/interaction-draft-review-request.server'

export const dynamic = 'force-dynamic'
export const GET = createInteractionDraftReviewGetHandler({
  authorize: async workspaceId => {
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    return isResponse(auth) ? auth : { workspaceId: auth.workspaceId, client: auth.admin }
  },
  load: loadInteractionDraftReview,
})
