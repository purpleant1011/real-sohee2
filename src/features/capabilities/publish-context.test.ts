import { describe, expect, it } from 'vitest'
import { filterPublishReadyChannels } from './publish-context'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-10-21T10:00:00Z')
const env = { NODE_ENV: 'production', META_LIVE_WORKSPACE_ALLOWLIST: workspaceId }
const channel = { channel: 'instagram', status: 'connected', account_label: '@shop' }
function client(scopes: string[], run: unknown, error: unknown = null) {
  return { from(table: string) {
    const query: any = { select: () => query, eq: () => query, in: () => query, order: () => query,
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error, data: table === 'meta_channel_credentials' ? [{ provider: 'instagram', status: 'active', granted_scopes: scopes, token_expires_at: '2026-10-23T10:00:00Z' }] : run ? [run] : [] }).then(resolve) } }
    return query
  } }
}
describe('publish channel context', () => {
  it('connected without actual scope does not become an executable channel', async () => {
    expect(await filterPublishReadyChannels(client([], { channel: 'instagram', status: 'VERIFIED', read_after_write_at: now.toISOString() }), workspaceId, [channel], { now, env })).toEqual([])
  })
  it('requires persisted independent verification and keeps eligible single channel', async () => {
    const scopes = ['instagram_business_basic', 'instagram_business_content_publish']
    expect(await filterPublishReadyChannels(client(scopes, null), workspaceId, [channel], { now, env })).toEqual([])
    expect(await filterPublishReadyChannels(client(scopes, { channel: 'instagram', status: 'VERIFIED', read_after_write_at: now.toISOString() }), workspaceId, [channel], { now, env })).toEqual([channel])
  })
  it('query failure is an error, never an empty connected-channel result', async () => {
    await expect(filterPublishReadyChannels(client([], null, { message: 'database details' }), workspaceId, [channel], { now, env })).rejects.toThrow('CHANNEL_CAPABILITY_QUERY_FAILED')
  })
})
