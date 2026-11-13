import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { ManualHandoffError, readManualHandoff, recordManualHandoff } from './manual-handoff'
import { createManualHandoffRepository } from './manual-handoff-repository'

const targetSchema = z.object({
  contentId: z.string().uuid(), versionId: z.string().uuid(),
  channel: z.enum(['instagram', 'threads', 'naver_blog', 'daangn_business']),
}).strict()
const recordSchema = targetSchema.extend({ confirmed: z.literal(true) })

export async function handleManualHandoff(request: Request): Promise<NextResponse> {
  if (request.method !== 'GET' && request.method !== 'POST') return NextResponse.json({ error: '지원하지 않는 요청이에요.' }, { status: 405 })
  const auth = await authorizeQuickRequest(request.headers.get('x-workspace-id'), { requireRole: 'manager' })
  if (isResponse(auth)) return auth
  const parsed = request.method === 'POST'
    ? recordSchema.safeParse(await request.json().catch(() => null))
    : targetSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: '전달한 글과 확인 항목을 다시 확인해 주세요.' }, { status: 422 })
  try {
    const input = { ...parsed.data, workspaceId: auth.workspaceId, actorId: auth.userId }
    const repository = createManualHandoffRepository(auth.admin)
    const view = request.method === 'POST'
      ? await recordManualHandoff(input, repository)
      : await readManualHandoff(input, repository)
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof ManualHandoffError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status })
    return NextResponse.json({ error: '수동 전달 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
}
