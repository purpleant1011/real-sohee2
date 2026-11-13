import { describe, expect, it } from 'vitest'
import { aggregatePerformance, buildCrossChannelComparison } from './aggregate-performance'

describe('truthful five-channel performance aggregation', () => {
  it('preserves unavailable states instead of turning them into zero', async () => {
    const report = await aggregatePerformance([
      { channel: 'instagram', metric: 'views', state: 'available', value: 120 },
      { channel: 'naver_blog', metric: 'views', state: 'not_connected', value: null },
    ])
    expect(report.channels.naver_blog.metrics.views).toEqual({ state: 'not_connected', value: null })
  })

  it('does not compare unsupported metrics across channels', () => {
    const comparison = buildCrossChannelComparison([
      { channel: 'naver_place', metric: 'saves', state: 'not_supported', value: null },
      { channel: 'instagram', metric: 'saves', state: 'available', value: 10 },
    ])
    expect(comparison.excluded).toContain('naver_place:saves')
  })
})
