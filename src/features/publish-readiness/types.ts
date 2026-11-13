export type OverallReadinessState = 'ready' | 'blocked' | 'unknown'
export type ChannelReadinessState = 'ready' | 'blocked' | 'unknown'
export type ItemReadinessState = 'ok' | 'blocked' | 'unknown'
export type ReadinessChannelName = 'instagram' | 'threads'

export interface ReadinessAction {
  label: string
  href: string
}

export interface ReadinessItem {
  key: string
  label: string
  state: ItemReadinessState
  reason: string | null
  action: ReadinessAction | null
}

export interface ChannelReadiness {
  channel: ReadinessChannelName
  channel_label: string
  state: ChannelReadinessState
  items: ReadinessItem[]
}

export interface PublishReadinessResult {
  state: OverallReadinessState
  channels: ChannelReadiness[]
  global_items: ReadinessItem[]
}
