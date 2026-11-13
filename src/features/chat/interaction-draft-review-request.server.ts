import 'server-only'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { interactionDraftReviewSchema } from '@/features/engagement/interaction-draft-contract'

const scopeSchema = z.object({ workspaceId: z.string().uuid(), threadId: z.string().uuid(), stepId: z.string().uuid() })
const noStore = { 'Cache-Control': 'private, no-store' }
export function createInteractionDraftReviewGetHandler(deps: {
  authorize(workspaceId: string): Promise<Response | { workspaceId: string; client: ServerSupabaseClient }>
  load(input: { client: ServerSupabaseClient; workspaceId: string; threadId: string; stepId: string }): Promise<unknown>
}) {
  return async function GET(request: Request, context: { params: Promise<{ workspaceId: string; threadId: string; stepId: string }> }) {
    if (request.method !== 'GET') return NextResponse.json({ error: '조회만 가능한 요청이에요.' }, { status: 405, headers: noStore })
    const scope = scopeSchema.safeParse(await context.params)
    if (!scope.success) return NextResponse.json({ error: '검토할 답안 경로를 확인해 주세요.' }, { status: 400, headers: noStore })
    try {
      const auth = await deps.authorize(scope.data.workspaceId)
      if (auth instanceof Response) {
        const headers = new Headers(auth.headers)
        headers.set('Cache-Control', 'private, no-store')
        return new Response(auth.body, { status: auth.status, headers })
      }
      if (auth.workspaceId !== scope.data.workspaceId) return NextResponse.json({ error: '현재 가게의 답안을 확인해 주세요.' }, { status: 403, headers: noStore })
      const data = interactionDraftReviewSchema.parse(await deps.load({ ...scope.data, client: auth.client }))
      if (data.snapshot.workspaceId !== auth.workspaceId) throw new Error('INTERACTION_REVIEW_SCOPE_MISMATCH')
      return NextResponse.json({ data }, { headers: noStore })
    } catch {
      return NextResponse.json({ error: '답안과 최신 원문을 확인하지 못했어요. 현재 소통함에서 확인해 주세요.' }, { status: 503, headers: noStore })
    }
  }
}
