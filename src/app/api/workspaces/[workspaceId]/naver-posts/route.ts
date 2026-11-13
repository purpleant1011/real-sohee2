import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createStageRecorder } from '@/features/agent-activity/blog-stage-store'
import {
  generateNaverBlogPost,
  NaverPostGenerationError,
} from '@/features/channel-studio/naver/generate-naver-post'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { naverPostModeSchema } from '@/features/chat/naver-blog-draft-provider'
import {
  POST_REACTION_IDS,
  POST_IMAGE_STYLE_IDS,
  getPostFormat,
} from '@/features/channel-studio/naver/post-modules'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

// Note on visibility (F5): The API accepts all 4 NaverVisibility options
// ('public' | 'neighbor' | 'mutual_neighbor' | 'private'). However, releases must apply
// the 4-way trigger migration (feat/naver-driver) before enabling neighbor / mutual_neighbor in the dispatch pipeline.
const baseRequestSchema = z.strictObject({
  topic: z.string().trim().min(1).max(300),
  requestKey: z.string().uuid(),
  runId: z.string().uuid().optional(),
  imageCount: z.number().int().optional(),
  photoSource: z.enum(['place', 'ai']).default('place'),
  categoryId: z.string().trim().min(1).nullable().optional(),
  visibility: z.enum(['public', 'neighbor', 'mutual_neighbor', 'private']).default('public'),
  scheduledAt: z.string().trim().nullable().optional(),
  postMode: naverPostModeSchema.optional(),
  reaction: z.enum(POST_REACTION_IDS).optional(),
  imageStyle: z.enum(POST_IMAGE_STYLE_IDS).optional(),
})

const requestSchema = baseRequestSchema
  .transform((data) => {
    const format = getPostFormat(data.postMode ?? 'information')
    const imageCount = data.imageCount ?? format?.imageDefault ?? 4
    return { ...data, imageCount }
  })
  .superRefine((data, ctx) => {
    const format = getPostFormat(data.postMode ?? 'information')
    const min = format ? format.imageMin : 1
    const max = format ? format.imageMax : 20
    if (data.imageCount < min || data.imageCount > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${format?.label ?? '해당'} 글 형식은 사진을 ${min}장부터 ${max}장까지만 선택할 수 있어요.`,
        path: ['imageCount'],
      })
    }
  })

function safeAuthResponse(response: Response): NextResponse {
  const status = response.status
  const message =
    status === 401
      ? '로그인이 필요해요.'
      : status === 403
        ? '이 매장에 접근할 수 없어요.'
        : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
  const errorCode = status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'WORKSPACE_FORBIDDEN' : 'AUTH_FAILED'
  return NextResponse.json({ error: message, errorCode }, { status, headers: noStore })
}

function fail(error: unknown): NextResponse {
  if (error instanceof NaverPostGenerationError) {
    return NextResponse.json(
      { error: error.message, errorCode: error.code },
      { status: error.status, headers: noStore },
    )
  }
  console.error('[naver-posts] unexpected error', error instanceof Error ? error.name : 'unknown')
  return NextResponse.json(
    { error: '네이버 블로그 글을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.', errorCode: 'SERVICE_UNAVAILABLE' },
    { status: 503, headers: noStore },
  )
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) {
      return safeAuthResponse(auth)
    }
    if (auth.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: '이 매장에 접근할 수 없어요.', errorCode: 'WORKSPACE_FORBIDDEN' },
        { status: 403, headers: noStore },
      )
    }

    const rawBody = await request.json().catch(() => null)
    const body = requestSchema.safeParse(rawBody)
    if (!body.success) {
      return NextResponse.json(
        { error: '주제와 요청 정보를 확인해 주세요.', errorCode: 'VALIDATION_FAILED' },
        { status: 400, headers: noStore },
      )
    }

    const post = await generateNaverBlogPost({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      topic: body.data.topic,
      imageCount: body.data.imageCount,
      photoSource: body.data.photoSource,
      requestKey: body.data.requestKey,
      categoryId: body.data.categoryId,
      visibility: body.data.visibility,
      scheduledAt: body.data.scheduledAt,
      postMode: body.data.postMode,
      reaction: body.data.reaction,
      imageStyle: body.data.imageStyle,
      signal: request.signal,
      deps: {
        ...(body.data.runId ? { recordStage: createStageRecorder(auth.admin as never, {
          workspaceId: auth.workspaceId, runId: body.data.runId, requestKey: body.data.requestKey }) } : {}),
        admin: auth.admin,
        userClient: auth.supabase,
      },
    })

    return NextResponse.json({ post }, { headers: noStore })
  } catch (error) {
    return fail(error)
  }
}
