import { describe, expect, it } from 'vitest'
import { connectionBucket, connectionsNeedingAction, summarizeChannelConnections } from './channel-connection-summary'

describe('channel connection summary', () => {
  const items = [
    { channel: 'instagram' as const, connectionStatus: 'connected' as const },
    { channel: 'instagram' as const, connectionStatus: 'expired' as const },
    { channel: 'instagram' as const, connectionStatus: 'disconnected' as const },
    { channel: 'threads' as const, connectionStatus: 'connected' as const },
    { channel: 'threads' as const, connectionStatus: 'connecting' as const },
    { channel: 'threads' as const, connectionStatus: 'wrong_account' as const },
  ]
  it('buckets statuses', () => {
    expect(connectionBucket('missing_permission')).toBe('reconnect')
    expect(connectionBucket('disconnected')).toBe('released')
    expect(connectionBucket('reverify_required')).toBe('reconnect')
  })
  it('counts per channel', () => {
    expect(summarizeChannelConnections(items)).toEqual([
      { channel: 'instagram', connected: 1, reconnect: 1, released: 1, connecting: 0, total: 3 },
      { channel: 'threads', connected: 1, reconnect: 1, released: 0, connecting: 1, total: 3 },
      { channel: 'naver_blog', connected: 0, reconnect: 0, released: 0, connecting: 0, total: 0 },
    ])
  })
  it('counts naver_blog connections', () => {
    const withNaver = [
      ...items,
      { channel: 'naver_blog' as const, connectionStatus: 'connected' as const },
    ]
    expect(summarizeChannelConnections(withNaver)).toEqual([
      { channel: 'instagram', connected: 1, reconnect: 1, released: 1, connecting: 0, total: 3 },
      { channel: 'threads', connected: 1, reconnect: 1, released: 0, connecting: 1, total: 3 },
      { channel: 'naver_blog', connected: 1, reconnect: 0, released: 0, connecting: 0, total: 1 },
    ])
  })
  it('lists zero rows for channels without connections', () => {
    expect(summarizeChannelConnections([])[0]).toMatchObject({ channel: 'instagram', total: 0 })
  })
  it('selects reconnect-needed rows', () => {
    expect(connectionsNeedingAction(items)).toHaveLength(2)
  })
})

describe('operator channel wire schema', () => {
  it('accepts reverify_required and degrades unknown statuses instead of failing the whole list', async () => {
    const { operatorChannelRowSchema } = await import('./schemas')
    const row = {
      workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: '테스트', channel: 'instagram', account_label: null,
      connection_status: 'reverify_required', delegation_status: 'unknown', technical_permission_status: 'unknown',
      token_expires_at: null, webhook_status: 'pending', last_webhook_at: null, last_provider_event_at: null,
      last_error_code: null, updated_at: '2026-10-08T00:00:00+00:00', freshness: 'stale',
    }
    expect(operatorChannelRowSchema.parse(row).connection_status).toBe('reverify_required')
    expect(operatorChannelRowSchema.parse({ ...row, connection_status: 'something_new' }).connection_status).toBe('error')
  })
})
