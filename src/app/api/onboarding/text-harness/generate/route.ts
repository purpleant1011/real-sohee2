export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  generateTextCalibrationSamples,
  TextCalibrationProviderError,
} from '@/features/text-harness/provider-text-calibration-service'

/**
 * [ANI-1458] Real Provider-Backed Text Calibration Generation Route
 * Uses Gemini 3.5 Flash Lite to produce 3 candidate posts or regenerate upon natural feedback.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

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

    let businessType = typeof body.businessType === 'string' ? body.businessType.trim() : ''
    let keywords = Array.isArray(body.keywords) ? body.keywords.filter(Boolean) : []

    if (!businessType) {
      const { loadActiveKnowledgeHarness } = await import('@/features/knowledge/knowledge-server')
      const activeHarness = await loadActiveKnowledgeHarness(workspaceId, supabase)
      if (activeHarness) {
        const policies = (activeHarness.policies || []) as Array<{ key: string; value: string; category?: string }>
        const offerings = (activeHarness.offerings || []) as Array<{ key: string; value: string; category?: string }>
        const diffFact = policies.find((f: any) =>
          f.key.includes('특징') || f.key.includes('차별') || f.key.includes('업종') || f.key.includes('업태') || f.key.includes('매장') || f.category === 'DIFFERENTIATOR'
        ) || offerings.find((f: any) =>
          f.key.includes('특징') || f.key.includes('차별') || f.key.includes('업종') || f.key.includes('업태') || f.key.includes('매장') || f.category === 'DIFFERENTIATOR'
        )
        businessType = diffFact?.value || activeHarness.business_identity?.businessType || ''

        if (keywords.length === 0) {
          const menuFact = offerings.find((f: any) => f.key.includes('메뉴') || f.key.includes('서비스') || f.key.includes('시술'))
          if (menuFact?.value) keywords.push(menuFact.value)
        }
      }

      if (!businessType) {
        const [profileRes, wsRes] = await Promise.all([
          supabase.from('business_profiles').select('business_name, industry').eq('workspace_id', workspaceId).maybeSingle(),
          supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
        ])
        businessType = profileRes?.data?.industry || profileRes?.data?.business_name || wsRes?.data?.name || ''
      }
    }

    const result = await generateTextCalibrationSamples({
      workspaceId,
      businessType: businessType || undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      baseToneKey: body.baseToneKey,
      feedbackUtterance: body.feedbackUtterance,
      channel: body.channel || 'instagram',
    })

    return NextResponse.json({
      success: true,
      samples: result.samples,
      model: result.model,
      styleSummary: result.styleSummary,
      extractedRules: result.extractedRules,
    }, { status: 200 })
  } catch (err: unknown) {
    console.error('[text-harness/generate error]:', err)
    if (err instanceof TextCalibrationProviderError) {
      return NextResponse.json(
        {
          error: `말투 스타일 생성에 실패했습니다: ${err.message}`,
          code: err.code,
        },
        { status: 502 }
      )
    }

    return NextResponse.json(
      {
        error: (err as Error).message || '말투 스타일 생성 중 서버 오류가 발생했습니다.',
      },
      { status: 500 }
    )
  }
}
