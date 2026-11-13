import { describe, it, expect, beforeEach } from 'vitest'
import { HarnessKernel } from './harness-kernel'
import { HarnessCompiler } from './harness-compiler'
import { HarnessJobRunner } from './harness-job-runner'
import { CrossChannelAdapter } from './cross-channel-adapter'
import { RuntimeSafetyGate } from './runtime-safety-gate'
import { HarnessGenerationRuntime } from './harness-generation-runtime'
import { QUALITY_SEVEN_FIXTURES, qualityTestHarnessEvaluator } from './quality-test-harness'

describe('SOHEE Harness Knowledge OS — Full E2E Integration Suite (v1.1)', () => {
  let kernel: HarnessKernel
  let compiler: HarnessCompiler
  let jobRunner: HarnessJobRunner
  let adapter: CrossChannelAdapter
  let safetyGate: RuntimeSafetyGate
  let genRuntime: HarnessGenerationRuntime

  beforeEach(() => {
    kernel = new HarnessKernel()
    compiler = new HarnessCompiler()
    jobRunner = new HarnessJobRunner(kernel, compiler)
    adapter = new CrossChannelAdapter()
    safetyGate = new RuntimeSafetyGate()
    genRuntime = new HarnessGenerationRuntime()
  })

  it('AC-45: Multi-Tenant Isolation — Two independent Workspaces analyzing same benchmark URL are 100% isolated', async () => {
    const wsA = 'ws_cheongna_beauty'
    const wsB = 'ws_gangnam_beauty'
    const targetUrl = 'https://www.instagram.com/studio_by.reum'

    // Workspace A compiles harness
    const runA = await jobRunner.executeJob({
      workspaceId: wsA,
      sourceUrl: targetUrl,
      idempotencyKey: 'job_ws_a_001',
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })
    expect(runA.success).toBe(true)

    // Workspace B compiles same harness
    const runB = await jobRunner.executeJob({
      workspaceId: wsB,
      sourceUrl: targetUrl,
      idempotencyKey: 'job_ws_b_001',
      jobType: 'INITIAL_COMPILE',
      availableCreditBalance: 500
    })
    expect(runB.success).toBe(true)

    // Distinct assets and versions per workspace
    expect(runA.assetId).not.toBe(runB.assetId)
    expect(runA.versionId).not.toBe(runB.versionId)

    const assetsA = kernel.getAssetsByWorkspace(wsA)
    const assetsB = kernel.getAssetsByWorkspace(wsB)
    expect(assetsA.length).toBe(1)
    expect(assetsB.length).toBe(1)
    expect(assetsA[0].id).toBe(runA.assetId)
    expect(assetsB[0].id).toBe(runB.assetId)
  })

  it('AC-27: GenerationRun Provenance captures exact prompt hash and passes calibrated gate', async () => {
    const wsId = 'ws_provenance_test'
    const { asset } = kernel.getOrCreateHarnessAsset({
      workspaceId: wsId,
      sourceUrl: 'https://instagram.com/studio_by.reum',
      createdByUserId: 'user_test'
    })

    const compiled = compiler.compile({
      platform: 'instagram',
      sourceUrl: 'https://instagram.com/studio_by.reum',
      captions: ['출근길 눈썹 씨름 고민']
    })

    const version = kernel.addHarnessVersion(
      asset.id,
      {
        schemaVersion: '1.1.0',
        compilerVersion: 'sohee-luna-5.6',
        textJson: compiled.textJson,
        visualJson: compiled.visualJson,
        operationsJson: compiled.operationsJson,
        communityJson: compiled.communityJson,
        platformJson: compiled.platformJson,
        evidenceScore: 92,
        confidence: 88
      },
      compiled.rules
    )

    const genRun = await genRuntime.runGeneration({
      workspaceId: wsId,
      harnessVersionId: version.id,
      brandKnowledgeSnapshotId: 'snap_brand_001',
      missionId: 'mission_morning_001',
      targetPlatform: 'instagram',
      textHarness: version.textJson,
      brandFacts: { brandName: '바이름 청라점', location: '인천 청라' },
      topic: '퍼스널 뷰티 진단',
      textModelVersion: 'gemini-2.5-flash'
    })

    expect(genRun.id).toBeDefined()
    expect(genRun.compiledPromptHash).toContain('sha256_')
    expect(genRun.passedGate).toBe(true)
    expect(genRun.publishProofRef).toBeDefined()
  })

  it('AC-30: Evaluates 7 Standard Quality Test Harness Fixtures 100% accurately', () => {
    for (const fixture of QUALITY_SEVEN_FIXTURES) {
      const res = qualityTestHarnessEvaluator.evaluateFixture(fixture)
      expect(res.passed).toBe(true)
      expect(res.verdict).toBe(fixture.expectedVerdict)
      if (fixture.expectedReason) {
        expect(res.reason).toBe(fixture.expectedReason)
      }
    }
  })
})
