import { z } from 'zod'
import { blogStrategyDecisionSchema, openBlogStrategyProposal, readBlogStrategyProposal,
  updateBlogStrategyProposal, respondToBlogStrategyProposal, approveBlogStrategyProposal } from '@/features/chat/blog-strategy-proposal'

export const dynamic = 'force-dynamic'
type Scope = { workspaceId: string; threadId: string; userId: string }
type Decision = z.infer<typeof blogStrategyDecisionSchema> | { action: 'read' }
type Context = { params: Promise<{ workspaceId: string; threadId: string }> }
type Dependencies = {
  authenticate(): Promise<string | null>
  generationCredits?(): number | null
  authorize(scope: Scope): Promise<boolean>
  operate(input: Scope & { decision: Decision }): Promise<unknown>
}
const idsSchema = z.object({ workspaceId: z.string().uuid(), threadId: z.string().uuid() })
const headers = { 'cache-control': 'private, no-store' }
const error = (status: number, code: string) => Response.json({ error: { code } }, { status, headers })
const decisionErrors = new Set(['STALE', 'CONFLICT', 'RUN_REQUIRED', 'MISSION_REQUIRED', 'GOAL_REQUIRED', 'FACTS_REQUIRED',
  'SELECTION_REQUIRED', 'CONFIRMATION_REQUIRED', 'CONTROL_BLOCKED', 'INVALID', 'UNAVAILABLE'])

export function createBlogStrategyHandlers(deps: Dependencies) {
  async function handle(request: Request, context: Context, read: boolean) {
    const ids = idsSchema.safeParse(await context.params)
    if (!ids.success) return error(400, 'CHAT_REQUEST_INVALID')
    let decision: Decision = { action: 'read' }
    if (!read) {
      let body: unknown
      try { body = await request.json() } catch { return error(400, 'CHAT_REQUEST_INVALID') }
      const parsed = blogStrategyDecisionSchema.safeParse(body)
      if (!parsed.success) return error(400, 'CHAT_REQUEST_INVALID')
      decision = parsed.data
    }
    const userId = await deps.authenticate()
    if (!userId) return error(401, 'AUTH_REQUIRED')
    if (!await deps.authorize({ ...ids.data, userId })) return error(403, 'CHAT_THREAD_FORBIDDEN')
    try {
      const data = await deps.operate({ ...ids.data, userId, decision })
      return Response.json({ data, ...(deps.generationCredits ? { generationCredits: deps.generationCredits() } : {}) }, { headers })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ''
      const code = message.replace(/^MARKETING_STRATEGY_/, '')
      if (code === 'FORBIDDEN') return error(403, 'MARKETING_STRATEGY_FORBIDDEN')
      return decisionErrors.has(code) ? error(409, `MARKETING_STRATEGY_${code}`) : error(503, 'CHAT_STRATEGY_UNAVAILABLE')
    }
  }
  return { GET: (request: Request, context: Context) => handle(request, context, true),
    POST: (request: Request, context: Context) => handle(request, context, false) }
}
const handlers = createBlogStrategyHandlers({
  generationCredits() {
    const credits = Number(process.env.SOHEE_CHAT_TURN_CREDITS)
    return Number.isSafeInteger(credits) && credits > 0 ? credits : null
  },
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorize(input) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const [member, thread] = await Promise.all([
      client.from('workspace_members').select('role').eq('workspace_id', input.workspaceId).eq('user_id', input.userId).eq('status', 'active').maybeSingle(),
      client.from('conversation_threads').select('id').eq('workspace_id', input.workspaceId).eq('id', input.threadId).eq('status', 'active').maybeSingle(),
    ])
    return !member.error && !thread.error && Boolean(member.data && thread.data)
  },
  async operate({ decision, ...scope }) {
    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    const input = { ...scope, client: createAdminSupabaseClient() }
    switch (decision.action) {
      case 'read': return readBlogStrategyProposal(input)
      case 'open': return openBlogStrategyProposal(input)
      case 'refresh': return openBlogStrategyProposal({ ...input, refresh: true })
      case 'select': return updateBlogStrategyProposal({ ...input, ...decision })
      case 'respond': return respondToBlogStrategyProposal({ ...input, ...decision })
      case 'approve': return approveBlogStrategyProposal({ ...input, ...decision })
    }
  },
})
export const GET = handlers.GET
export const POST = handlers.POST
