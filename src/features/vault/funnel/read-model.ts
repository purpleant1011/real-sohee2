import {
  type RawFunnelEventRow,
  type StageMetricStatus,
  VAULT_FUNNEL_EVENTS,
  type VaultFunnelChannel,
  type VaultFunnelEventName,
  type VaultFunnelReadModel,
  type VaultFunnelStageMetric,
  VAULT_STAGE_LABELS,
} from './types'

function round1(val: number): number {
  return Math.round(val * 10) / 10
}

export function calculateVaultFunnelMetrics({
  workspaceId,
  period,
  channel,
  rows,
}: {
  workspaceId: string
  period: { from: string; to: string }
  channel: VaultFunnelChannel | 'ALL'
  rows: readonly RawFunnelEventRow[]
}): VaultFunnelReadModel {
  // Filter rows by channel if not ALL
  const filtered = rows.filter((r) => {
    if (channel === 'ALL') return true
    const eventChannel = r.properties?.channel
    return eventChannel === channel
  })

  const totalEvents = filtered.length

  // Count by event type (deduped by dedupe_key or unique record id)
  const counts: Record<VaultFunnelEventName, number> = {
    preview_opened: 0,
    vault_saved: 0,
    vault_edited: 0,
    reapproved: 0,
    release_requested: 0,
    publish_verified: 0,
  }

  // Count unique occurrences per event
  const seenDedupe = new Set<string>()
  for (const row of filtered) {
    const ev = row.event as VaultFunnelEventName
    if (!counts.hasOwnProperty(ev)) continue

    const key = `${ev}:${row.dedupe_key || row.id}`
    if (seenDedupe.has(key)) continue
    seenDedupe.add(key)

    counts[ev]++
  }

  if (totalEvents === 0) {
    return {
      status: 'EMPTY',
      workspaceId,
      channel,
      period,
      totalEvents: 0,
      overallConversionRate: null,
      stages: VAULT_FUNNEL_EVENTS.map((event) => ({
        event,
        label: VAULT_STAGE_LABELS[event],
        count: 0,
        previousStageCount: 0,
        conversionRate: null,
        status: 'EMPTY' as StageMetricStatus,
      })),
    }
  }

  // Define previous stage mapping
  const previousMap: Record<VaultFunnelEventName, VaultFunnelEventName | null> = {
    preview_opened: null,
    vault_saved: 'preview_opened',
    vault_edited: 'vault_saved',
    reapproved: 'vault_edited',
    release_requested: 'vault_saved',
    publish_verified: 'release_requested',
  }

  const stages: VaultFunnelStageMetric[] = VAULT_FUNNEL_EVENTS.map((event) => {
    const count = counts[event]
    const prevEv = previousMap[event]
    const prevCount = prevEv ? counts[prevEv] : count

    let conversionRate: number | null = null
    let status: StageMetricStatus = 'VERIFIED'

    if (event === 'preview_opened') {
      conversionRate = count > 0 ? 100.0 : null
      status = count > 0 ? 'VERIFIED' : 'EMPTY'
    } else {
      if (prevCount > 0) {
        conversionRate = round1((count / prevCount) * 100)
        status = 'VERIFIED'
      } else {
        // Missing previous stage: MUST NOT forge a fake 0.0% or 100%
        conversionRate = null
        status = count > 0 ? 'NOT_VERIFIED' : 'EMPTY'
      }
    }

    return {
      event,
      label: VAULT_STAGE_LABELS[event],
      count,
      previousStageCount: prevCount,
      conversionRate,
      status,
    }
  })

  const previewCount = counts.preview_opened
  const verifiedCount = counts.publish_verified
  const overallConversionRate =
    previewCount > 0 ? round1((verifiedCount / previewCount) * 100) : null

  return {
    status: 'OK',
    workspaceId,
    channel,
    period,
    totalEvents,
    stages,
    overallConversionRate,
  }
}
