import type { ChannelHarness } from './channel-harness-schema'

export type ChannelHarnessProvider = Readonly<{
  propose(input: Readonly<{ workspaceId: string; approvedFactIds: readonly string[] }>): Promise<ChannelHarness>
}>

export type GenerationCreditPort = Readonly<{
  reserve(input: Readonly<{ workspaceId: string; operation: 'channel_harness' }>): Promise<Readonly<{ reservationId: string }>>
  settle(reservationId: string): Promise<void>
  release(reservationId: string): Promise<void>
}>
