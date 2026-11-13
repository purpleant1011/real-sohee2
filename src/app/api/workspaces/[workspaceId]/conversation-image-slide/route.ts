export const dynamic = 'force-dynamic';
import { z } from 'zod'
import { contentBriefSchema, type ContentBrief } from '@/features/chat/content-interview'

type RouteContext = Readonly<{
  params: Promise<{ workspaceId: string }>
}>

type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  generate(input: {
    workspaceId: string
    userId: string
    prompt: string
    channel: 'instagram' | 'threads' | 'naver_blog'
    contentBrief?: ContentBrief
  }): Promise<Readonly<{ id: string; title: string }>>
}>

const uuidSchema = z.string().uuid()
const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(12_000),
  channel: z.enum(['instagram', 'threads', 'naver_blog']),
  position: z.number().int().min(1).max(20),
  contentBrief: contentBriefSchema.optional(),
}).strict()

function error(status: number, code: string) {
  return Response.json({ error: { code } }, { status })
}

export function createConversationImageSlidePostHandler(dependencies: Dependencies) {
  return async function post(request: Request, context: RouteContext) {
    const params = await context.params
    const workspaceId = uuidSchema.safeParse(params.workspaceId)
    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return error(400, 'IMAGE_SLIDE_REQUEST_INVALID')
    }
    const body = bodySchema.safeParse(rawBody)
    if (!workspaceId.success || !body.success) return error(400, 'IMAGE_SLIDE_REQUEST_INVALID')

    const userId = await dependencies.authenticate()
    if (userId === null) return error(401, 'AUTH_REQUIRED')

    try {
      const artifact = await dependencies.generate({
        workspaceId: workspaceId.data,
        userId,
        prompt: body.data.prompt,
        channel: body.data.channel,
        ...(body.data.contentBrief ? { contentBrief: body.data.contentBrief } : {}),
      })
      console.info('[sohee:image-slide-subrequest-completed]', {
        workspaceId: workspaceId.data,
        channel: body.data.channel,
        position: body.data.position,
        mediaAssetId: artifact.id,
      })
      return Response.json({
        data: {
          mediaAssetId: artifact.id,
          altText: artifact.title,
        },
      })
    } catch (cause) {
      console.error('[sohee:image-slide-subrequest-failed]', {
        workspaceId: workspaceId.data,
        channel: body.data.channel,
        position: body.data.position,
        safeCode: cause instanceof Error ? cause.message : 'IMAGE_SLIDE_GENERATION_FAILED',
      })
      return error(503, 'IMAGE_RETRYABLE')
    }
  }
}

const productionDependencies: Dependencies = {
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async generate(input) {
    const { createProductionConversationImageArtifact } = await import(
      '@/features/chat/conversation-image-generation.server'
    )
    return createProductionConversationImageArtifact(input)
  },
}

export const POST = createConversationImageSlidePostHandler(productionDependencies)
