type Channel = 'instagram' | 'threads'

type Receipt = {
  stage?: string
  providerPostId?: string
  permalink?: string
  verifiedAt?: string
  errorMessage?: string
}

/**
 * Aggregate success is not evidence: each requested channel needs its own verified receipt.
 * Verified additionally requires the readback timestamp — a stage label alone, and even a
 * provider ID plus URL without a recorded readback, is not independence we can point at.
 */
export function firstValuePublishOutcome(channels: readonly Channel[], executionResult?: {
  overallStatus?: string
  receipts?: Partial<Record<Channel, Receipt>>
}) {
  const results = channels.map((channel) => {
    const receipt = executionResult?.receipts?.[channel]
    const verifiedAt = receipt?.verifiedAt?.trim() || null
    const verified = receipt?.stage === 'EXTERNALLY_VERIFIED' &&
      Boolean(receipt.providerPostId?.trim()) && Boolean(receipt.permalink?.trim()) &&
      Boolean(verifiedAt)
    const failed = receipt?.stage === 'FAILED' && !receipt.providerPostId
    return {
      channel,
      verified,
      providerPostId: receipt?.providerPostId || null,
      permalink: receipt?.permalink || null,
      verifiedAt,
      errorCode: receipt?.errorMessage || null,
      status: verified ? 'VERIFIED' as const : failed ? 'FAILED' as const : 'RESULT_UNKNOWN' as const,
      stage: receipt?.stage || 'RESULT_UNKNOWN',
    }
  })
  const verified = results.length > 0 && results.every((r) => r.verified)
  const overallStatus = verified ? 'ALL_VERIFIED' as const
    : results.some((r) => r.verified) ? 'PARTIAL_SUCCESS' as const
    : results.some((r) => r.status === 'RESULT_UNKNOWN') ? 'RESULT_UNKNOWN' as const
    : 'FAILED' as const
  return {
    verified,
    overallStatus,
    results,
    permalink: results.find((r) => r.verified)?.permalink || null,
    channel: channels[0] || null,
  }
}
