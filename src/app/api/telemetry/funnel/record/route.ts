export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  type FunnelStep,
  validateFunnelEvent,
  sanitizeTelemetryMetadata,
  createFunnelEvent,
  recordGlobalFunnelEvent,
  persistFunnelEventToDatabase,
} from '@/features/telemetry/first-post-funnel-telemetry'

export async function POST(req: Request) {
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

    const body = await req.json().catch(() => ({}))
    const { correlationId, step, correlationStartTime, metadata } = body

    // Validate payload
    const validation = validateFunnelEvent({
      workspaceId,
      correlationId,
      step,
    })

    if (!validation.isValid) {
      return NextResponse.json(
        { error: '유효하지 않은 퍼널 텔레메트리 이벤트입니다.', details: validation.errors },
        { status: 422 }
      )
    }

    // Create sanitized event
    const event = createFunnelEvent({
      workspaceId,
      correlationId,
      step: step as FunnelStep,
      correlationStartTime,
      metadata: sanitizeTelemetryMetadata(metadata),
    })

    // Store in ring buffer
    recordGlobalFunnelEvent(event)

    // Durable persistence into mission_events
    await persistFunnelEventToDatabase({
      supabase,
      event,
      actorUserId: user.id,
    }).catch((e: any) => {
      console.warn('[telemetry/funnel/record] Optional audit event log note:', e?.message || e)
    })

    return NextResponse.json({
      success: true,
      event: {
        step: event.step,
        stepIndex: event.stepIndex,
        timestamp: event.timestamp,
        durationMsFromStart: event.durationMsFromStart,
      },
    })
  } catch (err: any) {
    console.error('[telemetry/funnel/record error]:', err)
    return NextResponse.json(
      { error: err.message || '텔레메트리 기록 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
