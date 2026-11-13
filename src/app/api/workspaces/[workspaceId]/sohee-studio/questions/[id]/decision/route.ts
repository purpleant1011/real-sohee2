import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveCuriosity } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError } from '../../../route-utils'

export const dynamic = 'force-dynamic'

const request = z.object({ status: z.enum(['snoozed', 'not_applicable']) }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const { workspaceId, id } = await params
  const auth = await authorizeStudio(workspaceId, true)
  if (auth instanceof NextResponse) return auth
  const input = request.safeParse(await req.json().catch(() => null))
  if (!input.success || id.length > 160 || !/^[a-z0-9_:-]+$/i.test(id)) {
    return studioError('INVALID_QUESTION_DECISION', '질문 선택을 확인해 주세요.', 400)
  }
  try {
    await resolveCuriosity(auth.workspaceId, auth.userId, id, input.data.status)
    return NextResponse.json({ success: true, data: { status: input.data.status } }, { headers: NO_STORE })
  } catch {
    return studioError('STUDIO_QUESTION_SAVE_FAILED', '질문을 보류하지 못했어요.', 503)
  }
}
