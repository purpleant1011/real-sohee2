import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { processStudioTurn, listStudioTurns } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError, studioFailure } from '../route-utils'

export const dynamic = 'force-dynamic'

const turnRequest = z.object({
  clientMessageId: z.string().uuid(),
  content: z.string().trim().min(1).max(8000),
  focus: z.enum(['teach', 'inspect', 'curiosity', 'goal']).optional(),
  relatedEntityId: z.string().min(1).max(160).regex(/^[a-z0-9_:-]+$/i).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.focus === 'inspect' && (!value.relatedEntityId || !z.string().uuid().safeParse(value.relatedEntityId).success)) {
    ctx.addIssue({ code: 'custom', path: ['relatedEntityId'], message: '교정할 지식을 선택해 주세요.' })
  }
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId)
  if (auth instanceof NextResponse) return auth
  try {
    const messages = await listStudioTurns(auth.workspaceId)
    return NextResponse.json({ success: true, data: messages }, { headers: NO_STORE })
  } catch {
    return studioError('STUDIO_TURNS_UNAVAILABLE', '대화를 불러오지 못했어요.', 503)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId, true)
  if (auth instanceof NextResponse) return auth
  const input = turnRequest.safeParse(await req.json().catch(() => null))
  if (!input.success) return studioError('INVALID_TURN', '대화 내용을 확인해 주세요.', 400)
  try {
    const reply = await processStudioTurn({ workspaceId: auth.workspaceId, userId: auth.userId, ...input.data })
    return NextResponse.json({ success: true, data: reply }, { headers: NO_STORE })
  } catch (error) {
    return studioFailure(error, 'STUDIO_TURN_FAILED', '답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.')
  }
}
