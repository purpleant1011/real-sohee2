import 'server-only'
import { authorizeQuickRequest } from '@/features/quick-start/route-auth'
import { createLearningHttpHandler, LearningHttpError, type LearningOperation } from './http'
import { createLearningRepository, type SupabaseQueryClient } from './repository'
import { createLearningService } from './service'
import { createProductionLearningAdapters } from './production'

/** A fresh authorization context is scoped to each request, never cached across users/workspaces. */
export function createLearningRoute(operation: LearningOperation) {
  return async (request: Request, props: { params: Promise<{ workspaceId: string; sourceId?: string }> }): Promise<Response> => {
    let admin: SupabaseQueryClient | null = null
    const handler = createLearningHttpHandler(operation, {
      async authorize(workspaceId, write) {
        const auth = await authorizeQuickRequest(workspaceId, write ? { requireRole: 'manager' } : undefined)
        if (auth instanceof Response) return auth
        admin = auth.admin
        return { workspaceId: auth.workspaceId, userId: auth.userId, role: auth.role }
      },
      async perform(action, actor, input) {
        if (!admin) throw new LearningHttpError('UNAVAILABLE')
        const repository = createLearningRepository(admin)
        return createLearningService(repository, createProductionLearningAdapters({ repository }))(action, actor, input)
      },
    })
    return handler(request, await props.params)
  }
}
