'use client'

import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { ChannelConnections } from '@/features/channels/ui/channel-connections'
import { R2Channels } from '@/features/mobile-channels/r2-channels'
import { useMobileR2Active } from '@/features/mobile-shell/r2-gate'

/** 플래그 OFF(기본)·넓은 화면은 기존 화면 그대로(ANI-1707). */
export function ChannelsEntry() {
  return useMobileR2Active() ? <R2Channels /> : <V088AppShell><ChannelConnections /></V088AppShell>
}
