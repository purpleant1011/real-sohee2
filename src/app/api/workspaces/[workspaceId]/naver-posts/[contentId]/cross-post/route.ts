import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { crossPostToSocial } from '@/features/channel-studio/naver/cross-post-to-social'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ workspaceId: string; contentId: string }> }
const noStore = { 'Cache-Control': 'no-store' }

const requestSchema = z.object({
  versionId: z.string().uuid(),
  channels: z.array(z.enum(['instagram', 'threads'])).optional(),
}).strict()

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId, contentId } = await params
    const auth = await authorizeQuickRequest(workspaceId, { requireRole: 'manager' })
    if (isResponse(auth)) {
      return auth
    }

    const rawBody = await request.json().catch(() => null)
    const body = requestSchema.safeParse(rawBody)
    if (!body.success) {
      return NextResponse.json(
        { error: '요청 정보를 확인해 주세요.' },
        { status: 400, headers: noStore },
      )
    }

    const result = await crossPostToSocial({
      workspaceId,
      userId: auth.userId,
      naverContentId: contentId,
      naverVersionId: body.data.versionId,
      channels: body.data.channels,
      userClient: auth.supabase,
    })

    return NextResponse.json({ success: true, data: result }, { headers: noStore })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'SNS 변환에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500, headers: noStore },
    )
  }
}
