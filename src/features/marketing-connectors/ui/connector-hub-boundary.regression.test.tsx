import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ConnectorHub } from './connector-hub'
import type { ConnectorHubSnapshot } from '../catalog'

const snapshot: ConnectorHubSnapshot = { workspaceId: 'workspace-a', storageReady: true,
  connections: [{ connectorId: 'instagram', status: 'connected', lastSyncAt: null, capabilities: [] }] }

describe('connector hub truthful interaction boundary', () => {
  it('supports arrow-key tab selection and focus movement', () => {
    render(<ConnectorHub snapshot={snapshot} />)
    const available = screen.getByRole('tab', { name: '사용 가능' })
    const connected = screen.getByRole('tab', { name: '연결됨' })
    available.focus()
    fireEvent.keyDown(available, { key: 'ArrowRight' })
    expect(connected).toHaveAttribute('aria-selected', 'true')
    expect(connected).toHaveFocus()
  })
  it('associates the active tab panel with its actual connector content', () => {
    render(<ConnectorHub snapshot={snapshot} />)
    expect(within(screen.getByRole('tabpanel')).getByText('지메일')).toBeInTheDocument()
  })
  it('keeps a saved failed connection visible in the connected tab', () => {
    render(<ConnectorHub snapshot={{ ...snapshot, connections: [{ ...snapshot.connections[0], status: 'error' }] }} />)
    fireEvent.click(screen.getByRole('tab', { name: '연결됨' }))
    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    expect(screen.getByText('오류')).toBeInTheDocument()
  })
  it('warns when the persistent connector store is not ready', () => {
    render(<ConnectorHub snapshot={{ ...snapshot, storageReady: false }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/준비|확인|저장/)
  })
  it('uses existing channel management rather than unsupported social disconnection', () => {
    render(<ConnectorHub snapshot={snapshot} onDisconnect={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /인스타그램 연결 해제/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /채널 관리/ })[0]).toHaveAttribute('href', '/app/channels')
  })
  it('does not expose internal readiness/method codes in connector details', () => {
    render(<ConnectorHub snapshot={snapshot} />)
    fireEvent.click(screen.getByRole('button', { name: '지메일 상세 정보 보기' }))
    const dialog = screen.getByRole('dialog', { name: '지메일' })
    expect(dialog).not.toHaveTextContent('review_required')
    expect(dialog).not.toHaveTextContent('oauth')
    expect(within(dialog).getByText(/읽지 않는 정보/)).toBeInTheDocument()
  })
  it('does not open details when a nested management link receives keyboard activation', () => {
    render(<ConnectorHub snapshot={snapshot} />)
    fireEvent.keyDown(screen.getAllByRole('link', { name: /채널 관리/ })[0], { key: 'Enter' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
