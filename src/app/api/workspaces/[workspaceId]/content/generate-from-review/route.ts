export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { generateReviewContent } from '@/features/knowledge/naver-place/review-to-content'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    const admin = auth.admin

    // Fetch business profile to get Naver place rating and facts
    const { data: profile } = await admin
      .from('business_profiles')
      .select('business_name, location, industry, summary')
      .eq('workspace_id', auth.workspaceId)
      .maybeSingle()

    if (!profile?.business_name || !profile.business_name.trim()) {
      return NextResponse.json(
        { error: '사업장 프로필 정보가 등록되지 않았습니다.' },
        { status: 400, headers: NO_STORE }
      )
    }

    const summaryText = profile.summary || ''
    const ratingMatch = summaryText.match(/(\d+\.\d+)점?/)
    const reviewCountMatch = summaryText.match(/리뷰\s*(\d+)개?/)

    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null
    const reviewCount = reviewCountMatch ? parseInt(reviewCountMatch[1], 10) : null

    const result = generateReviewContent({
      businessName: profile.business_name.trim(),
      location: profile.location?.trim() || undefined,
      rating,
      reviewCount,
    })

    return NextResponse.json({ ok: true, options: result.options }, { status: 200, headers: NO_STORE })
  } catch (err: any) {
    console.error('[generate-from-review] Error:', err)
    return NextResponse.json({ error: err.message || '리뷰 콘텐츠 생성에 실패했습니다.' }, { status: 500, headers: NO_STORE })
  }
}
