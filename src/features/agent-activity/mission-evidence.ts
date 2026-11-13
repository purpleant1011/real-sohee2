import type { ApprovalPreviewSnapshot } from '@/features/content/types'

export interface MissionArtifactReview {
  preview: ApprovalPreviewSnapshot
  cost: { state: 'UNKNOWN' }
  approvalAllowed: false
  blockers: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface MissionEvidence {
  reservations: { state: 'UNKNOWN' } | { state: 'CONFIRMED'; count: number; observedAt: string }
  channels: { provider: 'instagram' | 'threads'; connection: 'CONNECTED' | 'NOT_CONNECTED' | 'UNKNOWN'; permission: 'GRANTED' | 'UNKNOWN' }[]
  price: { state: 'UNKNOWN' } | { state: 'CONFIRMED'; amountKrw: number; source: 'FIRST_POST_POLICY' }
}

export function projectMissionEvidence(
  scope: { workspaceId: string; missionId: string; runId: string },
  steps: unknown[],
  firstPostDraft: unknown,
): MissionEvidence {
  const result: MissionEvidence = { reservations: { state: 'UNKNOWN' }, channels: [], price: { state: 'UNKNOWN' } }
  // The caller binds the run to this mission before loading its durable steps.
  const reads = steps.filter(isRecord).filter(row => row.workspace_id === scope.workspaceId
    && row.job_id === scope.runId && row.capability_id === 'reservation.list')
    // Completion time cannot order an unfinished, newer read. The ledger's step index can.
    .sort((a, b) => typeof a.step_index === 'number' && typeof b.step_index === 'number'
      ? b.step_index - a.step_index : 0)
  const latest = reads[0]
  if (latest?.status === 'completed' && typeof latest.completed_at === 'string'
    && Number.isFinite(Date.parse(latest.completed_at)) && isRecord(latest.output_payload)) {
    const output = latest.output_payload
    if (Number.isSafeInteger(output.count) && (output.count as number) >= 0
      && Array.isArray(output.reservations) && output.reservations.length === output.count
      && output.empty === (output.count === 0)) {
      result.reservations = { state: 'CONFIRMED', count: output.count as number, observedAt: latest.completed_at }
    }
  }
  if (isRecord(firstPostDraft) && firstPostDraft.datasetMode === 'ACTUAL') {
    if (Array.isArray(firstPostDraft.channels)) {
      for (const channel of firstPostDraft.channels) {
        if (!isRecord(channel) || (channel.provider !== 'instagram' && channel.provider !== 'threads')) continue
        const connection = channel.connection === 'CONNECTED' || channel.connection === 'NOT_CONNECTED' ? channel.connection : 'UNKNOWN'
        result.channels.push({ provider: channel.provider, connection,
          permission: connection === 'CONNECTED' && channel.publishPermission === 'GRANTED' ? 'GRANTED' : 'UNKNOWN' })
      }
    }
    const quote = firstPostDraft.costQuote
    if (isRecord(quote) && quote.source === 'POLICY' && quote.amountKrw === 0) {
      result.price = { state: 'CONFIRMED', amountKrw: 0, source: 'FIRST_POST_POLICY' }
    }
  }
  return result
}
