import { describe, it, expect } from 'vitest'
import { CreativePipelineTracer, type CreateTraceInput } from '@/features/observability/creative-pipeline-tracer'

describe('CreativePipelineTracer (ANI-1106)', () => {
  const baseInput: CreateTraceInput = {
    correlationId: 'corr-tart-001',
    workItemId: 'wi-100',
    contentVersionId: 'cv-200',
    visualBriefDigest: 'b'.repeat(64),
    generationRunId: 'gen-300',
    mediaAssetId: 'ma-400',
    mediaAssetSha256: 'a'.repeat(64),
    publishRenditionId: 'pr-500',
    creativeBundleFingerprint: 'f'.repeat(64),
    approvalId: 'app-600',
    approvedBy: 'user-operator',
    approvedAt: new Date().toISOString(),
    externalActionId: 'act-700',
    externalReceiptId: 'rcpt-800',
    latencies: {
      queueWaitMs: 120,
      providerLatencyMs: 2500,
      storageLatencyMs: 400,
      qcLatencyMs: 300,
      publishLatencyMs: 800,
      readbackLatencyMs: 600,
    },
    finops: {
      imageCreditsEstimated: 1,
      imageCreditsActual: 1,
      costUsd: 0.08,
      currency: 'USD',
    },
    lease: {
      leaseId: 'lease-900',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      isExpired: false,
      remainingTtlSeconds: 60,
    },
    verification: {
      providerPostId: 'ig_post_123456789',
      readbackConfidence: 0.98,
      perceptualEquivalence: true,
      captionExactDigestMatched: true,
      observedAt: new Date().toISOString(),
    },
    environment: {
      gitCommit: 'b775eb6046e7f8a912',
      deployEnvironment: 'production',
      migrationVersion: '20260908160000',
      workspaceId: 'ws-bakery',
      providerIdentity: 'meta_graph_v20',
    },
  }

  it('assembles a full creative lineage trace with total latency calculation', () => {
    const trace = CreativePipelineTracer.createTrace(baseInput)

    expect(trace.traceId).toContain('cpt_corr-tar')
    expect(trace.overallStatus).toBe('VERIFIED_SUCCESS')
    expect(trace.latencies.totalLatencyMs).toBe(120 + 2500 + 400 + 300 + 800 + 600)
    expect(trace.finops.costUsd).toBe(0.08)
    expect(trace.verification.perceptualEquivalence).toBe(true)
  })

  it('fails the trace closed if perceptual equivalence check fails (False-Green defense)', () => {
    const failedInput: CreateTraceInput = {
      ...baseInput,
      verification: {
        ...baseInput.verification,
        perceptualEquivalence: false,
      },
    }

    const trace = CreativePipelineTracer.createTrace(failedInput)
    expect(trace.overallStatus).toBe('PIPELINE_FAILED')
    expect(trace.statusReason).toContain('perceptual equivalence check failed')
  })

  it('fails the trace closed if provider delivery lease was expired during publish', () => {
    const expiredInput: CreateTraceInput = {
      ...baseInput,
      lease: {
        ...baseInput.lease,
        isExpired: true,
      },
    }

    const trace = CreativePipelineTracer.createTrace(expiredInput)
    expect(trace.overallStatus).toBe('PIPELINE_FAILED')
    expect(trace.statusReason).toContain('lease expired')
  })

  it('requires manual review if readback confidence is low (< 0.9)', () => {
    const lowConfInput: CreateTraceInput = {
      ...baseInput,
      verification: {
        ...baseInput.verification,
        readbackConfidence: 0.85,
      },
    }

    const trace = CreativePipelineTracer.createTrace(lowConfInput)
    expect(trace.overallStatus).toBe('REVIEW_REQUIRED')
    expect(trace.statusReason).toContain('confidence too low')
  })

  it('formats console summary accurately for operator dashboards', () => {
    const trace = CreativePipelineTracer.createTrace(baseInput)
    const summary = CreativePipelineTracer.formatConsoleSummary(trace)

    expect(summary.isVerifiedGreen).toBe(true)
    expect(summary.costFormatted).toBe('$0.080 (1 credits)')
    expect(summary.totalDurationFormatted).toBe('4.72s')
    expect(summary.environmentInfo).toContain('production @ b775eb6')
  })
})
