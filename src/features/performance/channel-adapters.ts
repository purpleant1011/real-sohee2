import type { ChannelPerformanceResult, PerformanceChannel } from './types'
export interface ChannelPerformanceAdapter { readonly channel: PerformanceChannel; collect(input: Readonly<{ workspaceId: string; periodStart: string; periodEnd: string }>): Promise<ChannelPerformanceResult> }
export async function collectChannelPerformance(adapter: ChannelPerformanceAdapter, input: Readonly<{ workspaceId: string; periodStart: string; periodEnd: string }>) { return adapter.collect(input) }
