export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { createProductionGenerationOrchestrator } from '@/features/creative/production-generation-factory'
import { buildVisualBrief } from '@/features/creative/visual-brief-builder'
import { translateInternalErrorToHuman } from '@/features/onboarding/conversation/human-error-translator'
import { getModelProfile } from '@/lib/ai/model-profiles'
import type { CreativeStylePreset } from '@/features/creative/creative-generation-types'

/**
 * [ANI-1458] Real Provider-Backed Image Generation Pipeline for Image Harness
 * Connects to OpenAI GPT Image 2.5 via GenerationOrchestrator, uploads to private Storage,
 * and persists to media_assets table with admin credentials to bypass client RLS.
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
    const prompt = body.prompt || body.recommendedSubject
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return NextResponse.json({ error: '이미지 생성 프롬프트가 필요합니다.' }, { status: 400 })
    }

    const modelPresence = body.modelPresence || 'MODEL_ABSENT'
    const feedbackUtterance = body.feedbackUtterance || ''

    const adminSupabase = createAdminSupabaseClient()
    const orchestrator = createProductionGenerationOrchestrator({
      supabaseClient: adminSupabase,
      workspaceId,
      userId: user.id,
    })

    const generateCount = body.generateBatch ? 3 : (body.count || 1)
    // Server owns operation classification and presence policy enforcement:
    // If modelPresence is MODEL_ABSENT or HAND_OR_DETAIL_ONLY, we must NEVER force sunburst (human portrait).
    // Sunburst is used ONLY when modelPresence is MODEL_PRESENT and isFeedbackOrEdit.
    const allowsHumanModel = modelPresence === 'MODEL_PRESENT'
    const isFeedbackOrEdit = Boolean(feedbackUtterance || body.referenceAssetId)
    const stylePreset: CreativeStylePreset = isFeedbackOrEdit && allowsHumanModel ? 'sunburst' : 'flare'
    const defaultModel = getModelProfile('image').modelId || 'gpt-image-2.5-sunburst'

    const generatedAssets = []
    const runIds = []

    let businessName = typeof body.businessName === 'string' ? body.businessName.trim() : ''
    let industry = typeof body.industry === 'string' ? body.industry.trim() : ''

    if (!businessName || !industry) {
      try {
        const bpQuery: any = supabase.from('business_profiles').select('business_name, industry').eq('workspace_id', workspaceId)
        const wsQuery: any = supabase.from('workspaces').select('name').eq('id', workspaceId)
        const [bpRes, wsRes] = await Promise.all([
          typeof bpQuery?.maybeSingle === 'function' ? bpQuery.maybeSingle() : bpQuery,
          typeof wsQuery?.maybeSingle === 'function' ? wsQuery.maybeSingle() : wsQuery,
        ])
        if (!businessName) {
          businessName = bpRes?.data?.business_name || wsRes?.data?.name || (Array.isArray(wsRes?.data) ? wsRes.data[0]?.name : undefined) || '우리 매장'
        }
        if (!industry && bpRes?.data?.industry) {
          industry = bpRes.data.industry
        }
      } catch {
        if (!businessName) businessName = '우리 매장'
      }
    }

    for (let seq = 1; seq <= generateCount; seq++) {
      const idempotencyKey = `img_calib_${workspaceId}_${Date.now()}_${seq}_${Math.random().toString(36).slice(2, 6)}`
      const requestFingerprint = createHash('sha256')
        .update(`${workspaceId}:${prompt}:${stylePreset}:${seq}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`)
        .digest('hex')

      const visualBrief = buildVisualBrief({
        workspaceId,
        contentVersionId: `onboarding_calib_${workspaceId}`,
        businessContext: {
          name: businessName,
          ...(industry ? { industry } : {}),
        },
        productContext: {
          name: typeof body.productName === 'string' && body.productName.trim() ? body.productName.trim() : undefined,
        },
        channel: 'instagram',
        caption: prompt.trim(),
      })

      const result = await orchestrator.execute({
        idempotencyKey,
        requestFingerprint,
        sequenceNumber: seq,
        workspaceId,
        userId: user.id,
        contentVersionId: `onboarding_calib_${workspaceId}`,
        visualBrief,
        size: '1024x1024',
        stylePreset,
      })

      if (result.status !== 'READY' || !result.mediaAsset) {
        if (seq === 1) {
          return NextResponse.json(
            { error: result.error?.message || '이미지 생성에 실패했습니다.' },
            { status: 500 }
          )
        }
        break
      }

      // Canonical Private Media Route (Never getPublicUrl)
      const canonicalPreviewUrl = `/api/workspaces/${workspaceId}/media/${result.mediaAsset.id}`

      generatedAssets.push({
        id: result.mediaAsset.id,
        digest: result.sha256 || result.mediaAsset.sha256_digest,
        url: canonicalPreviewUrl,
        storagePath: result.mediaAsset.object_path,
        modelPresence,
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: modelPresence === 'MODEL_ABSENT' ? 'NOT_APPLICABLE' : 'CONFIRMED',
        provenance: {
          model: (result.mediaAsset?.generation_metadata?.policySnapshot as any)?.model ||
            result.usage?.model ||
            defaultModel,
          stylePreset,
          prompt: prompt.trim(),
        },
        revisionLineage: feedbackUtterance
          ? {
              originalAssetId: body.referenceAssetId || result.mediaAsset.id,
              feedbackUtterance,
              revisedAt: new Date().toISOString(),
            }
          : undefined,
      })
      runIds.push(result.runId)
    }

    return NextResponse.json({
      success: true,
      assets: generatedAssets,
      asset: generatedAssets[0],
      runIds,
    }, { status: 201 })
  } catch (err: unknown) {
    console.error('[image-harness/generate error]:', err)
    const humanError = translateInternalErrorToHuman(err)
    return NextResponse.json(
      {
        error: humanError.whatHappened,
        reassurance: humanError.whatSoheeDid,
        actionHint: humanError.ownerAction,
        detail: (err as Error).message || '이미지 생성 처리 오류',
      },
      { status: 500 }
    )
  }
}
