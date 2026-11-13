export const dynamic = 'force-dynamic';
import { z } from 'zod'

type Context = Readonly<{ params: Promise<{ workspaceId: string }> }>
type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  authorize(input: { userId: string; workspaceId: string }): Promise<boolean>
  load(workspaceId: string): Promise<unknown>
}>

type ProductionClient = Readonly<{
  auth: Readonly<{
    getClaims(): Promise<Readonly<{
      data: { claims?: { sub?: unknown } } | null
      error: unknown
    }>>
  }>
  rpc(
    name: 'get_conversation_work_status_v2',
    args: { p_workspace_id: string },
  ): PromiseLike<Readonly<{
    data: unknown
    error: { code?: string } | null
  }>>
}>

class WorkStatusForbiddenError extends Error {}
const uuid = z.string().uuid()

export function createConversationWorkStatusGetHandler(dependencies: Dependencies) {
  return async function GET(_request: Request, context: Context) {
    const workspaceId = uuid.safeParse((await context.params).workspaceId)
    if (!workspaceId.success) return Response.json({ error: { code: 'WORK_STATUS_INVALID' } }, { status: 400 })
    const userId = await dependencies.authenticate()
    if (!userId) return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 })
    if (!await dependencies.authorize({ userId, workspaceId: workspaceId.data })) return Response.json({ error: { code: 'WORKSPACE_FORBIDDEN' } }, { status: 403 })
    try {
      return Response.json({ data: await dependencies.load(workspaceId.data) }, { headers: { 'cache-control': 'private, no-store' } })
    } catch (error) {
      if (error instanceof WorkStatusForbiddenError) {
        return Response.json({ error: { code: 'WORKSPACE_FORBIDDEN' } }, { status: 403 })
      }
      return Response.json({ error: { code: 'WORK_STATUS_UNAVAILABLE' } }, { status: 503 })
    }
  }
}

export function createProductionConversationWorkStatusGetHandler(input: Readonly<{
  createClient(): Promise<ProductionClient>
}>) {
  return async function GET(request: Request, context: Context) {
    try {
      const client = await input.createClient()
      return await createConversationWorkStatusGetHandler({
        async authenticate() {
          const result = await client.auth.getClaims()
          const subject = result.data?.claims?.sub
          return result.error || typeof subject !== 'string' || subject.length === 0 ? null : subject
        },
        async authorize() {
          return true
        },
        async load(workspaceId) {
          const result = await client.rpc('get_conversation_work_status_v2', { p_workspace_id: workspaceId })
          if (result.error?.code === '42501') throw new WorkStatusForbiddenError()
          if (result.error || !result.data) throw new Error('WORK_STATUS_UNAVAILABLE')
          return result.data
        },
      })(request, context)
    } catch {
      return Response.json({ error: { code: 'WORK_STATUS_UNAVAILABLE' } }, { status: 503 })
    }
  }
}

export const GET = createProductionConversationWorkStatusGetHandler({
  async createClient() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    return {
      auth: { getClaims: () => client.auth.getClaims() },
      rpc: (name, args) => client.rpc(name, args),
    }
  },
})
