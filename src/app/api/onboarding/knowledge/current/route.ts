export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { loadActiveKnowledgeHarness } from '@/features/knowledge/knowledge-server'
import type { ConversationalBusinessKnowledgeDraft } from '@/features/knowledge/conversational-knowledge'

/**
 * [ANI-1446] Read current active confirmed knowledge for store-grounded calibration
 */
export async function GET() {
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

    const activeHarness = await loadActiveKnowledgeHarness(workspaceId, supabase)

    if (!activeHarness) {
      return NextResponse.json({
        success: true,
        knowledge: null,
        isConfirmed: false,
      })
    }

    const offerings = (activeHarness.offerings || []) as Array<{ key: string; value: string }>
    const policies = (activeHarness.policies || []) as Array<{ key: string; value: string }>

    const menuFact = offerings.find((f) => f.key.includes('메뉴') || f.key.includes('서비스') || f.key.includes('시술'))
    const priceFact = offerings.find((f) => f.key.includes('가격') || f.key.includes('단가'))
    const hoursFact = policies.find((f) => f.key.includes('시간') || f.key.includes('휴무'))
    const locFact = policies.find((f) => f.key.includes('위치') || f.key.includes('주소') || f.key.includes('지역')) ||
                    offerings.find((f) => f.key.includes('위치') || f.key.includes('주소'))
    const resFact = policies.find((f) => f.key.includes('예약'))
    const diffFact = policies.find((f: any) =>
      f.key.includes('특징') || f.key.includes('차별') || f.key.includes('업종') || f.key.includes('업태') || f.key.includes('매장') || f.category === 'DIFFERENTIATOR'
    ) || offerings.find((f: any) =>
      f.key.includes('특징') || f.key.includes('차별') || f.key.includes('업종') || f.key.includes('업태') || f.key.includes('매장') || f.category === 'DIFFERENTIATOR'
    )

    let businessType = diffFact?.value || activeHarness.business_identity?.businessType
    let storeName: string | undefined = activeHarness.business_identity?.storeName || activeHarness.business_identity?.name

    if (!businessType || !storeName) {
      const [profileRes, wsRes] = await Promise.all([
        supabase.from('business_profiles').select('business_name, industry').eq('workspace_id', workspaceId).maybeSingle(),
        supabase.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
      ])
      storeName = storeName || profileRes?.data?.business_name || wsRes?.data?.name
      if (!businessType) {
        businessType = profileRes?.data?.industry || storeName
      }
    }

    const knowledge: ConversationalBusinessKnowledgeDraft & { storeName?: string } = {
      workspaceId,
      storeName,
      primaryServices: menuFact?.value || (offerings[0]?.value ?? undefined),
      pricing: priceFact?.value || (offerings[1]?.value ?? undefined),
      operatingHours: hoursFact?.value || undefined,
      location: locFact?.value || undefined,
      reservationPolicy: resFact?.value || undefined,
      businessType: businessType || undefined,
    }

    return NextResponse.json({
      success: true,
      knowledge,
      isConfirmed: true,
      harnessVersionId: activeHarness.harness_version_id,
      versionNo: activeHarness.version_no,
    })
  } catch (err: unknown) {
    console.error('[knowledge/current error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '지식 정보를 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}
