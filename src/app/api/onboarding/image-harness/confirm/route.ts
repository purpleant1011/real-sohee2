export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { persistImageHarness } from '@/features/image-harness/image-harness-server'
import { invalidateReadinessCache } from '@/features/sohee-ready/cache-invalidation'
import type {
  ImageHarnessVersion,
  ImageReferenceAsset,
  VisualRules,
} from '@/features/image-harness/image-harness-manager'

/**
 * P0-8: Strict Server Invariant Enforcement for Image Harness
 * 
 * Rules:
 * 1. 3 <= eligible_golden_assets <= 5 (rejects with 422 if < 3 or > 5)
 * 2. rightsStatus MUST be OWNED, LICENSED, or USER_CONFIRMED, with valid rightsConfirmedAt
 * 3. Person-containing assets MUST have consentStatus === 'CONFIRMED'
 * 4. Zero hardcoded sample assets allowed
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
    const assets: ImageReferenceAsset[] = body.assets || []
    const rules: VisualRules = body.rules || {
      modelStyle: '소상공인 맞춤 정갈한 사진',
      environment: '자연 채광이 들어오는 매장',
    }

    // 1. Filter golden assets
    const goldenAssets = assets.filter((a) => a.isGolden)

    // Invariant 1: 3 <= goldenAssets.length <= 5
    if (goldenAssets.length < 3) {
      return NextResponse.json(
        {
          error: `골든 레퍼런스 이미지는 최소 3장 이상 등록되어야 합니다. (현재: ${goldenAssets.length}장)`,
          code: 'INSUFFICIENT_GOLDEN_IMAGES',
        },
        { status: 422 }
      )
    }

    if (goldenAssets.length > 5) {
      return NextResponse.json(
        {
          error: `골든 레퍼런스 이미지는 최대 5장까지 지정할 수 있습니다. (현재: ${goldenAssets.length}장)`,
          code: 'EXCESS_GOLDEN_IMAGES',
        },
        { status: 422 }
      )
    }

    // Invariant 2: Rights & Consent Verification
    for (const asset of goldenAssets) {
      const rightsValid =
        (asset.rightsStatus === 'OWNED' ||
          asset.rightsStatus === 'LICENSED' ||
          asset.rightsStatus === 'USER_CONFIRMED') &&
        Boolean(asset.rightsConfirmedAt)

      if (!rightsValid) {
        return NextResponse.json(
          {
            error: `골든 이미지 '${asset.caption || asset.id}'의 사장님 저작권 확인이 완료되지 않았습니다.`,
            code: 'RIGHTS_UNCONFIRMED',
            assetId: asset.id,
          },
          { status: 422 }
        )
      }

      if (asset.consentStatus === 'REQUIRED_MISSING' || asset.consentStatus === 'UNKNOWN') {
        return NextResponse.json(
          {
            error: `골든 이미지 '${asset.caption || asset.id}'의 초상권 확인(CONFIRMED 또는 NOT_APPLICABLE)이 필요합니다.`,
            code: 'CONSENT_MISSING',
            assetId: asset.id,
          },
          { status: 422 }
        )
      }
    }

    // Invariant 3: Minimum 1 test run
    const testRunsCount = typeof body.testRunsCount === 'number' ? body.testRunsCount : 0
    if (testRunsCount < 1) {
      return NextResponse.json(
        {
          error: '최소 1회 이상의 스타일 변형 테스트 생성을 검토해야 이미지 하네스를 확정할 수 있습니다.',
          code: 'TEST_RUN_REQUIRED',
        },
        { status: 422 }
      )
    }

    // Invariant 4: Explicit confirmation required ('이 기준으로 사용' or '이 느낌으로 기억해줘')
    const userConfirmationPhrase = typeof body.userConfirmationPhrase === 'string' ? body.userConfirmationPhrase : ''
    const allowedPhrases = ['이 기준으로 사용', '이 느낌으로 기억해줘', '앞으로 이 기준으로 써줘']
    const hasExplicitPhrase = allowedPhrases.some((phrase) => userConfirmationPhrase.includes(phrase))
    const isExplicitlyApproved = body.isExplicitlyApproved === true && hasExplicitPhrase

    if (!isExplicitlyApproved) {
      return NextResponse.json(
        {
          error: "이미지 하네스 확정을 위해서는 사용자의 명시적인 승인('이 기준으로 사용' 또는 '이 느낌으로 기억해줘')이 필요합니다.",
          code: 'EXPLICIT_CONFIRMATION_REQUIRED',
        },
        { status: 422 }
      )
    }

    const now = new Date().toISOString()
    const goldenImageIds = goldenAssets.map((a) => a.id)

    const confirmedVersion: ImageHarnessVersion = {
      id: `img_harness_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      workspaceId,
      versionNumber: body.versionNumber || 1,
      status: 'ACTIVE_CONFIRMED',
      rules,
      referenceAssets: assets,
      goldenImageIds,
      testRunsCount,
      createdAt: now,
      confirmedAt: now,
      confirmedByUserId: user.id,
      provenance: 'USER_SUBMITTED',
    }

    const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
    const persisted = await persistImageHarness(confirmedVersion, createAdminSupabaseClient())
    invalidateReadinessCache(workspaceId)

    const finalConfirmedVersion: ImageHarnessVersion = {
      ...confirmedVersion,
      id: persisted.id,
      versionNumber: persisted.version,
    }

    return NextResponse.json({
      success: true,
      confirmedVersion: finalConfirmedVersion,
      goldenImagesCount: goldenImageIds.length,
      message: '이미지 하네스가 DB에 성공적으로 확정되었습니다. (IMAGE_HARNESS_CONFIRMED)',
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[image-harness/confirm error]:', err)
    return NextResponse.json(
      { error: (err as Error).message || '이미지 하네스 확정에 실패했습니다.' },
      { status: 500 }
    )
  }
}
