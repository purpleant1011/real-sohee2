export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  calculateFunnelMetrics,
  aggregateFailureTaxonomy,
  FUNNEL_STEPS,
  getGlobalFunnelEvents,
  fetchPersistedFunnelEvents,
  fetchPersistedFunnelEventsResult,
  mergeFunnelEvents,
  type FunnelEventPayload,
} from '@/features/telemetry/first-post-funnel-telemetry'

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)

    const workspaceId = members?.[0]?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: '소속된 매장(Workspace)이 없습니다.' }, { status: 403 })
    }

    // 1. Read events from in-memory store
    const memoryEvents: FunnelEventPayload[] = getGlobalFunnelEvents(workspaceId)

    // 2. Read durable events from mission_events table with explicit evidence status (R2-B9)
    const dbResult = await fetchPersistedFunnelEventsResult(supabase, workspaceId)

    // If DB failed and in-memory events are unavailable, fail closed with evidenceUnavailable
    if (dbResult.evidenceUnavailable && memoryEvents.length === 0) {
      return NextResponse.json(
        {
          success: false,
          evidenceUnavailable: true,
          error: `텔레메트리 데이터베이스 조회에 실패하여 지표를 산출할 수 없습니다: ${dbResult.error}`,
          workspaceId,
        },
        { status: 500 }
      )
    }

    // 3. Merge and deduplicate
    const combinedEvents = mergeFunnelEvents(dbResult.events, memoryEvents)

    // Calculate metrics
    const funnelMetrics = calculateFunnelMetrics(combinedEvents, workspaceId)
    const failureTaxonomy = aggregateFailureTaxonomy(combinedEvents)

    return NextResponse.json({
      success: true,
      workspaceId,
      evidenceUnavailable: dbResult.evidenceUnavailable,
      funnelMetrics,
      failureTaxonomy,
      availableSteps: FUNNEL_STEPS,
    })
  } catch (err: any) {
    console.error('[telemetry/funnel/metrics error]:', err)
    return NextResponse.json(
      { error: err.message || '텔레메트리 지표 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
