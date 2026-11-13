import { describe, expect, it, vi } from 'vitest'
import { createMetaChannelAdapter } from './meta-channel-adapters'

describe('Meta channel performance adapters', () => {
  it('normalizes Instagram metrics without returning provider credentials', async () => {
    const port = { collect: vi.fn().mockResolvedValue({ state: 'available', metrics: [{ metric: 'views', value: 12 }] }) }
    const result = await createMetaChannelAdapter('instagram', port).collect({ workspaceId: '10000000-0000-4000-8000-000000000001', periodStart: '2026-08-01', periodEnd: '2026-08-02' })
    expect(result).toEqual({ channel: 'instagram', observations: [{ channel: 'instagram', metric: 'views', state: 'available', value: 12 }] })
    expect(JSON.stringify(result)).not.toContain('token')
  })
  it('maps permission and connection states without inventing zeroes', async () => {
    const port = { collect: vi.fn().mockResolvedValue({ state: 'permission_denied', metrics: [] }) }
    await expect(createMetaChannelAdapter('threads', port).collect({ workspaceId: '10000000-0000-4000-8000-000000000001', periodStart: '2026-08-01', periodEnd: '2026-08-02' })).resolves.toEqual({ channel: 'threads', observations: [{ channel: 'threads', metric: 'views', state: 'permission_denied', value: null }] })
  })
})
