export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import type { LearningCandidate } from '@/features/onboarding/first-meeting/first-meeting-service'

const ALLOWED_PROFILE_KEYS = new Set([
  'business_identity',
  'primary_offering',
  'primary_audience',
  'marketing_goal',
  'approval_policy',
  'channel_presence',
])

function normalizeProfileKey(key: string): string {
  if (ALLOWED_PROFILE_KEYS.has(key)) return key
  if (key === 'brand_tone' || key === 'expectation' || key === 'role' || key === 'goal') {
    return 'marketing_goal'
  }
  if (key === 'business_name' || key === 'industry') {
    return 'business_identity'
  }
  if (key === 'product' || key === 'service' || key === 'menu') {
    return 'primary_offering'
  }
  if (key === 'target' || key === 'customer' || key === 'audience') {
    return 'primary_audience'
  }
  return 'marketing_goal'
}

// In-memory workspace cache for quick local/edge resolution
const workspaceFirstMeetingCache = new Map<
  string,
  { expectationText: string; candidates: LearningCandidate[]; updatedAt: string }
>()

/**
 * [ANI-1441] First Meeting Expectation & Candidate Persistence Route
 *
 * Persists and hydrates owner expectations and extracted candidates across reloads.
 * Strictly maintains draft/CANDIDATE status — NEVER auto-confirms or elevates to active truth.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)

    const workspaceId = members?.[0]?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 1. Check canonical workspace_profile_candidates table
    try {
      const { data: dbCandidates } = await (supabase as any)
        .from('workspace_profile_candidates')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })

      if (dbCandidates && dbCandidates.length > 0) {
        const rehydratedCandidates: LearningCandidate[] = dbCandidates.map((row: any) => ({
          key: row.profile_key,
          label: row.profile_key === 'marketing_goal' ? '소희에게 바라는 역할' : '기대 사항',
          value: row.proposed_value,
          status: 'CANDIDATE' as const,
          version: row.version || 1,
          sourceUtterance: row.evidence_quote || row.original_value,
          previousValues: [],
        }))

        const latestUtterance = dbCandidates[0]?.evidence_quote || dbCandidates[0]?.original_value || ''
        return NextResponse.json({
          success: true,
          expectationText: latestUtterance,
          candidates: rehydratedCandidates,
        })
      }
    } catch (e: any) {
      console.warn('[first-meeting GET] workspace_profile_candidates query notice:', e?.message || e)
    }

    // 2. Check in-memory cache
    const cached = workspaceFirstMeetingCache.get(workspaceId)
    if (cached) {
      return NextResponse.json({
        success: true,
        expectationText: cached.expectationText,
        candidates: cached.candidates,
      })
    }

    // 3. Query mission_events for latest recorded expectation
    try {
      const { data: events } = await (supabase as any)
        .from('mission_events')
        .select('payload')
        .eq('workspace_id', workspaceId)
        .eq('event_type', 'FIRST_MEETING_EXPECTATION_RECORDED')
        .order('created_at', { ascending: false })
        .limit(1)

      if (events && events.length > 0 && events[0]?.payload) {
        const payload = events[0].payload as any
        const loaded = {
          expectationText: payload.expectationText || '',
          candidates: payload.candidates || [],
          updatedAt: payload.updatedAt || new Date().toISOString(),
        }
        workspaceFirstMeetingCache.set(workspaceId, loaded)
        return NextResponse.json({
          success: true,
          expectationText: loaded.expectationText,
          candidates: loaded.candidates,
        })
      }
    } catch {
      // Graceful fallback if table query fails
    }

    return NextResponse.json({
      success: true,
      expectationText: '',
      candidates: [],
    })
  } catch (err: unknown) {
    console.error('[first-meeting GET error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '첫 만남 기대사항을 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증 세션이 필요합니다.' }, { status: 401 })
    }

    const { data: members } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)

    const workspaceId = members?.[0]?.workspace_id
    if (!workspaceId) {
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const expectationText: string = typeof body.expectationText === 'string' ? body.expectationText : ''
    const rawCandidates: any[] = Array.isArray(body.candidates) ? body.candidates : []

    // Ensure all candidates strictly retain CANDIDATE status
    const sanitizedCandidates: LearningCandidate[] = rawCandidates.map((c) => ({
      key: String(c.key || 'expectation'),
      label: String(c.label || '기대 사항'),
      value: String(c.value || ''),
      status: 'CANDIDATE' as const,
      version: Number(c.version) || 1,
      sourceUtterance: String(c.sourceUtterance || expectationText),
      previousValues: Array.isArray(c.previousValues) ? c.previousValues : [],
    }))

    const record = {
      expectationText,
      candidates: sanitizedCandidates,
      updatedAt: new Date().toISOString(),
    }

    workspaceFirstMeetingCache.set(workspaceId, record)

    // 1. Canonical Persistence to workspace_profile_candidates
    const targetClient = createAdminSupabaseClient()

    let sessionId: string | null = null
    const { data: sessionData } = await targetClient
      .from('onboarding_sessions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .limit(1)

    if (sessionData && sessionData.length > 0 && sessionData[0]?.id) {
      sessionId = sessionData[0].id
    } else {
      // Create session infrastructure if it does not yet exist
      let threadId = randomUUID()
      const { data: threadData } = await (targetClient as any)
        .from('conversation_threads')
        .select('id')
        .eq('workspace_id', workspaceId)
        .limit(1)

      if (threadData && threadData.length > 0 && threadData[0]?.id) {
        threadId = threadData[0].id
      } else {
        await (targetClient as any)
          .from('conversation_threads')
          .insert({
            id: threadId,
            workspace_id: workspaceId,
            kind: 'onboarding',
            title: '소희와 첫 준비 대화',
            status: 'active',
          })
      }

      let kSourceId = randomUUID()
      const { data: kSourceData } = await (targetClient as any)
        .from('knowledge_sources')
        .select('id')
        .eq('workspace_id', workspaceId)
        .limit(1)

      if (kSourceData && kSourceData.length > 0 && kSourceData[0]?.id) {
        kSourceId = kSourceData[0].id
      } else {
        await (targetClient as any)
          .from('knowledge_sources')
          .insert({
            id: kSourceId,
            workspace_id: workspaceId,
            source_type: 'manual',
            provider_mode: 'registered_only',
            display_name: '첫 만남 기대사항',
            status: 'registered',
            created_by_user_id: user.id,
          })
      }

      sessionId = randomUUID()
      await (targetClient as any)
        .from('onboarding_sessions')
        .insert({
          id: sessionId,
          workspace_id: workspaceId,
          user_id: user.id,
          thread_id: threadId,
          knowledge_source_id: kSourceId,
          status: 'in_progress',
          active_step: 'business_identity',
          start_client_request_id: randomUUID(),
        })
    }

    // Persist each valid candidate with its own compliant onboarding_answer
    for (const cand of sanitizedCandidates) {
      const profileKey = normalizeProfileKey(cand.key)
      const clientRequestId = randomUUID()
      const answerId = randomUUID()

      await (targetClient as any)
        .from('onboarding_answers')
        .insert({
          id: answerId,
          session_id: sessionId,
          workspace_id: workspaceId,
          user_id: user.id,
          profile_key: profileKey,
          content: cand.value || cand.sourceUtterance || expectationText,
          client_request_id: clientRequestId,
        })

      const row = {
        workspace_id: workspaceId,
        user_id: user.id,
        session_id: sessionId,
        answer_id: answerId,
        profile_key: profileKey,
        original_value: (cand.sourceUtterance || expectationText || cand.value).slice(0, 4000),
        proposed_value: cand.value.slice(0, 4000),
        confirmed_value: null, // Strictly CANDIDATE, never confirmed silently
        confidence: 0.95,
        evidence_quote: (cand.sourceUtterance || expectationText || cand.value).slice(0, 2000),
        source: 'onboarding_answer',
        status: 'review_required', // Canonical DB status corresponding to CANDIDATE
        version: cand.version || 1,
        updated_at: record.updatedAt,
      }

      const { error: candErr } = await (targetClient as any)
        .from('workspace_profile_candidates')
        .upsert(row, { onConflict: 'workspace_id,profile_key' })

      if (candErr) {
        throw new Error(`Failed to persist workspace profile candidate ${cand.key}: ${candErr.message}`)
      }
    }



    // 2. Persist to mission_events table for durable audit
    try {
      await (supabase as any).from('mission_events').insert({
        workspace_id: workspaceId,
        event_type: 'FIRST_MEETING_EXPECTATION_RECORDED',
        payload: record,
        created_at: record.updatedAt,
      })
    } catch (e: any) {
      console.warn('[first-meeting POST] mission_events log warning:', e?.message || e)
    }

    return NextResponse.json({
      success: true,
      expectationText: record.expectationText,
      candidates: record.candidates,
    })
  } catch (err: unknown) {
    console.error('[first-meeting POST error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '첫 만남 기대사항을 저장하지 못했습니다.' },
      { status: 500 }
    )
  }
}
