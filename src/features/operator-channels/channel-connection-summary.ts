import type { OperatorChannelConnection } from './schemas'

export type ConnectionBucket = 'connected' | 'reconnect' | 'released' | 'connecting'

const BUCKET: Record<OperatorChannelConnection['connectionStatus'], ConnectionBucket> = {
  connected: 'connected',
  connecting: 'connecting',
  disconnected: 'released',
  expired: 'reconnect',
  reverify_required: 'reconnect',
  missing_permission: 'reconnect',
  wrong_account: 'reconnect',
  provider_error: 'reconnect',
  error: 'reconnect',
}

export function connectionBucket(status: OperatorChannelConnection['connectionStatus']): ConnectionBucket {
  return BUCKET[status] ?? 'reconnect'
}

const DETAIL_LABELS: Record<OperatorChannelConnection['connectionStatus'], string> = {
  connected: '연결됨',
  connecting: '연결 중',
  disconnected: '연결 해제됨',
  expired: '인증 만료',
  reverify_required: '재인증 필요',
  missing_permission: '권한 부족',
  wrong_account: '다른 계정에 연결됨',
  provider_error: '채널 쪽 오류',
  error: '연결 오류',
}

export function connectionDetailLabel(status: OperatorChannelConnection['connectionStatus']): string {
  return DETAIL_LABELS[status] ?? '확인 필요'
}

export type ChannelCountRow = Readonly<{ channel: string; connected: number; reconnect: number; released: number; connecting: number; total: number }>

/** 지원 채널 순서를 유지하며 채널별 연결 수를 센다. 연결 기록이 없는 채널도 0으로 한 줄 표시한다. */
export function summarizeChannelConnections(
  items: readonly Pick<OperatorChannelConnection, 'channel' | 'connectionStatus'>[],
  channels: readonly string[] = ['instagram', 'threads', 'naver_blog'],
): readonly ChannelCountRow[] {
  const rows = new Map<string, { connected: number; reconnect: number; released: number; connecting: number }>()
  for (const channel of channels) rows.set(channel, { connected: 0, reconnect: 0, released: 0, connecting: 0 })
  for (const item of items) {
    const row = rows.get(item.channel) ?? { connected: 0, reconnect: 0, released: 0, connecting: 0 }
    row[connectionBucket(item.connectionStatus)] += 1
    rows.set(item.channel, row)
  }
  return [...rows.entries()].map(([channel, r]) => ({ channel, ...r, total: r.connected + r.reconnect + r.released + r.connecting }))
}

export function connectionsNeedingAction<T extends Pick<OperatorChannelConnection, 'connectionStatus'>>(items: readonly T[]): T[] {
  return items.filter((item) => connectionBucket(item.connectionStatus) === 'reconnect')
}
