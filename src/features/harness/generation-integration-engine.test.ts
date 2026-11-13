import { describe, it, expect } from 'vitest'
import { generationIntegrationEngine } from './generation-integration-engine'
import { HarnessVersion, BrandKnowledgeSnapshot } from '@/types/harness'

describe('GenerationIntegrationEngine (ANI-255, ANI-256)', () => {
  const mockVersion: HarnessVersion = {
    id: 'ver_inst_1',
    harnessAssetId: 'asset_inst_1',
    versionNo: 1,
    schemaVersion: '1.1.0',
    compilerVersion: 'sohee-luna-5.6',
    textJson: {
      contentPillars: ['전문진단'],
      hookPatterns: ['양쪽 눈썹 비대칭 고민'],
      captionArchetypes: [],
      paragraphRhythm: '3문장',
      sentenceLengthProfile: '간결체',
      toneVector: { professional: 0.9, empathy: 0.85, directness: 0.7, urgency: 0.6 },
      authorityPatterns: [],
      proofPatterns: [],
      problemSolutionGrammar: '고민->해결',
      ctaPatterns: ['프로필 링크 100% 예약제'],
      forbiddenCliches: ['공장식 덤핑 시술']
    },
    visualJson: {} as any,
    operationsJson: {} as any,
    communityJson: {} as any,
    platformJson: {} as any,
    evidenceScore: 92,
    confidence: 90,
    immutable: true,
    createdAt: new Date().toISOString()
  }

  const mockBrand: BrandKnowledgeSnapshot = {
    id: 'brand_snap_1',
    workspaceId: 'ws_tenant_1',
    businessName: '바이름 뷰티랩',
    industry: 'BEAUTY_PERMANENT_MAKEUP',
    verifiedPriceList: { '자연눈썹': 180000 },
    address: '인천 연수구 송도동 12-3',
    bookingUrl: 'https://booking.naver.com/1234',
    operatingHours: '10:00 - 20:00',
    phone: '032-123-4567',
    snapshotHash: 'brand_hash_1',
    createdAt: new Date().toISOString()
  }

  it('compiles immutable generation prompt with SHA-256 hash', () => {
    const res = generationIntegrationEngine.compileGenerationPrompt({
      workspaceId: 'ws_tenant_1',
      channel: 'instagram',
      harnessVersion: mockVersion,
      brandSnapshot: mockBrand,
      goalPrompt: '첫 방문 고객을 위한 자연눈썹 진단 피드 작성'
    })

    expect(res.promptHash).toBeDefined()
    expect(res.promptHash.length).toBe(64) // SHA-256 hex string
    expect(res.systemPrompt).toContain('바이름 뷰티랩')
    expect(res.systemPrompt).toContain('v1')
  })

  it('evaluates generated output and produces Calibrated Evaluation scores (Threshold >= 85)', () => {
    const validOutput = `안녕하세요! 바이름 뷰티랩입니다. 아침마다 양쪽 눈썹 그리느라 고생하셨나요? 1:1 맞춤 진단으로 자연스럽게 정돈해 드립니다. 프로필 링크 100% 예약제로 편하게 상담받아보세요.`

    const evalResult = generationIntegrationEngine.evaluateOutput(validOutput, {
      workspaceId: 'ws_tenant_1',
      channel: 'instagram',
      harnessVersion: mockVersion,
      brandSnapshot: mockBrand,
      goalPrompt: '피드 작성'
    })

    expect(evalResult.passed).toBe(true)
    expect(evalResult.overallScore).toBeGreaterThanOrEqual(85)
    expect(evalResult.scores.brandAccuracy).toBe(95)
    expect(evalResult.scores.harnessFit).toBe(92)
  })

  it('blocks publication when output contains forbidden clichés or omits brand name', () => {
    const badOutput = `공장식 덤핑 시술 최저가 보장! 지금 당장 예약하세요.`

    const evalResult = generationIntegrationEngine.evaluateOutput(badOutput, {
      workspaceId: 'ws_tenant_1',
      channel: 'instagram',
      harnessVersion: mockVersion,
      brandSnapshot: mockBrand,
      goalPrompt: '피드 작성'
    })

    expect(evalResult.passed).toBe(false)
    expect(evalResult.scores.brandAccuracy).toBe(60) // omitted brand name
    expect(evalResult.scores.harnessFit).toBe(55) // used forbidden cliche
  })
})
