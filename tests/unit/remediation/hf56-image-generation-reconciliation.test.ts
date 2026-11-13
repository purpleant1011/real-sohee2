import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ImageGenerationReconciler,
  type GenerationProviderClient,
  type ReconciliationPolicy,
} from '@/features/image-generation-reconciliation'

describe('HF-56 / ANI-1406 · Image Generation Result Reconciliation & Cost-Safe Retry', () => {
  const WORKSPACE_ID = 'ws-img-recon-1'
  const OTHER_WORKSPACE_ID = 'ws-img-recon-2'

  let mockProvider: GenerationProviderClient
  let defaultPolicy: ReconciliationPolicy
  let reconciler: ImageGenerationReconciler

  beforeEach(() => {
    mockProvider = {
      requestGeneration: vi.fn(),
      queryJobStatus: vi.fn(),
    }
    defaultPolicy = {
      maxRetries: 3,
      costPerActionKrw: 1000,
      dailySpendLimitKrw: 5000,
      currentDailySpendKrw: 1000,
    }
    reconciler = new ImageGenerationReconciler({
      providerClient: mockProvider,
      policy: defaultPolicy,
    })
  })

  // Test 1: provider timeout + 실제 result later exists -> reconcile success, duplicate generation 0
  it('1. reconciles timeout job to SUCCEEDED when result exists later without duplicate generation', async () => {
    // 1차 요청: provider 타임아웃 발생 -> RESULT_UNKNOWN 격리
    vi.mocked(mockProvider.requestGeneration).mockRejectedValueOnce(new Error('ETIMEDOUT: Connection timed out'))

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-1',
      testRunId: 'test-run-1',
      harnessVersionId: 'ih-v1',
      prompt: 'A cozy minimalist cafe interior',
      idempotencyKey: 'idem-key-1',
    })

    expect(job.status).toBe('RESULT_UNKNOWN')
    expect(job.attempts).toBe(1)

    // 사후 확인(reconcile): provider에서 실제로 이미지를 완료한 상태임
    vi.mocked(mockProvider.queryJobStatus).mockResolvedValueOnce({
      status: 'SUCCEEDED',
      outputUrl: 'https://cdn.sohee.ai/images/generated-var-1.png',
      externalJobId: 'ext-job-var-1',
    })

    const reconciledJob = await reconciler.reconcileJob(WORKSPACE_ID, job.id)
    expect(reconciledJob.status).toBe('SUCCEEDED')
    expect(reconciledJob.outputUrl).toBe('https://cdn.sohee.ai/images/generated-var-1.png')
    // 중복 생성 요청이 발생하지 않았는지 검증 (requestGeneration은 처음 1회만 호출됨)
    expect(mockProvider.requestGeneration).toHaveBeenCalledTimes(1)
  })

  // Test 2: provider timeout + no definitive answer -> RESULT_UNKNOWN 유지
  it('2. keeps RESULT_UNKNOWN when provider has no definitive answer yet', async () => {
    vi.mocked(mockProvider.requestGeneration).mockRejectedValueOnce(new Error('Gateway Timeout 504'))

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-2',
      idempotencyKey: 'idem-key-2',
    })
    expect(job.status).toBe('RESULT_UNKNOWN')

    // Provider 상태 조회 시 여전히 UNKNOWN/IN_PROGRESS
    vi.mocked(mockProvider.queryJobStatus).mockResolvedValueOnce({
      status: 'RESULT_UNKNOWN',
      message: 'Job state still pending on provider queue',
    })

    const reconciledJob = await reconciler.reconcileJob(WORKSPACE_ID, job.id)
    expect(reconciledJob.status).toBe('RESULT_UNKNOWN')
    expect(reconciledJob.outputUrl).toBeUndefined()
  })

  // Test 3: provider definitive failure -> FAILED
  it('3. transitions to FAILED on definitive provider error without infinite loop', async () => {
    vi.mocked(mockProvider.requestGeneration).mockResolvedValueOnce({
      status: 'FAILED',
      errorCode: 'SAFETY_POLICY_VIOLATION',
      message: 'Prompt contains disallowed terms',
    })

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-3',
      idempotencyKey: 'idem-key-3',
    })

    expect(job.status).toBe('FAILED')
    expect(job.errorCode).toBe('SAFETY_POLICY_VIOLATION')
  })

  // Test 4: repeated retry click/direct API -> idempotent/deduped (중복 과금 0)
  it('4. deduplicates repeated generation clicks via idempotency key', async () => {
    vi.mocked(mockProvider.requestGeneration).mockResolvedValue({
      status: 'SUCCEEDED',
      outputUrl: 'https://cdn.sohee.ai/images/first-run.png',
      externalJobId: 'ext-job-4',
    })

    const params = {
      workspaceId: WORKSPACE_ID,
      variantId: 'var-4',
      idempotencyKey: 'idem-key-4-exact',
    }

    const job1 = await reconciler.startGeneration(params)
    const job2 = await reconciler.startGeneration(params) // 동일 키 재시도

    expect(job1.id).toBe(job2.id)
    expect(job2.status).toBe('SUCCEEDED')
    expect(mockProvider.requestGeneration).toHaveBeenCalledTimes(1) // 1회만 실제 실행
  })

  // Test 5: same test variant lineage 유지
  it('5. preserves variant and test-run lineage across retries and reconciliations', async () => {
    vi.mocked(mockProvider.requestGeneration).mockRejectedValueOnce(new Error('Network drop'))
    vi.mocked(mockProvider.queryJobStatus).mockResolvedValueOnce({
      status: 'FAILED',
      errorCode: 'UNRECOVERABLE_ERROR',
    })

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      testRunId: 'test-run-5',
      variantId: 'variant-a',
      harnessVersionId: 'ih-v2',
      idempotencyKey: 'idem-5-initial',
    })

    expect(job.lineage.testRunId).toBe('test-run-5')
    expect(job.lineage.variantId).toBe('variant-a')
    expect(job.lineage.harnessVersionId).toBe('ih-v2')

    // Reconcile 진행
    const reconciled = await reconciler.reconcileJob(WORKSPACE_ID, job.id)
    expect(reconciled.status).toBe('FAILED')
    // lineage 보존 확인
    expect(reconciled.lineage.testRunId).toBe('test-run-5')
    expect(reconciled.lineage.variantId).toBe('variant-a')
  })

  // Test 6: production image generation의 content/harness lineage 유지
  it('6. preserves content version and creative bundle lineage for production images', async () => {
    vi.mocked(mockProvider.requestGeneration).mockResolvedValueOnce({
      status: 'SUCCEEDED',
      outputUrl: 'https://cdn.sohee.ai/images/prod-creative.png',
    })

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      contentVersionId: 'cnt-ver-100',
      creativeBundleId: 'cb-bundle-200',
      harnessVersionId: 'ih-v3',
      idempotencyKey: 'prod-idem-6',
    })

    expect(job.lineage.contentVersionId).toBe('cnt-ver-100')
    expect(job.lineage.creativeBundleId).toBe('cb-bundle-200')
    expect(job.lineage.harnessVersionId).toBe('ih-v3')
  })

  // Test 7: cost/spend limit 초과 시 추가 retry 차단
  it('7. blocks generation retry when daily spend limit is reached', async () => {
    const tightPolicyReconciler = new ImageGenerationReconciler({
      providerClient: mockProvider,
      policy: {
        maxRetries: 3,
        costPerActionKrw: 2000,
        dailySpendLimitKrw: 3000,
        currentDailySpendKrw: 2500, // 잔여 한도 500원 < 비용 2000원
      },
    })

    await expect(
      tightPolicyReconciler.startGeneration({
        workspaceId: WORKSPACE_ID,
        variantId: 'var-cost-fail',
        idempotencyKey: 'idem-cost-limit',
      })
    ).rejects.toThrowError(/COST_LIMIT_EXCEEDED/)
  })

  // Test 8: cross-tenant job/result id injection deny
  it('8. denies cross-tenant access to jobs or reconciliation', async () => {
    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-tenant-1',
      idempotencyKey: 'idem-tenant-1',
    })

    await expect(
      reconciler.reconcileJob(OTHER_WORKSPACE_ID, job.id)
    ).rejects.toThrowError(/CROSS_TENANT_ACCESS_DENIED/)

    expect(() => {
      reconciler.getJob(OTHER_WORKSPACE_ID, job.id)
    }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
  })

  // Test 9: reconcile worker/job가 다른 workspace asset을 attach하지 않음
  it('9. prevents attaching cross-tenant output assets during reconciliation', async () => {
    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-attach-1',
      idempotencyKey: 'idem-attach-1',
    })

    vi.mocked(mockProvider.queryJobStatus).mockResolvedValueOnce({
      status: 'SUCCEEDED',
      outputUrl: 'https://cdn.sohee.ai/images/other-tenant/asset.png',
      assetWorkspaceId: OTHER_WORKSPACE_ID, // 다른 테넌트의 에셋 ID/경로
    })

    await expect(
      reconciler.reconcileJob(WORKSPACE_ID, job.id)
    ).rejects.toThrowError(/CROSS_TENANT_ASSET_ATTACH_DENIED/)
  })

  // Test 10: provider readback payload/log에 secret leak 없음
  it('10. sanitizes provider payload logs and prevents secret leakage', async () => {
    vi.mocked(mockProvider.requestGeneration).mockResolvedValueOnce({
      status: 'SUCCEEDED',
      outputUrl: 'https://cdn.sohee.ai/images/clean.png',
      rawProviderPayload: {
        secret_api_key: 'sk-secret-token-12345',
        bearer_auth: 'Bearer eyJhbGciOi...',
        image_url: 'https://cdn.sohee.ai/images/clean.png',
      },
    })

    const job = await reconciler.startGeneration({
      workspaceId: WORKSPACE_ID,
      variantId: 'var-clean-1',
      idempotencyKey: 'idem-clean-1',
    })

    const sanitizedLog = reconciler.getSanitizedAuditLog(WORKSPACE_ID, job.id)
    expect(JSON.stringify(sanitizedLog)).not.toContain('sk-secret-token-12345')
    expect(JSON.stringify(sanitizedLog)).not.toContain('eyJhbGciOi')
    expect((sanitizedLog.rawProviderPayload as Record<string, unknown>)?.secret_api_key).toBe('[REDACTED]')
  })
})
