export const dynamic = 'force-dynamic';
import { z } from 'zod'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import type { ConversationThreadSummary } from '@/features/chat/thread-repository'

type RouteContext = Readonly<{ params: Promise<{ workspaceId: string; threadId: string }> }>
type Dependencies = Readonly<{
  authorize: () => Promise<WorkspaceContext | null>
  updateStatus: (input: {
    workspaceId: string
    threadId: string
    status: 'active' | 'archived'
  }) => Promise<ConversationThreadSummary>
}>

const uuidSchema = z.string().uuid()
const bodySchema = z.object({ status: z.enum(['active', 'archived']) }).strict()
const collaboratorRoles = new Set(['owner', 'manager', 'reviewer'])

function jsonError(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

export function createConversationThreadRouteHandler(deps: Dependencies) {
  return async function PATCH(request: Request, context: RouteContext) {
    const params = await context.params
    const workspaceId = uuidSchema.safeParse(params.workspaceId)
    const threadId = uuidSchema.safeParse(params.threadId)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError(400, 'CONVERSATION_REQUEST_INVALID')
    }
    const parsed = bodySchema.safeParse(body)
    if (!workspaceId.success || !threadId.success || !parsed.success) {
      return jsonError(400, 'CONVERSATION_REQUEST_INVALID')
    }
    const authorization = await deps.authorize()
    if (!authorization) return jsonError(401, 'AUTH_REQUIRED')
    if (
      authorization.workspaceId !== workspaceId.data
      || !collaboratorRoles.has(authorization.role)
    ) return jsonError(403, 'WORKSPACE_FORBIDDEN')
    try {
      const thread = await deps.updateStatus({
        workspaceId: workspaceId.data,
        threadId: threadId.data,
        status: parsed.data.status,
      })
      return Response.json({ data: { thread } })
    } catch {
      return jsonError(404, 'CONVERSATION_NOT_FOUND')
    }
  }
}

export const PATCH = createConversationThreadRouteHandler({
  async authorize() {
    const { getCurrentWorkspaceContext } = await import('@/features/auth/current-workspace')
    return getCurrentWorkspaceContext()
  },
  async updateStatus(input) {
    const [{ createServerSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/server'),
      import('@/features/chat/thread-repository'),
    ])
    const client = await createServerSupabaseClient()
    return input.status === 'archived'
      ? repository.archiveConversationThread({ client, ...input })
      : repository.restoreConversationThread({ client, ...input })
  },
})
