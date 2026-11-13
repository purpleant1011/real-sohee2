export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { summarizeFirstValueObservation, type ObservationEvent } from '@/features/quick-start/first-value-observation'

/** ANI-1602: workspace-scoped first-value funnel + generation cost. A read failure is an error, never an empty funnel. */
export async function GET(req: Request) {
  const auth = await authorizeQuickRequest(req.headers.get('x-workspace-id') || new URL(req.url).searchParams.get('workspaceId'))
  if (isResponse(auth)) return auth
  try {
    const events: ObservationEvent[] = []
    const pageSize = 1000
    const maxEvents = 10_000
    for (let from = 0; from <= maxEvents; from += pageSize) {
      const { data, error } = await auth.admin.from('funnel_events')
        .select('event, workspace_id, user_id, occurred_at, properties')
        .eq('workspace_id', auth.workspaceId)
        .order('occurred_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw error
      // A missing list is a failed read, never an empty funnel (truth gate G1).
      if (!Array.isArray(data)) throw new Error('FUNNEL_PAGE_NOT_OBSERVED')
      if (from === maxEvents) {
        if (data.length) return NextResponse.json({ error: '퍼널 조회 범위를 초과했어요.', code: 'FUNNEL_TOO_LARGE' }, { status: 413 })
        break
      }
      events.push(...data)
      if (data.length < pageSize) break
    }
    return NextResponse.json(
      { observation: summarizeFirstValueObservation(events, { workspaceId: auth.workspaceId }) },
      { headers: { 'cache-control': 'private, no-store' } },
    )
  } catch {
    console.warn('[onboarding/funnel/observation] read failed')
    return NextResponse.json({ error: '퍼널을 불러오지 못했어요.', code: 'FUNNEL_READ_FAILED' }, { status: 503 })
  }
}
