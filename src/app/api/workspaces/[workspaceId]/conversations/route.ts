export const dynamic = 'force-dynamic';
import { z } from 'zod'
import type { WorkspaceContext } from '@/features/auth/workspace-context'
import type { ConversationThreadPage, StartedConversation } from '@/features/chat/thread-repository'

type RouteContext = Readonly<{ params: Promise<{ workspaceId: string }> }>
type Dependencies = Readonly<{
  authenticate: () => Promise<string | null>
  authorize: () => Promise<WorkspaceContext | null>
  list: (input: { workspaceId: string; page: number; limit: number }) => Promise<ConversationThreadPage>
  start: (input: {
    workspaceId: string
    requestKey: string
    userId: string
    clientMessageId: string
    content: string
  }) => Promise<StartedConversation>
}>

const uuidSchema = z.string().uuid()
const createSchema = z.object({
  requestKey: uuidSchema,
  firstMessage: z.object({
    clientMessageId: uuidSchema,
    content: z.string().trim().min(1).max(8_000),
  }).strict(),
}).strict()
const collaboratorRoles = new Set(['owner', 'manager', 'reviewer'])

function jsonError(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

export function createConversationsRouteHandlers(deps: Dependencies) {
  return {
    async GET(request: Request, context: RouteContext) {
      const rawWorkspaceId = (await context.params).workspaceId
      const workspaceId = uuidSchema.safeParse(rawWorkspaceId)
      const page = z.coerce.number().int().min(0).max(10_000).safeParse(
        new URL(request.url).searchParams.get('page') ?? '0',
      )
      if (!workspaceId.success || !page.success) return jsonError(400, 'CONVERSATION_REQUEST_INVALID')
      const authorization = await deps.authorize()
      if (!authorization) return jsonError(401, 'AUTH_REQUIRED')
      if (authorization.workspaceId !== workspaceId.data) return jsonError(403, 'WORKSPACE_FORBIDDEN')
      try {
        const result = await deps.list({ workspaceId: workspaceId.data, page: page.data, limit: 20 })
        return Response.json({ data: result }, { headers: { 'cache-control': 'no-store' } })
      } catch {
        return jsonError(503, 'CONVERSATION_LIST_UNAVAILABLE')
      }
    },

    async POST(request: Request, context: RouteContext) {
      const workspaceId = uuidSchema.safeParse((await context.params).workspaceId)
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return jsonError(400, 'CONVERSATION_REQUEST_INVALID')
      }
      const parsed = createSchema.safeParse(body)
      if (!workspaceId.success || !parsed.success) return jsonError(400, 'CONVERSATION_REQUEST_INVALID')
      const [userId, authorization] = await Promise.all([deps.authenticate(), deps.authorize()])
      if (!userId || !authorization) return jsonError(401, 'AUTH_REQUIRED')
      if (
        authorization.workspaceId !== workspaceId.data
        || !collaboratorRoles.has(authorization.role)
      ) return jsonError(403, 'WORKSPACE_FORBIDDEN')
      try {
        const started = await deps.start({
          workspaceId: workspaceId.data,
          requestKey: parsed.data.requestKey,
          userId,
          clientMessageId: parsed.data.firstMessage.clientMessageId,
          content: parsed.data.firstMessage.content,
        })
        return Response.json({ data: started }, { status: 201 })
      } catch {
        return jsonError(503, 'CONVERSATION_CREATE_UNAVAILABLE')
      }
    },
  }
}

const production = createConversationsRouteHandlers({
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorize() {
    const { getCurrentWorkspaceContext } = await import('@/features/auth/current-workspace')
    return getCurrentWorkspaceContext()
  },
  async list(input) {
    const [{ createServerSupabaseClient }, { listConversationThreads }] = await Promise.all([
      import('@/lib/supabase/server'),
      import('@/features/chat/thread-repository'),
    ])
    return listConversationThreads({ client: await createServerSupabaseClient(), ...input })
  },
  async start(input) {
    const [{ createServerSupabaseClient }, { startConversation }] = await Promise.all([
      import('@/lib/supabase/server'),
      import('@/features/chat/thread-repository'),
    ])
    return startConversation({ client: await createServerSupabaseClient(), ...input })
  },
})

export const GET = production.GET
export const POST = production.POST
