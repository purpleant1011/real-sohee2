import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateStudioGoal } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError, studioFailure } from '../../route-utils'

export const dynamic = 'force-dynamic'

const goalUpdate = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(200).optional(),
  desiredOutcome: z.string().trim().min(1).max(4000).optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  status: z.enum(['active', 'paused', 'retired']).optional(),
}).strict().refine((value) => Object.keys(value).length > 1)

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; id: string }> }) {
  const { workspaceId, id } = await params
  const auth = await authorizeStudio(workspaceId, true)
  if (auth instanceof NextResponse) return auth
  if (!z.string().uuid().safeParse(id).success) return studioError('INVALID_GOAL_ID', '수정할 목표를 선택해 주세요.', 400)
  const input = goalUpdate.safeParse(await req.json().catch(() => null))
  if (!input.success) return studioError('INVALID_GOAL_UPDATE', '변경할 내용과 버전을 확인해 주세요.', 400)
  try {
    const goal = await updateStudioGoal({ workspaceId: auth.workspaceId, userId: auth.userId, goalId: id, ...input.data })
    return NextResponse.json({ success: true, data: goal }, { headers: NO_STORE })
  } catch (error) {
    return studioFailure(error, 'STUDIO_GOAL_UPDATE_FAILED', '목표를 수정하지 못했어요.')
  }
}
