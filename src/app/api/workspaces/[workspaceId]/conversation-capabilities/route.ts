import { NextResponse } from 'next/server'
import { isResponse } from '@/features/quick-start/route-auth'
import { loadAuthorizedConversationCatalog } from '@/features/chat/conversation-operation-catalog-request.server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const result = await loadAuthorizedConversationCatalog(workspaceId)
  if (isResponse(result)) { result.headers.set('Cache-Control', 'no-store'); return result }
  return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } })
}
