import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../features/operator-auth/require-operator', () => ({
  requireOperatorAnyScope: vi.fn(async () => ({ userId: '10000000-0000-4000-8000-000000000001' })),
}))
vi.mock('../../../features/operator-channels/repository', () => ({
  listOperatorChannelConnections: vi.fn(async () => ({ data: [], error: null })),
}))
vi.mock('@/components/admin/orphan-reconcile-panel', () => ({ OrphanReconcilePanel: () => null }))

import { requireOperatorAnyScope } from '../../../features/operator-auth/require-operator'
import { listOperatorChannelConnections } from '../../../features/operator-channels/repository'
import Page from './page'

const dump = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'type' ? undefined : x))

describe('OperatorChannelsPage', () => {
  it('guards channels and renders real counts with no fake funnel', async () => {
    const text = dump(await Page())
    expect(requireOperatorAnyScope).toHaveBeenCalledWith('channel.read')
    expect(text).toContain('인스타그램')
    expect(text).toContain('연결된 채널이 아직 없어요')
    expect(text).not.toMatch(/퍼널|유입 문의|5대 플랫폼|실운영 모드|채널 건강도|ACTIVE|NOT_CONNECTED|OAuth|token|secret|password/iu)
  })

  it('surfaces a load error instead of an empty table', async () => {
    vi.mocked(listOperatorChannelConnections).mockResolvedValueOnce({ data: null, error: 'CHANNEL_LIST_UNAVAILABLE' })
    const text = dump(await Page())
    expect(text).toContain('채널 연결 현황')
    expect(text).toContain('retryHref')
    expect(text).not.toContain('연결된 채널이 아직 없어요')
  })

  it('lists connections that need reconnecting', async () => {
    vi.mocked(listOperatorChannelConnections).mockResolvedValueOnce({
      data: [{ workspaceId: '10000000-0000-4000-8000-000000000001', workspaceName: '테스트 매장', channel: 'instagram', connectionStatus: 'expired', updatedAt: '2026-10-08T01:00:00.000Z' }] as never,
      error: null,
    })
    const text = dump(await Page())
    expect(text).toContain('재연결이 필요한 연결')
    expect(text).toContain('인증 만료')
  })

  it('renders naver blog channel row and local connector health panel with category sync trigger', async () => {
    vi.mocked(listOperatorChannelConnections).mockResolvedValueOnce({
      data: [
        {
          id: '44000000-0000-4000-8000-000000000001',
          workspaceId: '10000000-0000-4000-8000-000000000001',
          workspaceName: '네이버 매장',
          channel: 'naver_blog',
          accountLabel: 'my_naver_blog',
          connectionStatus: 'connected',
          connectorType: 'browser_extension',
          extensionVersion: '1.2.0',
          lastHeartbeatAt: new Date().toISOString(),
          updatedAt: '2026-10-08T01:00:00.000Z',
        },
      ] as never,
      error: null,
    })
    const text = dump(await Page())
    expect(text).toContain('네이버 블로그')
    expect(text).toContain('connectors')
    expect(text).toContain('my_naver_blog')
    expect(text).toContain('browser_extension')
    expect(text).not.toMatch(/퍼널|유입 문의|5대 플랫폼|실운영 모드|채널 건강도|ACTIVE|NOT_CONNECTED|OAuth|token|secret|password/iu)
  })
})
