import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChannelSummary from './channel-summary'

describe('ChannelSummary visual parity structure', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const getComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element))
  })
  it('shows filters, KPI, dense table and detail/action surfaces', () => {
    render(<ChannelSummary referenceTime={Date.parse('2026-08-24T00:00:00.000Z')} />)
    expect(screen.getByPlaceholderText('고객사 검색')).toBeVisible()
    expect(screen.getByText('전체 고객사')).toBeVisible()
    expect(screen.getByText('연결된 채널')).toBeVisible()
    expect(screen.getByText('만료 예정')).toBeVisible()
    expect(screen.getByText('주의 필요')).toBeVisible()
    expect(screen.getByRole('heading', { name: '채널 상세' })).toBeVisible()
    expect(screen.getByText('연결 해제')).toBeVisible()
    expect(screen.getAllByText('게시 위임 동의').length).toBeGreaterThan(0)
    expect(screen.getAllByText('신선도').length).toBeGreaterThan(0)
    expect(screen.getAllByText('기술 권한').length).toBeGreaterThan(0)
    expect(document.querySelector('.ant-pro-table')).toBeInTheDocument()
  }, 15_000)

  it('derives KPI values from safe channel rows without inventing totals', () => {
    render(<ChannelSummary referenceTime={Date.parse('2026-08-24T00:00:00.000Z')} items={[{
      workspaceId: '10000000-0000-4000-8000-000000000001', workspaceName: '고객사 A', channel: 'instagram',
      accountLabel: '공식 계정', connectionStatus: 'connected', delegationStatus: 'accepted', technicalPermissionStatus: 'ready',
      tokenExpiresAt: null, webhookStatus: 'healthy', lastWebhookAt: null, lastProviderEventAt: null, lastErrorCode: null,
      updatedAt: '2026-08-23T00:00:00.000Z', freshness: 'fresh',
    }]} />)
    expect(screen.getByText('고객사 A')).toBeVisible()
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('공식 계정')).toBeVisible()
  })
})
