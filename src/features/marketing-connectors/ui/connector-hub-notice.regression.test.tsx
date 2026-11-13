// @vitest-environment jsdom
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ConnectorHub } from './connector-hub'
import type { ConnectorHubSnapshot } from '../catalog'

const mockSnapshot: ConnectorHubSnapshot = {
  workspaceId: 'ws-notice-test',
  storageReady: true,
  connections: [
    {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['events_read'],
    },
    {
      connectorId: 'apple_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['events_read'],
    },
  ],
}

describe('ConnectorHub notice 지속성 및 가시성 회귀 (hub notice regression)', () => {
  const pendingNotice = '정보 수집을 중단했으며 자료 삭제는 확인 중입니다.'

  it('동일 워크스페이스에서 refetch loading 중에도 수집 중단/pending 삭제 notice가 유지된다', () => {
    const { rerender } = render(
      <ConnectorHub
        snapshot={mockSnapshot}
        loading={false}
        error={null}
        notice={pendingNotice}
      />
    )

    // 일반 상태에서 notice 노출 확인
    expect(screen.getByText(pendingNotice)).toBeInTheDocument()

    // 해제 후 refetch 로딩 시작 상태
    rerender(
      <ConnectorHub
        snapshot={null}
        loading={true}
        error={null}
        notice={pendingNotice}
      />
    )

    // 로딩 중에도 notice Alert가 DOM에서 사라지지 않고 유지되어야 함
    expect(screen.getByRole('status', { name: /불러오는 중/i })).toBeInTheDocument()
    expect(screen.getByText(pendingNotice)).toBeInTheDocument()
  })

  it('동일 워크스페이스에서 refetch 중 error가 발생해도 수집 중단/pending 삭제 notice가 유지된다', () => {
    const { rerender } = render(
      <ConnectorHub
        snapshot={mockSnapshot}
        loading={false}
        error={null}
        notice={pendingNotice}
      />
    )

    expect(screen.getByText(pendingNotice)).toBeInTheDocument()

    // refetch 실패로 에러 화면 표시 상태
    rerender(
      <ConnectorHub
        snapshot={null}
        loading={false}
        error="커넥터 정보를 다시 불러오지 못했습니다."
        notice={pendingNotice}
      />
    )

    // 에러 화면에서도 삭제 진행 중 notice가 보존되어야 함
    expect(screen.getByText('커넥터 정보를 다시 불러오지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByText(pendingNotice)).toBeInTheDocument()
  })

  it('notice가 null로 해제되거나 워크스페이스가 리셋되면 notice Alert가 DOM에서 제거된다', () => {
    const { rerender } = render(
      <ConnectorHub
        snapshot={mockSnapshot}
        loading={false}
        error={null}
        notice={pendingNotice}
      />
    )

    expect(screen.getByText(pendingNotice)).toBeInTheDocument()

    // notice가 제거된 경우
    rerender(
      <ConnectorHub
        snapshot={mockSnapshot}
        loading={false}
        error={null}
        notice={null}
      />
    )

    expect(screen.queryByText(pendingNotice)).not.toBeInTheDocument()
  })

  it('하나의 커넥터 해제가 진행(pending) 중일 때 다른 커넥터의 해제 버튼도 disabled되어 동시 해제가 차단된다', () => {
    const onDisconnect = vi.fn().mockImplementation(() => new Promise(() => {}))
    render(<ConnectorHub snapshot={mockSnapshot} onDisconnect={onDisconnect} />)

    // 연결됨 탭 이동
    fireEvent.click(screen.getByRole('tab', { name: /연결됨/i }))

    const googleBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
    const appleBtn = screen.getByRole('button', { name: /애플 캘린더 연결 해제/i })

    expect(googleBtn).not.toBeDisabled()
    expect(appleBtn).not.toBeDisabled()

    // Google Calendar 해제 클릭
    fireEvent.click(googleBtn)

    // Google Calendar는 '해제 중...' 및 disabled
    expect(googleBtn).toBeDisabled()
    // Apple Calendar의 연결 해제 버튼도 disabled 차단되어야 함
    expect(appleBtn).toBeDisabled()
  })
})
