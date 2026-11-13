export const dynamic = 'force-dynamic';
import { z } from 'zod'
import type { WorkspaceContext } from '@/features/auth/workspace-context'

type RouteContext = Readonly<{ params: Promise<{ workspaceId: string }> }>
type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  authorize(): Promise<WorkspaceContext | null>
  createRequest(input: {
    workspaceId: string
    actorUserId: string
    scope: 'member' | 'workspace'
  }): Promise<{ requestId: string; confirmationCode: string }>
}>

const uuidSchema = z.string().uuid()
const requestSchema = z.object({ scope: z.enum(['member', 'workspace']) }).strict()

function jsonError(status: number, code: string) {
  return Response.json({ error: { code } }, {
    status,
    headers: { 'cache-control': 'private, no-store' },
  })
}

export function createDataDeletionRequestPostHandler(dependencies: Dependencies) {
  return async function post(request: Request, context: RouteContext) {
    const workspaceId = uuidSchema.safeParse((await context.params).workspaceId)
    let source: unknown
    try {
      if (request.headers.get('content-type')?.includes('application/json')) {
        source = await request.json()
      } else {
        const form = await request.formData()
        source = { scope: form.get('scope') }
      }
    } catch {
      return jsonError(400, 'DATA_DELETION_REQUEST_INVALID')
    }
    const parsed = requestSchema.safeParse(source)
    if (!workspaceId.success || !parsed.success) {
      return jsonError(400, 'DATA_DELETION_REQUEST_INVALID')
    }

    const actorUserId = await dependencies.authenticate()
    if (!actorUserId) return jsonError(401, 'AUTH_REQUIRED')
    const authorization = await dependencies.authorize()
    if (
      !authorization
      || authorization.workspaceId !== workspaceId.data
      || (parsed.data.scope === 'workspace' && authorization.role !== 'owner')
    ) {
      return jsonError(403, 'WORKSPACE_FORBIDDEN')
    }

    try {
      const created = await dependencies.createRequest({
        workspaceId: workspaceId.data,
        actorUserId,
        scope: parsed.data.scope,
      })
      const statusUrl = `/data-deletion/status?code=${encodeURIComponent(created.confirmationCode)}`
      if (!request.headers.get('content-type')?.includes('application/json')) {
        return Response.redirect(new URL(statusUrl, request.url), 303)
      }
      return Response.json({ data: { statusUrl } }, {
        status: 201,
        headers: { 'cache-control': 'private, no-store' },
      })
    } catch {
      return jsonError(503, 'DATA_DELETION_REQUEST_UNAVAILABLE')
    }
  }
}

const production = createDataDeletionRequestPostHandler({
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const result = await client.auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorize() {
    const { getCurrentWorkspaceContext } = await import('@/features/auth/current-workspace')
    return getCurrentWorkspaceContext()
  },
  async createRequest(input) {
    const { createWorkspaceDataDeletionRequest } = await import('@/features/data-deletion/repository')
    return createWorkspaceDataDeletionRequest(input)
  },
})

export const POST = production
