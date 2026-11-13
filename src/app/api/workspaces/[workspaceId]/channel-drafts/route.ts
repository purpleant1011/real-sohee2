import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createChannelDraftService } from '@/features/channel-studio/compose'
import { ChannelDraftError, type ChannelDraftResult } from '@/features/channel-studio/types'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Context = { params: Promise<{ workspaceId: string }> }
const noStore = { 'Cache-Control': 'no-store' }
const requestSchema = z.strictObject({
  topic: z.string().trim().min(1).max(300),
  requestKey: z.string().uuid(),
  includeImage: z.boolean().optional(),
})
const editSchema = z.strictObject({
  requestKey: z.string().uuid(),
  channel: z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business']),
  edits: z.strictObject({
    title: z.string().max(200).optional(), text: z.string().max(20_000).optional(),
    caption: z.string().max(20_000).optional(),
    hashtags: z.array(z.string().max(50)).max(30).optional(),
  }).refine(value => Object.keys(value).length > 0),
})

/** Only local media endpoints for the authenticated workspace may be previewed. */
function ownerMediaUrl(value: unknown, workspaceId: string): string | null {
  if (typeof value !== 'string') return null
  const prefix = `/api/workspaces/${encodeURIComponent(workspaceId)}/media/`
  return value.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length)) ? value : null
}

/** Only the explicitly supported display fields leave the server. */
function toOwnerResult(result: ChannelDraftResult, workspaceId: string): ChannelDraftResult {
  return {
    requestKey: result.requestKey,
    topic: result.topic,
    createdAt: result.createdAt,
    basisNotes: result.basisNotes,
    imageNotice: result.imageNotice,
    variants: result.variants.map((variant) => ({
      channel: variant.channel, payload: {
        ...(typeof variant.payload.caption === 'string' ? { caption: variant.payload.caption } : {}),
        ...(typeof variant.payload.text === 'string' ? { text: variant.payload.text } : {}),
        ...(typeof variant.payload.title === 'string' ? { title: variant.payload.title } : {}),
        ...(Array.isArray(variant.payload.blocks) ? { blocks: variant.payload.blocks.filter((block): block is { type: string; text: string } =>
          !!block && typeof block === 'object' && typeof block.type === 'string' && typeof block.text === 'string'
        ).map((block) => ({ type: block.type, text: block.text })) } : {}),
        ...(Array.isArray(variant.payload.hashtags) ? { hashtags: variant.payload.hashtags.filter((tag): tag is string => typeof tag === 'string') } : {}),
        ...(ownerMediaUrl(variant.payload.imageUrl, workspaceId) ? { imageUrl: ownerMediaUrl(variant.payload.imageUrl, workspaceId) } : {}),
        ...(Array.isArray(variant.payload.imageUrls) ? { imageUrls: variant.payload.imageUrls.filter((url): url is string => !!ownerMediaUrl(url, workspaceId)) } : {}),
        ...(typeof variant.payload.category === 'string' ? { category: variant.payload.category } : {}),
        ...(typeof variant.payload.firstLineHook === 'string' ? { firstLineHook: variant.payload.firstLineHook } : {}),
        ...(typeof variant.payload.firstLineHighlight === 'string' ? { firstLineHighlight: variant.payload.firstLineHighlight } : {}),
        ...(typeof variant.payload.coupon === 'string' || variant.payload.coupon === null ? { coupon: variant.payload.coupon } : {}),
        ...(Array.isArray(variant.payload.media) ? { media: variant.payload.media.filter((media): media is { type: 'image' | 'video'; format?: string; mimeType?: string; fileSizeBytes?: number; width?: number; height?: number; durationSeconds?: number } =>
          !!media && typeof media === 'object' && (media.type === 'image' || media.type === 'video')
        ).map((media) => ({
          type: media.type,
          ...(typeof media.format === 'string' ? { format: media.format } : {}),
          ...(typeof media.mimeType === 'string' ? { mimeType: media.mimeType } : {}),
          ...(typeof media.fileSizeBytes === 'number' ? { fileSizeBytes: media.fileSizeBytes } : {}),
          ...(typeof media.width === 'number' ? { width: media.width } : {}),
          ...(typeof media.height === 'number' ? { height: media.height } : {}),
          ...(typeof media.durationSeconds === 'number' ? { durationSeconds: media.durationSeconds } : {}),
          ...(ownerMediaUrl((media as Record<string, unknown>).src, workspaceId) ? { src: ownerMediaUrl((media as Record<string, unknown>).src, workspaceId) } : {}),
        })) } : {}),
      },
      status: variant.status, statusLabel: variant.statusLabel, issues: variant.issues,
      contentId: variant.contentId, versionId: variant.versionId, vaultSavable: variant.vaultSavable,
      blockedReason: variant.blockedReason,
    })),
  }
}

function safeAuthResponse(response: Response): NextResponse {
  const status = response.status
  const message = status === 401 ? '로그인이 필요해요.' : status === 403 ? '이 매장에 접근할 수 없어요.' : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
  return NextResponse.json({ error: message }, { status, headers: noStore })
}

function fail(error: unknown): NextResponse {
  if (error instanceof ChannelDraftError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: noStore })
  }
  // Avoid logging raw provider exceptions: they may embed API keys or request contents.
  console.error('[channel-drafts] unexpected error', error instanceof Error ? error.name : 'unknown')
  return NextResponse.json({ error: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', code: 'SERVICE_UNAVAILABLE' }, { status: 503, headers: noStore })
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) {
      return safeAuthResponse(auth)
    }
    if (auth.workspaceId !== workspaceId) {
      return NextResponse.json({ error: '이 매장에 접근할 수 없어요.', code: 'WORKSPACE_FORBIDDEN' }, { status: 403, headers: noStore })
    }
    const body = requestSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: '주제와 요청 정보를 확인해 주세요.', code: 'VALIDATION_FAILED' }, { status: 400, headers: noStore })
    }
    const result = await createChannelDraftService(auth.admin).generate({
      workspaceId: auth.workspaceId, userId: auth.userId, ...body.data,
    })
    return NextResponse.json({ draft: toOwnerResult(result, auth.workspaceId) }, { headers: noStore })
  } catch (error) {
    return fail(error)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) return safeAuthResponse(auth)
    if (auth.workspaceId !== workspaceId) {
      return NextResponse.json({ error: '이 매장에 접근할 수 없어요.', code: 'WORKSPACE_FORBIDDEN' }, { status: 403, headers: noStore })
    }
    const body = editSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return NextResponse.json({ error: '수정할 글과 입력 내용을 확인해 주세요.', code: 'VALIDATION_FAILED' }, { status: 400, headers: noStore })
    }
    const result = await createChannelDraftService(auth.admin).edit({ workspaceId: auth.workspaceId, userId: auth.userId, ...body.data })
    return NextResponse.json({ draft: toOwnerResult(result, auth.workspaceId) }, { headers: noStore })
  } catch (error) {
    return fail(error)
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) {
      return safeAuthResponse(auth)
    }
    if (auth.workspaceId !== workspaceId) {
      return NextResponse.json({ error: '이 매장에 접근할 수 없어요.', code: 'WORKSPACE_FORBIDDEN' }, { status: 403, headers: noStore })
    }
    const results = await createChannelDraftService(auth.admin).listRecent(auth.workspaceId, 20)
    return NextResponse.json({ items: results.map(result => toOwnerResult(result, auth.workspaceId)) }, { headers: noStore })
  } catch (error) {
    return fail(error)
  }
}
