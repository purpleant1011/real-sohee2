export const dynamic = 'force-dynamic';
import { z } from 'zod'
import { BYREUM_WORKSPACE_ID } from '@/features/content/content-draft-service'
import type { ArtifactReferenceResult } from '@/features/chat/conversation-artifact-repository'
import type { ConversationArtifact } from '@/features/chat/types'

type RouteContext = Readonly<{ params: Promise<{ workspaceId: string; threadId: string; artifactId: string }> }>
type Dependencies = Readonly<{
  authenticate(): Promise<string | null>
  authorizeThread(input: { userId: string; workspaceId: string; threadId: string }): Promise<boolean>
  resolveRetry(input: { workspaceId: string; threadId: string; replyToMessageId: string; retryFailedSlideId: string }): Promise<ArtifactReferenceResult>
  retry(input: {
    userId: string; workspaceId: string; threadId: string; replyToMessageId: string
    artifact: ConversationArtifact; slideId: string; requestKey: string; prompt: string
  }): Promise<ConversationArtifact>
}>

const uuid = z.string().uuid()
const bodySchema = z.object({
  replyToMessageId: uuid,
  slideId: uuid,
  requestKey: uuid,
}).strict()

function jsonError(status: number, code: string) {
  return Response.json({ error: { code } }, { status, headers: { 'cache-control': 'private, no-store' } })
}

export function retryPrompt(
  artifact: ConversationArtifact,
  slideId: string,
  options?: { workspaceId?: string; isByreum?: boolean },
) {
  const isByreum = options?.isByreum ?? ((options?.workspaceId ?? artifact.workspaceId) === BYREUM_WORKSPACE_ID)
  const slide = artifact.slides.find((candidate) => candidate.id === slideId)
  const slot = artifact.naverBlog?.editorBlueprint?.find((block) => block.kind === 'image_slot' && block.position === slide?.position)
  const fallbackTitle = isByreum ? '바이름 눈썹 디자인 안내' : '블로그 콘텐츠 안내'
  const title = (artifact.title?.trim() || fallbackTitle).replace(/\s+/gu, ' ').trim().slice(0, 180)
  const defaultScene = isByreum
    ? `${slide?.position ?? ''}번 눈썹 디자인 장면`
    : `${slide?.position ?? ''}번 이미지 장면`
  const exactScene = slot?.kind === 'image_slot'
    ? slot.altText.replace(/\s+/gu, ' ').trim().slice(0, 320)
    : defaultScene
  const guideline = isByreum
    ? '바이름의 자연스러운 눈썹 디자인 상담 글과 같은 시각 흐름을 유지하세요.'
    : '같은 글 맥락과 시각 흐름을 유지하세요.'
  return [
    `네이버 블로그 글 제목: ${title}`,
    `이 이미지 슬롯의 정확한 장면: ${exactScene}`,
    guideline,
    '실제 시술 장면, 도구, 상처, 전후 비교가 아닌 합성 성인의 안전한 뷰티 스튜디오 초안으로 만드세요.',
    `기존 결과물의 ${slide?.position ?? ''}번 이미지만 같은 글 맥락으로 다시 생성하세요.`,
  ].join('\n').slice(0, 1_400)
}

export function createRetryArtifactSlidePostHandler(dependencies: Dependencies) {
  return async function post(request: Request, context: RouteContext) {
    const params = await context.params
    const workspaceId = uuid.safeParse(params.workspaceId)
    const threadId = uuid.safeParse(params.threadId)
    const artifactId = uuid.safeParse(params.artifactId)
    let raw: unknown
    try { raw = await request.json() } catch { return jsonError(400, 'RETRY_SLIDE_REQUEST_INVALID') }
    const body = bodySchema.safeParse(raw)
    if (!workspaceId.success || !threadId.success || !artifactId.success || !body.success) return jsonError(400, 'RETRY_SLIDE_REQUEST_INVALID')
    const userId = await dependencies.authenticate()
    if (!userId) return jsonError(401, 'AUTH_REQUIRED')
    if (!await dependencies.authorizeThread({ userId, workspaceId: workspaceId.data, threadId: threadId.data })) return jsonError(403, 'WORKSPACE_FORBIDDEN')
    const reference = await dependencies.resolveRetry({
      workspaceId: workspaceId.data,
      threadId: threadId.data,
      replyToMessageId: body.data.replyToMessageId,
      retryFailedSlideId: body.data.slideId,
    })
    if (!reference.ok || reference.artifact.id !== artifactId.data) return jsonError(404, 'ARTIFACT_SLIDE_NOT_FOUND')
    try {
      const artifact = await dependencies.retry({
        userId, workspaceId: workspaceId.data, threadId: threadId.data,
        replyToMessageId: body.data.replyToMessageId,
        artifact: reference.artifact,
        slideId: body.data.slideId,
        requestKey: body.data.requestKey,
        prompt: retryPrompt(reference.artifact, body.data.slideId),
      })
      return Response.json({ data: { artifact } }, { headers: { 'cache-control': 'private, no-store' } })
    } catch {
      return jsonError(503, 'RETRY_SLIDE_UNAVAILABLE')
    }
  }
}

export const POST = createRetryArtifactSlidePostHandler({
  async authenticate() {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const result = await (await createServerSupabaseClient()).auth.getUser()
    return result.error ? null : result.data.user?.id ?? null
  },
  async authorizeThread({ userId, workspaceId, threadId }) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    const client = await createServerSupabaseClient()
    const [membership, thread] = await Promise.all([
      client.from('workspace_members').select('workspace_id').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
      client.from('conversation_threads').select('id').eq('workspace_id', workspaceId).eq('id', threadId).eq('status', 'active').maybeSingle(),
    ])
    return !membership.error && !thread.error && Boolean(membership.data && thread.data)
  },
  async resolveRetry(input) {
    const [{ createAdminSupabaseClient }, repository] = await Promise.all([
      import('@/lib/supabase/admin'), import('@/features/chat/conversation-artifact-repository'),
    ])
    return repository.resolveConversationArtifactRetryReference(input, repository.createSupabaseConversationArtifactGateway(createAdminSupabaseClient()))
  },
  async retry(input) {
    const { createProductionConversationArtifact } = await import('@/features/chat/conversation-artifact-generation.server')
    const channel = input.artifact.type === 'naver_blog_post' ? 'naver_blog' : input.artifact.type === 'threads_post' ? 'threads' : 'instagram'
    return createProductionConversationArtifact({
      workspaceId: input.workspaceId,
      userId: input.userId,
      sourceMessageId: input.artifact.sourceMessageId,
      assistantMessageId: input.replyToMessageId,
      idempotencyKey: input.requestKey,
      prompt: input.prompt,
      channel,
      count: input.artifact.slides.length as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20,
      reference: { ok: true, artifact: input.artifact, slide: input.artifact.slides.find((slide) => slide.id === input.slideId)! },
    })
  },
})
