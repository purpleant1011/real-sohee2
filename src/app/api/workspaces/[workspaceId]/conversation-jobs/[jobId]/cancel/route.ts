export const dynamic = 'force-dynamic';
import { z } from 'zod'

type Context = Readonly<{ params: Promise<{ workspaceId: string; jobId: string }> }>
type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  authorize(input: { userId: string; workspaceId: string }): Promise<boolean>
  cancel(input: { userId: string; workspaceId: string; jobId: string }): Promise<unknown>
}>
const uuid = z.string().uuid()

export function createConversationJobCancelPostHandler(dependencies: Dependencies) {
  return async function POST(_request: Request, context: Context) {
    const ids = z.object({ workspaceId: uuid, jobId: uuid }).safeParse(await context.params)
    if (!ids.success) return Response.json({ error: { code: 'CONVERSATION_JOB_CANCEL_INVALID' } }, { status: 400 })
    const userId = await dependencies.authenticate()
    if (!userId) return Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 })
    if (!await dependencies.authorize({ userId, workspaceId: ids.data.workspaceId })) return Response.json({ error: { code: 'WORKSPACE_FORBIDDEN' } }, { status: 403 })
    try {
      return Response.json({ data: await dependencies.cancel({ ...ids.data, userId }) }, { headers: { 'cache-control': 'private, no-store' } })
    } catch {
      return Response.json({ error: { code: 'CONVERSATION_JOB_CANCEL_FAILED' } }, { status: 503 })
    }
  }
}

const production = createConversationJobCancelPostHandler({
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorize(input) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).from('workspace_members').select('workspace_id').eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle()
    return !result.error && Boolean(result.data)
  },
  async cancel(input) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).rpc('request_conversation_job_cancel', { p_workspace_id: input.workspaceId, p_job_id: input.jobId, p_user_id: input.userId })
    if (result.error || !result.data) throw new Error('CONVERSATION_JOB_CANCEL_FAILED')
    return result.data
  },
})

export const POST = production
