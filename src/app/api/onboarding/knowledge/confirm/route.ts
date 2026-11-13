export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { persistKnowledgeHarness } from '@/features/knowledge/knowledge-server'
import type { KnowledgeHarnessVersion, ConfirmedKnowledgeFact, KnowledgeCategory } from '@/features/knowledge/knowledge-manager'

/**
 * P0-9: Real Database Persistence for Business Knowledge Harness
 * Saves confirmed facts into workspace_knowledge_harnesses table with is_active = true.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

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
      return NextResponse.json({ error: '워크스페이스를 찾을 수 없습니다.' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const rawFacts: Array<{ category: KnowledgeCategory; key: string; value: string }> = body.facts || []

    if (!Array.isArray(rawFacts) || rawFacts.length === 0) {
      return NextResponse.json(
        { error: '최소 1개 이상의 매장 기본 지식 항목이 필요합니다.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    const versionNumber = body.versionNumber || 1
    const harnessVersionId = `bkh_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

    const confirmedFacts: ConfirmedKnowledgeFact[] = rawFacts.map((f, idx) => ({
      id: `ckf_${idx}_${Date.now()}`,
      workspaceId,
      candidateId: `cand_${idx}`,
      category: f.category,
      factKey: f.key,
      factValue: f.value,
      status: 'ACTIVE',
      confirmedBy: user.id,
      confirmedAt: now,
    }))

    const version: KnowledgeHarnessVersion = {
      id: harnessVersionId,
      workspaceId,
      versionNumber,
      factsSnapshot: confirmedFacts,
      createdAt: now,
      createdBy: user.id,
    }

    await persistKnowledgeHarness(version, supabase)

    const { getSoheeReadiness } = await import('@/features/sohee-ready/read-model')
    const { computeTutorialJourneyProgress } = await import('@/features/tutorial-journey/tutorial-journey-read-model')

    let nextAction = {
      label: '공식 채널 연동하기',
      href: '/start?step=channels',
      description: 'Meta 공식 계정으로 안전하게 로그인하고 권한을 위임합니다.',
    }
    try {
      const readiness = await getSoheeReadiness(workspaceId, { supabaseClient: supabase })
      const journey = computeTutorialJourneyProgress(readiness)
      if (journey?.primaryAction?.href) {
        nextAction = journey.primaryAction
      }
    } catch {
      // safe fallback to /start?step=channels
    }

    return NextResponse.json({
      success: true,
      harnessVersionId,
      versionNumber,
      totalFacts: confirmedFacts.length,
      confirmedAt: now,
      message: '매장 지식베이스가 DB에 정상 확정되었습니다. (BUSINESS_KNOWLEDGE_CONFIRMED)',
      nextAction,
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[knowledge/confirm error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '지식베이스 확정에 실패했습니다.' },
      { status: 500 }
    )
  }
}
