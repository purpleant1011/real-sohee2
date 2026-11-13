import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalConnectorHealth,
  NaverConnectorHealthPanel,
  type NaverConnectorItem,
} from './naver-connector-health-panel'

describe('getLocalConnectorHealth', () => {
  const baseTime = Date.parse('2026-10-14T12:00:00.000Z')

  it('classifies reverify_required or expired status as reauth_required', () => {
    expect(
      getLocalConnectorHealth(
        { connectionStatus: 'reverify_required', lastHeartbeatAt: '2026-10-14T11:58:00.000Z' },
        baseTime,
      ),
    ).toBe('reauth_required')
    expect(
      getLocalConnectorHealth(
        { connectionStatus: 'expired', lastHeartbeatAt: '2026-10-14T11:58:00.000Z' },
        baseTime,
      ),
    ).toBe('reauth_required')
  })

  it('classifies missing or stale heartbeat as offline', () => {
    expect(
      getLocalConnectorHealth(
        { connectionStatus: 'connected', lastHeartbeatAt: null },
        baseTime,
      ),
    ).toBe('offline')
    expect(
      getLocalConnectorHealth(
        { connectionStatus: 'connected', lastHeartbeatAt: '2026-10-14T11:40:00.000Z' }, // 20m ago
        baseTime,
      ),
    ).toBe('offline')
  })

  it('classifies recent heartbeat with connected status as connected', () => {
    expect(
      getLocalConnectorHealth(
        { connectionStatus: 'connected', lastHeartbeatAt: '2026-10-14T11:55:00.000Z' }, // 5m ago
        baseTime,
      ),
    ).toBe('connected')
  })
})

describe('NaverConnectorHealthPanel component', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const sampleConnectors: NaverConnectorItem[] = [
    {
      id: 'conn-1',
      workspaceId: 'ws-1',
      workspaceName: '맛있는 베이커리',
      channel: 'naver_blog',
      accountLabel: 'bakery_blog',
      connectionStatus: 'connected',
      extensionVersion: '1.2.0',
      lastHeartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      updatedAt: '2026-10-14T10:00:00.000Z',
    },
    {
      id: 'conn-2',
      workspaceId: 'ws-2',
      workspaceName: '행복한 카페',
      channel: 'naver_blog',
      accountLabel: 'cafe_blog',
      connectionStatus: 'reverify_required',
      extensionVersion: '1.1.0',
      lastHeartbeatAt: new Date(Date.now() - 120_000).toISOString(),
      updatedAt: '2026-10-14T10:00:00.000Z',
    },
  ]

  it('renders summary counts and connector rows', () => {
    render(<NaverConnectorHealthPanel connectors={sampleConnectors} />)

    expect(screen.getByText('로컬 커넥터 관제 (Chrome 확장 프로그램)')).toBeVisible()
    expect(screen.getByText('맛있는 베이커리')).toBeVisible()
    expect(screen.getByText('bakery_blog')).toBeVisible()
    expect(screen.getByText('v1.2.0')).toBeVisible()
    expect(screen.getByText('행복한 카페')).toBeVisible()
    expect(screen.getByText('cafe_blog')).toBeVisible()
  })

  it('renders empty notice when no connectors exist', () => {
    render(<NaverConnectorHealthPanel connectors={[]} />)
    expect(screen.getByText(/연결된 네이버 블로그 확장 프로그램이 아직 없어요/)).toBeVisible()
  })

  it('triggers category sync via API and displays success feedback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, count: 5 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NaverConnectorHealthPanel connectors={sampleConnectors} />)

    const syncButtons = screen.getAllByRole('button', { name: /카테고리 동기화/ })
    expect(syncButtons.length).toBe(2)

    fireEvent.click(syncButtons[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/channels/naver-categories/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'ws-1',
          connectionId: 'conn-1',
        }),
      })
    })

    await waitFor(() => {
      expect(screen.getByText('동기화 완료 (5개)')).toBeVisible()
    })
  })
})
