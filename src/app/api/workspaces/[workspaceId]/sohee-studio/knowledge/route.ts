import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { getStudioKnowledgeViews } from '@/features/sohee-studio/services/sohee-studio-service'
import { authorizeStudio, NO_STORE, studioError } from '../route-utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const auth = await authorizeStudio(workspaceId)
  if (auth instanceof NextResponse) return auth
  try {
    const category = req.nextUrl.searchParams.get('category') || undefined
    const views = await getStudioKnowledgeViews(auth.workspaceId, category)
    return NextResponse.json({ success: true, data: views }, { headers: NO_STORE })
  } catch {
    return studioError('STUDIO_KNOWLEDGE_UNAVAILABLE', '지식을 불러오지 못했어요.', 503)
  }
}
