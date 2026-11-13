export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { generationIntegrationEngine } from '@/features/harness/generation-integration-engine'
import { crossChannelAdapter } from '@/features/harness/cross-channel-adapter'
import { harnessStore } from '@/lib/harness/harness-store'
import { BrandKnowledgeSnapshot, PlatformType } from '@/types/harness'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard: harnessStore is process-wide and holds brand knowledge, so a
  // non-member must be refused before any harness lookup or preview generation.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { harnessId, targetPlatform = 'instagram', topic = '첫 방문 고객 맞춤 케어' } = body

    const asset = harnessStore.getAssetById(harnessId)
    if (!asset || !asset.activeVersionId) {
      return NextResponse.json(
        { ok: false, error: 'Harness or active version not found' },
        { status: 404 }
      )
    }

    const version = harnessStore.getVersionById(asset.activeVersionId)
    if (!version) {
      return NextResponse.json(
        { ok: false, error: 'Version not found' },
        { status: 404 }
      )
    }

    const mockBrandSnapshot: BrandKnowledgeSnapshot = {
      id: 'brand_snap_current',
      workspaceId,
      businessName: '스튜디오 바이름',
      industry: 'BEAUTY_PERMANENT_MAKEUP',
      verifiedPriceList: { '자연눈썹': 180000, '콤보눈썹': 220000 },
      address: '인천 연수구 송도동 12-3 센트럴파크',
      bookingUrl: 'https://booking.naver.com/byreum',
      operatingHours: '10:00 - 20:00 (월요일 휴무)',
      phone: '010-1234-5678',
      snapshotHash: 'brand_hash_current',
      createdAt: new Date().toISOString()
    }

    // 1. 컴파일된 프롬프트 & SHA-256 해시 생성
    const compiled = generationIntegrationEngine.compileGenerationPrompt({
      workspaceId,
      channel: targetPlatform,
      harnessVersion: version,
      brandSnapshot: mockBrandSnapshot,
      goalPrompt: `${topic}에 대한 매력적인 SNS 피드 작성`,
      compilerVersion: 'sohee-luna-5.6'
    })

    // 2. 크로스 플랫폼 번역 생성
    const adapted = crossChannelAdapter.adapt({
      targetPlatform: targetPlatform as PlatformType,
      textHarness: version.textJson,
      brandName: mockBrandSnapshot.businessName,
      location: '인천 연수구 송도 센트럴파크',
      topic
    })

    const previewOutput = adapted.title ? `[${adapted.title}]\n\n${adapted.body}\n\n${adapted.cta}` : `${adapted.body}\n\n${adapted.cta}`

    // 3. Calibrated Evaluator 점수 산정
    const evalResult = generationIntegrationEngine.evaluateOutput(previewOutput, {
      workspaceId,
      channel: targetPlatform,
      harnessVersion: version,
      brandSnapshot: mockBrandSnapshot,
      goalPrompt: topic
    })

    // 4. Provenance 레코드 생성
    const provenance = generationIntegrationEngine.createProvenanceRecord(
      `prov_${Date.now()}`,
      {
        workspaceId,
        channel: targetPlatform,
        harnessVersion: version,
        brandSnapshot: mockBrandSnapshot,
        goalPrompt: topic
      },
      compiled.promptHash,
      evalResult
    )

    return NextResponse.json({
      ok: true,
      preview: {
        platform: targetPlatform,
        topic,
        content: previewOutput,
        promptHash: compiled.promptHash,
        evalResult,
        provenance
      }
    })
  } catch (error: any) {
    console.error('[HarnessPreviewAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
