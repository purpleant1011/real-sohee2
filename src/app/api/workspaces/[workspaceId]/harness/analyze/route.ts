export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { openAIHarnessAnalyzer } from '@/features/harness/openai-harness-analyzer'
import { harnessKernel } from '@/features/harness/harness-kernel'
import { harnessStore } from '@/lib/harness/harness-store'
import { HarnessAsset, HarnessVersion } from '@/types/harness'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params

  // Cross-tenant guard: refuse a non-member before running the analyzer or creating assets.
  const auth = await authorizeQuickRequest(workspaceId)
  if (isResponse(auth)) return auth

  try {
    const body = await request.json()
    const { url, platform = 'instagram' } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'url is required' },
        { status: 400 }
      )
    }

    const norm = harnessKernel.normalizeUrl(url)

    // 1. OpenAI Harness Analyzer 호출
    const analyzed = await openAIHarnessAnalyzer.analyzeHarness({
      platform: norm.platform,
      sourceUrl: norm.canonicalUrl,
      sourceHandle: norm.handle,
      captions: [
        '아침마다 양쪽 눈썹 그리느라 15분씩 씨름하셨나요?',
        '공장식 시술이 아닌 1:1 퍼스널 골격 진단 디자인',
        '시술 직후에도 짱구 눈썹 없이 자연스러운 일상 복귀'
      ],
      commentSamples: ['가격 문의드립니다', '주말 예약 가능한가요?']
    })

    // 2. HarnessAsset & Immutable Version 생성
    const { asset } = harnessKernel.getOrCreateHarnessAsset({
      workspaceId,
      sourceUrl: norm.canonicalUrl,
      title: `${norm.handle} 맞춤 운영 기준`,
      createdByUserId: 'user_admin'
    })

    asset.coreDna = analyzed.coreDna
    asset.moduleReadiness = {
      text: 'READY',
      visual: 'PARTIAL',
      operations: 'READY',
      community: 'PARTIAL',
      platform: 'READY'
    }

    const version = harnessKernel.addHarnessVersion(
      asset.id,
      {
        schemaVersion: '1.1.0',
        compilerVersion: 'sohee-luna-5.6',
        analyzerVersion: 'sohee-analyzer-v1.1',
        textJson: analyzed.textJson,
        visualJson: analyzed.visualJson,
        operationsJson: analyzed.operationsJson,
        communityJson: analyzed.communityJson,
        platformJson: analyzed.platformJson,
        evidenceScore: analyzed.evidenceScore,
        confidence: analyzed.confidence
      },
      analyzed.rules
    )

    // 3. HarnessStore에 동기화
    harnessStore.addAsset(asset, version, harnessKernel.getRules(version.id))

    return NextResponse.json({
      ok: true,
      asset,
      version,
      rules: harnessKernel.getRules(version.id)
    })
  } catch (error: any) {
    console.error('[HarnessAnalyzeAPI Error]', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
