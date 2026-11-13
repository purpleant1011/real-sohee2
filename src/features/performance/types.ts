export const performanceChannels = ['instagram', 'threads', 'naver_blog', 'naver_place', 'daangn_business'] as const
export type PerformanceChannel = (typeof performanceChannels)[number]
export type PerformanceMetricState = 'available' | 'collecting' | 'not_supported' | 'permission_denied' | 'failed' | 'not_connected'
export type PerformanceMetricName = 'views' | 'likes' | 'comments' | 'saves' | 'shares' | 'replies' | 'reposts' | 'quotes' | 'visits' | 'inquiries'
export type ChannelPerformanceObservation = Readonly<{ channel: PerformanceChannel; metric: PerformanceMetricName; state: PerformanceMetricState; value: number | null }>
export type ChannelPerformanceResult = Readonly<{ channel: PerformanceChannel; observations: readonly ChannelPerformanceObservation[] }>
