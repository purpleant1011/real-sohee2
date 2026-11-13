import { calculateVaultFunnelMetrics } from './read-model'
import {
  type RawFunnelEventRow,
  type StageMetricStatus,
  VAULT_FUNNEL_EVENTS,
  type VaultFunnelChannel,
  type VaultFunnelReadModel,
  VAULT_STAGE_LABELS,
} from './types'

type AdminClient = {
  from: (table: string) => any
}

export async function queryVaultFunnel(
  deps: { admin: AdminClient },
  params: {
    workspaceId: string
    period: { from: string; to: string }
    channel?: VaultFunnelChannel | 'ALL'
  },
): Promise<VaultFunnelReadModel> {
  const { workspaceId, period } = params
  const channel = params.channel ?? 'ALL'

  try {
    const queryBuilder = deps.admin
      .from('funnel_events')
      .select('id, workspace_id, user_id, event, occurred_at, properties, dedupe_key')
      .eq('workspace_id', workspaceId)
      .gte('occurred_at', period.from)
      .lte('occurred_at', period.to)
      .in('event', VAULT_FUNNEL_EVENTS as readonly string[])

    const { data, error } = await queryBuilder

    if (error || !Array.isArray(data)) {
      console.error('[vault-funnel] query error:', error ?? 'non-array payload')
      return {
        status: 'ERROR',
        workspaceId,
        channel,
        period,
        totalEvents: 0,
        stages: VAULT_FUNNEL_EVENTS.map((event) => ({
          event,
          label: VAULT_STAGE_LABELS[event],
          count: 0,
          previousStageCount: 0,
          conversionRate: null,
          status: 'NOT_VERIFIED' as StageMetricStatus,
        })),
        overallConversionRate: null,
        error: '보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
      }
    }

    const rows = data as RawFunnelEventRow[]
    if (rows.length >= 1000) {
      return {
        status: 'UNKNOWN',
        workspaceId,
        channel,
        period,
        totalEvents: rows.length,
        stages: VAULT_FUNNEL_EVENTS.map((event) => ({
          event,
          label: VAULT_STAGE_LABELS[event],
          count: 0,
          previousStageCount: 0,
          conversionRate: null,
          status: 'NOT_VERIFIED' as StageMetricStatus,
        })),
        overallConversionRate: null,
        error: '데이터가 너무 많아 전체 퍼널을 확인할 수 없습니다.',
      }
    }

    return calculateVaultFunnelMetrics({
      workspaceId,
      period,
      channel,
      rows,
    })
  } catch (err: any) {
    console.error('[vault-funnel] unexpected query exception:', err)
    return {
      status: 'ERROR',
      workspaceId,
      channel,
      period,
      totalEvents: 0,
      stages: VAULT_FUNNEL_EVENTS.map((event) => ({
        event,
        label: VAULT_STAGE_LABELS[event],
        count: 0,
        previousStageCount: 0,
        conversionRate: null,
        status: 'NOT_VERIFIED' as StageMetricStatus,
      })),
      overallConversionRate: null,
      error: '보관함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.',
    }
  }
}
