import type { ChannelPerformanceAdapter } from './channel-adapters'
import type { ChannelPerformanceObservation, PerformanceChannel, PerformanceMetricName, PerformanceMetricState } from './types'

export interface MetaInsightsPort {
  collect(input: Readonly<{ channel: 'instagram' | 'threads'; workspaceId: string; periodStart: string; periodEnd: string }>): Promise<Readonly<{ state: PerformanceMetricState; metrics: readonly Readonly<{ metric: PerformanceMetricName; value: number | null }>[] }>>
}

export function createMetaChannelAdapter(channel: 'instagram' | 'threads', port: MetaInsightsPort): ChannelPerformanceAdapter {
  return {
    channel,
    async collect(input) {
      try {
        const raw = await port.collect({ channel, ...input })
        const source = raw.metrics.length ? raw.metrics : [{ metric: 'views' as const, value: null }]
        const observations: ChannelPerformanceObservation[] = source.map((metric) => ({ channel, metric: metric.metric, state: raw.state, value: raw.state === 'available' ? metric.value : null }))
        return Object.freeze({ channel, observations: Object.freeze(observations) })
      } catch {
        return Object.freeze({ channel, observations: Object.freeze([{ channel, metric: 'views' as const, state: 'failed' as const, value: null }]) })
      }
    },
  }
}

export function createUnavailableChannelAdapter(channel: Exclude<PerformanceChannel, 'instagram' | 'threads'>, state: Extract<PerformanceMetricState, 'not_connected' | 'not_supported'>): ChannelPerformanceAdapter {
  return { channel, async collect() { return Object.freeze({ channel, observations: Object.freeze([{ channel, metric: 'views' as const, state, value: null }]) }) } }
}
