import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { knowledgeJournalSchema } from './knowledge-journal'
const noStore = { 'Cache-Control': 'private, no-store' }
export function createKnowledgeJournalGetHandler(deps: {
  authorize(workspaceId: string): Promise<Response | { workspaceId: string; client: ServerSupabaseClient }>
  load(input: { client: ServerSupabaseClient; workspaceId: string; limit: number }): Promise<unknown>
}) {
  return async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
    const scope = z.object({ workspaceId: z.string().uuid() }).safeParse(await context.params)
    const rawLimit = new URL(request.url).searchParams.get('limit')
    const limit = z.number().int().min(1).max(80).safeParse(rawLimit === null ? 30 : Number(rawLimit))
    if (!scope.success || !limit.success) return NextResponse.json({ error: '조회할 가게와 기록 범위를 확인해 주세요.' }, { status: 400, headers: noStore })
    try {
      const auth = await deps.authorize(scope.data.workspaceId)
      if (auth instanceof Response) return new Response(auth.body, { status: auth.status, headers: { ...Object.fromEntries(auth.headers), ...noStore } })
      if (auth.workspaceId !== scope.data.workspaceId) return NextResponse.json({ error: '현재 가게의 기록을 확인해 주세요.' }, { status: 403, headers: noStore })
      const data = knowledgeJournalSchema.parse(await deps.load({ client: auth.client, workspaceId: auth.workspaceId, limit: limit.data }))
      if (data.workspaceId !== auth.workspaceId || data.sources.every(source => source.state === 'unavailable')) throw new Error('KNOWLEDGE_JOURNAL_UNAVAILABLE')
      const currentAuth = await deps.authorize(scope.data.workspaceId)
      if (currentAuth instanceof Response) return new Response(currentAuth.body, { status: currentAuth.status, headers: { ...Object.fromEntries(currentAuth.headers), ...noStore } })
      if (currentAuth.workspaceId !== auth.workspaceId) return NextResponse.json({ error: '현재 가게의 기록을 확인해 주세요.' }, { status: 403, headers: noStore })
      return NextResponse.json({ data }, { headers: noStore })
    } catch {
      return NextResponse.json({ error: '지식 일지 자료를 확인하지 못했어요. 잠시 후 다시 조회해 주세요.' }, { status: 503, headers: noStore })
    }
  }
}
