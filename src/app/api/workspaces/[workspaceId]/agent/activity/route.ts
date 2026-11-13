import { NextRequest, NextResponse } from 'next/server'
import { verifyWorkspaceActor, handleWorkspaceActorError } from '@/lib/auth/workspace-actor-guard'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { isActivityId } from '@/features/agent-activity/activity-event'
import { replayActivity, readActivityRunStatus } from '@/features/agent-activity/activity-store'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store, no-transform' }

export async function GET(request: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params
    await verifyWorkspaceActor(request, workspaceId)
    const runId = request.nextUrl.searchParams.get('runId')
    const cursor = request.headers.get('Last-Event-ID') ?? request.nextUrl.searchParams.get('last-seq') ?? '0'
    const after = Number(cursor)
    if (!isActivityId(workspaceId) || !isActivityId(runId) || !/^\d+$/.test(cursor) || !Number.isSafeInteger(after) || after < 0) {
      return NextResponse.json({ error: 'INVALID_ACTIVITY_CURSOR' }, { status: 400, headers })
    }
    // Use the member's client (RLS), never an admin client for replay.
    const db = await createServerSupabaseClient()
    const runStatus = await readActivityRunStatus(db, { workspaceId, runId })
    const events = await replayActivity(db, { workspaceId, runId, after })
    if (request.headers.get('accept')?.includes('text/event-stream')) {
      return new Response(events.map(event => `id: ${event.sequence}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' },
      })
    }
    return NextResponse.json({ events, last_seq: events.at(-1)?.sequence ?? after, run_status: runStatus }, { headers })
  } catch (error) {
    const authError = handleWorkspaceActorError(error)
    if (authError) {
      authError.headers.set('Cache-Control', 'no-store')
      return authError
    }
    return NextResponse.json({ error: 'ACTIVITY_UNAVAILABLE' }, { status: 503, headers })
  }
}
