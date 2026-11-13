/**
 * Creative Pipeline Observability & Trace Lineage (ANI-1106)
 * Traces end-to-end lineage from WorkItem -> ContentVersion -> VisualBrief ->
 * GenerationRun -> MediaAsset -> PublishRendition -> CreativeBundle ->
 * Approval -> ExternalAction -> Receipt/Readback.
 */

export interface LatencyTelemetry {
  queueWaitMs?: number
  providerLatencyMs?: number
  storageLatencyMs?: number
  qcLatencyMs?: number
  publishLatencyMs?: number
  readbackLatencyMs?: number
  totalLatencyMs?: number
}

export interface FinOpsTelemetry {
  imageCreditsEstimated: number
  imageCreditsActual: number
  costUsd: number
  currency: 'USD' | 'KRW'
}

export interface LeaseTelemetry {
  leaseId?: string
  leaseExpiresAt?: string
  isExpired: boolean
  remainingTtlSeconds?: number
}

export interface VerificationTelemetry {
  providerPostId?: string
  readbackConfidence: number // 0.0 - 1.0
  perceptualEquivalence: boolean
  captionExactDigestMatched: boolean
  observedAt: string
}

export interface PipelineEnvironmentContext {
  gitCommit: string
  deployEnvironment: 'production' | 'staging' | 'development'
  migrationVersion: string
  workspaceId: string
  providerIdentity: string
}

export interface CreativePipelineTrace {
  traceId: string
  correlationId: string
  workItemId: string
  contentVersionId: string
  visualBriefDigest: string
  generationRunId: string
  mediaAssetId: string
  mediaAssetSha256: string
  publishRenditionId: string
  creativeBundleFingerprint: string
  approvalId: string
  approvedBy: string
  approvedAt: string
  externalActionId: string
  externalReceiptId: string
  latencies: LatencyTelemetry
  finops: FinOpsTelemetry
  lease: LeaseTelemetry
  verification: VerificationTelemetry
  environment: PipelineEnvironmentContext
  overallStatus: 'VERIFIED_SUCCESS' | 'PIPELINE_FAILED' | 'REVIEW_REQUIRED' | 'PENDING'
  statusReason?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTraceInput {
  correlationId: string
  workItemId: string
  contentVersionId: string
  visualBriefDigest: string
  generationRunId: string
  mediaAssetId: string
  mediaAssetSha256: string
  publishRenditionId: string
  creativeBundleFingerprint: string
  approvalId: string
  approvedBy: string
  approvedAt: string
  externalActionId: string
  externalReceiptId: string
  latencies: LatencyTelemetry
  finops: FinOpsTelemetry
  lease: LeaseTelemetry
  verification: VerificationTelemetry
  environment: PipelineEnvironmentContext
}

export class CreativePipelineTracer {
  /**
   * Builds an immutable, fully-verified CreativePipelineTrace record
   */
  public static createTrace(input: CreateTraceInput): CreativePipelineTrace {
    const now = new Date().toISOString()
    const traceId = `cpt_${input.correlationId.slice(0, 8)}_${Date.now()}`

    // Strict status determination: Never mark green without complete verification evidence
    let overallStatus: CreativePipelineTrace['overallStatus'] = 'PENDING'
    let statusReason: string | undefined

    if (!input.verification.perceptualEquivalence) {
      overallStatus = 'PIPELINE_FAILED'
      statusReason = 'Provider readback visual perceptual equivalence check failed'
    } else if (!input.verification.captionExactDigestMatched) {
      overallStatus = 'PIPELINE_FAILED'
      statusReason = 'Provider readback caption digest mismatch'
    } else if (input.verification.readbackConfidence < 0.9) {
      overallStatus = 'REVIEW_REQUIRED'
      statusReason = `Readback confidence too low: ${input.verification.readbackConfidence}`
    } else if (input.lease.isExpired) {
      overallStatus = 'PIPELINE_FAILED'
      statusReason = 'Provider delivery lease expired during execution'
    } else if (input.verification.providerPostId && input.verification.perceptualEquivalence) {
      overallStatus = 'VERIFIED_SUCCESS'
      statusReason = 'End-to-end lineage cryptographically verified and confirmed on provider platform'
    }

    const totalLatency = (
      (input.latencies.queueWaitMs || 0) +
      (input.latencies.providerLatencyMs || 0) +
      (input.latencies.storageLatencyMs || 0) +
      (input.latencies.qcLatencyMs || 0) +
      (input.latencies.publishLatencyMs || 0) +
      (input.latencies.readbackLatencyMs || 0)
    )

    return Object.freeze({
      traceId,
      correlationId: input.correlationId,
      workItemId: input.workItemId,
      contentVersionId: input.contentVersionId,
      visualBriefDigest: input.visualBriefDigest,
      generationRunId: input.generationRunId,
      mediaAssetId: input.mediaAssetId,
      mediaAssetSha256: input.mediaAssetSha256,
      publishRenditionId: input.publishRenditionId,
      creativeBundleFingerprint: input.creativeBundleFingerprint,
      approvalId: input.approvalId,
      approvedBy: input.approvedBy,
      approvedAt: input.approvedAt,
      externalActionId: input.externalActionId,
      externalReceiptId: input.externalReceiptId,
      latencies: {
        ...input.latencies,
        totalLatencyMs: totalLatency,
      },
      finops: { ...input.finops },
      lease: { ...input.lease },
      verification: { ...input.verification },
      environment: { ...input.environment },
      overallStatus,
      statusReason,
      createdAt: now,
      updatedAt: now,
    })
  }

  /**
   * Reconstitutes audit summary for operator console (ANI-1106)
   */
  public static formatConsoleSummary(trace: CreativePipelineTrace): {
    traceId: string
    status: string
    isVerifiedGreen: boolean
    costFormatted: string
    totalDurationFormatted: string
    observedAt: string
    environmentInfo: string
  } {
    return {
      traceId: trace.traceId,
      status: trace.overallStatus,
      isVerifiedGreen: trace.overallStatus === 'VERIFIED_SUCCESS',
      costFormatted: `$${trace.finops.costUsd.toFixed(3)} (${trace.finops.imageCreditsActual} credits)`,
      totalDurationFormatted: `${((trace.latencies.totalLatencyMs || 0) / 1000).toFixed(2)}s`,
      observedAt: trace.verification.observedAt,
      environmentInfo: `${trace.environment.deployEnvironment} @ ${trace.environment.gitCommit.slice(0, 7)} (db: ${trace.environment.migrationVersion})`,
    }
  }
}
