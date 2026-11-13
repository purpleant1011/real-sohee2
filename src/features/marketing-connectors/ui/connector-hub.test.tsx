// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { ConnectorHub } from './connector-hub'
import type { ConnectorHubSnapshot } from '../catalog'

const mockSnapshot: ConnectorHubSnapshot = {
  workspaceId: 'ws-test-123',
  connections: [
    {
      connectorId: 'instagram',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['feed_read'],
    },
    {
      connectorId: 'threads',
      status: 'reauth_required',
      lastSyncAt: '2026-11-09T09:00:00Z',
      capabilities: ['post_read'],
    },
    {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T08:00:00Z',
      capabilities: ['events_read'],
    },
  ],
  storageReady: true,
}

describe('ConnectorHub (모바일/PC 허브)', () => {
  it('미지원(unsupported) 커넥터는 화면에서 제외되며 사용 가능한 10개 커넥터 항목이 렌더링된다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    expect(screen.getByText('지메일')).toBeInTheDocument()
    expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    expect(screen.getByText('애플 캘린더')).toBeInTheDocument()
    // 미지원 항목인 Apple Reminders는 사용자 혼란 방지를 위해 렌더링에서 제외
    expect(screen.queryByText(/애플 미리알림|Apple Reminders/i)).not.toBeInTheDocument()
    expect(screen.getByText('구글 문서')).toBeInTheDocument()
    expect(screen.getByText('구글 스프레드시트')).toBeInTheDocument()
    expect(screen.getByText('아웃룩 메일')).toBeInTheDocument()
    expect(screen.getByText('스레드')).toBeInTheDocument()
    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    expect(screen.getByText('인스타그램 메시지')).toBeInTheDocument()
    expect(screen.getByText('구글 드라이브')).toBeInTheDocument()
  })

  it('한국어 및 기존 영어 별칭(alias)으로 검색할 수 있다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    const searchInput = screen.getByRole('searchbox', { name: /도구 검색|커넥터 검색/i })
    fireEvent.change(searchInput, { target: { value: '지메일' } })

    expect(screen.getByText('지메일')).toBeInTheDocument()
    expect(screen.queryByText('구글 캘린더')).not.toBeInTheDocument()
    expect(screen.queryByText('인스타그램')).not.toBeInTheDocument()

    // 기존 영어 별칭 검색 유지 확인
    fireEvent.change(searchInput, { target: { value: 'Gmail' } })
    expect(screen.getByText('지메일')).toBeInTheDocument()
    expect(screen.queryByText('구글 캘린더')).not.toBeInTheDocument()

    // 인스타 별칭 검색
    fireEvent.change(searchInput, { target: { value: '디엠' } })
    expect(screen.getByText('인스타그램 메시지')).toBeInTheDocument()
    expect(screen.queryByText('지메일')).not.toBeInTheDocument()
  })

  it('검색 결과가 없을 때 의미 있는 빈 상태 안내를 제공한다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    const searchInput = screen.getByRole('searchbox', { name: /도구 검색|커넥터 검색/i })
    fireEvent.change(searchInput, { target: { value: '존재하지않는커넥터' } })

    expect(screen.getByText(/검색 결과가 없어요/i)).toBeInTheDocument()
  })

  it('탭 전환 시 연결됨 탭에는 connected 및 reauth_required 상태인 항목만 유지된다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
    fireEvent.click(connectedTab)

    // snapshot에 instagram, threads, google_calendar 포함됨
    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    expect(screen.getByText('스레드')).toBeInTheDocument()
    expect(screen.getByText('구글 캘린더')).toBeInTheDocument()
    expect(screen.queryByText('지메일')).not.toBeInTheDocument()
    expect(screen.queryByText('애플 캘린더')).not.toBeInTheDocument()
  })

  it('준비 상태(readiness)에 따른 안내가 제공되며 실제 OAuth인 척하는 가짜 연결 버튼은 없다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    // 소셜은 기존 채널 관리 경로 링크(/app/channels)를 제공
    const channelLinks = screen.getAllByRole('link', { name: /채널 관리|채널 연결/i })
    expect(channelLinks.length).toBeGreaterThan(0)
    for (const link of channelLinks) {
      expect(link).toHaveAttribute('href', '/app/channels')
    }

    // setup_required / review_required / unsupported에 가짜 연결 버튼이 없음
    expect(screen.queryByRole('button', { name: /^연결하기$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^OAuth 시작$/i })).not.toBeInTheDocument()

    // 준비 상태 레이블 확인
    expect(screen.getAllByText(/준비 중|설정 필요|심사 준비/i).length).toBeGreaterThan(0)
    // 미지원 항목은 제외되었으므로 지원 불가 텍스트가 노출되지 않음
    expect(screen.queryByText(/지원 불가|미지원/i)).not.toBeInTheDocument()
  })

  it('커넥터를 선택하면 상세 패널에 목적, 읽는 정보, 읽지 않는 정보가 표시된다', async () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    // Gmail 카드 클릭
    const gmailCard = screen.getByRole('button', { name: /지메일 상세 정보 보기/i })
    fireEvent.click(gmailCard)

    // 다이얼로그 및 상세 내용 확인
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '지메일' })).toBeInTheDocument()
    })
    const dialog = screen.getByRole('dialog', { name: '지메일' })
    expect(within(dialog).getByText(/마케팅 제안 도출/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/읽(을|는) 정보/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/읽지 않는 정보/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/개인 사서함 전체/i)).toBeInTheDocument()
  })

  it('토큰이나 크레딧 숫자 또는 잔액 숫자가 표시되지 않는다', () => {
    const { container } = render(<ConnectorHub snapshot={mockSnapshot} />)
    const text = container.textContent || ''

    expect(text).not.toMatch(/\d+\s*(토큰|크레딧|코인|credit|token)/i)
    expect(text).not.toMatch(/잔여\s*:\s*\d+/i)
  })

  it('연결 해제(onDisconnect) 시 진행 중 및 에러 상태를 안전하게 처리한다', async () => {
    const onDisconnect = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)))
    render(<ConnectorHub snapshot={mockSnapshot} onDisconnect={onDisconnect} />)

    // 연결됨 탭으로 이동
    const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
    fireEvent.click(connectedTab)

    // Google Calendar의 연결 해제 버튼 클릭
    const disconnectBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
    fireEvent.click(disconnectBtn)

    expect(onDisconnect).toHaveBeenCalledWith('google_calendar')
    // 진행 중 상태 확인
    expect(screen.getByText(/해제 중/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText(/해제 중/i)).not.toBeInTheDocument()
    })
  })

  it('연결 해제 중 오류 발생 시 사용자에게 에러를 안내한다', async () => {
    const onDisconnect = vi.fn().mockRejectedValue(new Error('네트워크 오류'))
    render(<ConnectorHub snapshot={mockSnapshot} onDisconnect={onDisconnect} />)

    const connectedTab = screen.getByRole('tab', { name: /연결됨/i })
    fireEvent.click(connectedTab)

    const disconnectBtn = screen.getByRole('button', { name: /구글 캘린더 연결 해제/i })
    fireEvent.click(disconnectBtn)

    await waitFor(() => {
      expect(screen.getByText(/네트워크 오류/i)).toBeInTheDocument()
    })
  })

  it('로딩 중일 때 로딩 상태를 표시한다', () => {
    render(<ConnectorHub snapshot={null} loading={true} />)
    expect(screen.getByRole('status', { name: /불러오는 중/i })).toBeInTheDocument()
  })

  it('오류가 발생했을 때 재시도 버튼과 에러 메시지를 표시한다', () => {
    const onRetry = vi.fn()
    render(<ConnectorHub snapshot={null} error="정보를 불러오지 못했습니다." onRetry={onRetry} />)

    expect(screen.getByText(/정보를 불러오지 못했습니다/i)).toBeInTheDocument()
    const retryBtn = screen.getByRole('button', { name: /다시 시도/i })
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('키보드 접근성을 위한 시맨틱 탭 역할을 충족한다', () => {
    render(<ConnectorHub snapshot={mockSnapshot} />)

    const tabList = screen.getByRole('tablist')
    expect(tabList).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.length).toBe(2)
  })
})
