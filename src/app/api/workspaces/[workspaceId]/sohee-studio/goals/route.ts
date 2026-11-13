import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listStudioGoals, saveGoal } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError, studioFailure } from '../route-utils'

export const dynamic = 'force-dynamic'

const goalRequest = z.object({ proposalId: z.string().uuid() }).strict()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId)
  if (auth instanceof NextResponse) return auth
  try {
    const goals = await listStudioGoals(auth.workspaceId)
    return NextResponse.json({ success: true, data: goals }, { headers: NO_STORE })
  } catch {
    return studioError('STUDIO_GOALS_UNAVAILABLE', '목표를 불러오지 못했어요.', 503)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId, true)
  if (auth instanceof NextResponse) return auth
  const input = goalRequest.safeParse(await req.json().catch(() => null))
  if (!input.success) return studioError('INVALID_GOAL', '확인된 목표안을 선택해 주세요.', 400)
  try {
    const saved = await saveGoal(auth.workspaceId, auth.userId, input.data.proposalId)
    return NextResponse.json({ success: true, data: saved }, { headers: NO_STORE })
  } catch (error) {
    return studioFailure(error, 'STUDIO_GOAL_SAVE_FAILED', '목표를 저장하지 못했어요.')
  }
}
