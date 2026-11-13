import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getStudioOverview } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError } from '../route-utils'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId)
  if (auth instanceof NextResponse) return auth
  try {
    const overview = await getStudioOverview(auth.workspaceId)
    return NextResponse.json({ success: true, data: overview.topQuestions }, { headers: NO_STORE })
  } catch {
    return studioError('STUDIO_QUESTIONS_UNAVAILABLE', '소희의 질문을 불러오지 못했어요.', 503)
  }
}
