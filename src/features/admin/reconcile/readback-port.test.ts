import { describe, expect, it, vi } from 'vitest'
import { createReadbackPort } from './readback-port'

const ws = 'e1559000-0000-4000-8000-000000000001'
const id = 'e1559000-0000-4000-8000-000000000003'
describe('ANI-1559 read-only provider probe', () => {
  it('uses injected GET lookup only and returns the presence verdict without raw links or tokens', async () => {
    const credential = vi.fn().mockResolvedValue({ accessToken: 'secret', externalAccountId: 'account' })
    const get = vi.fn().mockResolvedValue('https://instagram.com/p/observed')
    const port = createReadbackPort({ credential, get })
    expect(await port.lookup({ workspaceId: ws, requestId: id, channel: 'instagram', providerPostId: 'post' })).toMatchObject({ state: 'FOUND' })
    expect(get).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(await port.lookup({ workspaceId: ws, requestId: id, channel: 'instagram', providerPostId: 'post' }))).not.toContain('secret')
  })
  it('fails closed on unsupported channels, missing provider references and provider errors', async () => {
    const port = createReadbackPort({ credential: async () => ({ accessToken: 'secret' }), get: async () => { throw new Error('credential secret') } })
    await expect(port.lookup({ workspaceId: ws, requestId: id, channel: 'naver_blog', providerPostId: 'post' })).rejects.toThrow('지원')
    await expect(port.lookup({ workspaceId: ws, requestId: id, channel: 'instagram', providerPostId: null })).rejects.toThrow('참조')
    await expect(port.lookup({ workspaceId: ws, requestId: id, channel: 'instagram', providerPostId: 'post' })).rejects.toThrow('조회')
  })
})
