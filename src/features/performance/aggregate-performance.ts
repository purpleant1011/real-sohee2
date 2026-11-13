import { performanceChannels, type ChannelPerformanceObservation, type PerformanceChannel, type PerformanceMetricName } from './types'

type MetricValue = Readonly<{ state: ChannelPerformanceObservation['state']; value: number | null }>
type ChannelAggregate = Readonly<{ metrics: Readonly<Partial<Record<PerformanceMetricName, MetricValue>>> }>

export async function aggregatePerformance(observations: readonly ChannelPerformanceObservation[]) {
  const channels = Object.fromEntries(performanceChannels.map((channel) => [channel, { metrics: {} }])) as Record<PerformanceChannel, { metrics: Partial<Record<PerformanceMetricName, MetricValue>> }>
  for (const observation of observations) channels[observation.channel].metrics[observation.metric] = Object.freeze({ state: observation.state, value: observation.value })
  return Object.freeze({ channels: Object.freeze(channels as Record<PerformanceChannel, ChannelAggregate>) })
}

export function buildCrossChannelComparison(observations: readonly ChannelPerformanceObservation[]) {
  const excluded = observations.filter((item) => item.state !== 'available').map((item) => `${item.channel}:${item.metric}`)
  const comparable = observations.filter((item) => item.state === 'available')
  return Object.freeze({ comparable: Object.freeze(comparable), excluded: Object.freeze(excluded) })
}
