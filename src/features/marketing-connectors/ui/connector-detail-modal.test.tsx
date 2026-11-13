// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { ConnectorDetailModal } from './connector-detail-modal'
import type { ConnectorDefinition, ConnectorConnectionSummary } from '../catalog'

const sampleSetupRequiredConnector: ConnectorDefinition = {
  id: 'google_calendar',
  name: 'Google Calendar',
  category: 'productivity',
  purpose: '매장 휴무일, 행사 일정 파악 및 예약 가능 시간 연계',
  reads: ['선택한 업무 캘린더의 일정 제목, 일시, 설명'],
  excludes: ['개인 일정', '참석자 개인정보', '비공개 메모'],
  method: 'oauth',
  readiness: 'setup_required',
  aliases: ['구글캘린더'],
}

const sampleReviewRequiredConnector: ConnectorDefinition = {
  id: 'gmail',
  name: 'Gmail',
  category: 'productivity',
  purpose: '업무 메일에서 행사·예약·공지사항 관련 내용 파악 및 마케팅 제안 도출',
  reads: ['선택한 라벨의 업무 메일 제목 및 본문 발췌'],
  excludes: ['개인 사서함 전체', '비밀번호 및 금융 데이터', '고객 개인 식별 정보'],
  method: 'oauth',
  readiness: 'review_required',
  aliases: ['지메일'],
}

const sampleSocialConnector: ConnectorDefinition = {
  id: 'instagram',
  name: 'Instagram',
  category: 'social',
  purpose: '인스타그램 피드 및 스토리 마케팅 연동',
  reads: ['비즈니스 계정 프로필', '공개 피드 미디어 및 캡션'],
  excludes: ['개인 비공개 계정 데이터', '개인 DM 메시지 원문'],
  method: 'existing',
  readiness: 'available',
  managementHref: '/app/channels',
  aliases: ['인스타그램'],
}

const sampleUnsupportedConnector: ConnectorDefinition = {
  id: 'apple_reminders',
  name: 'Apple Reminders',
  category: 'productivity',
  purpose: 'Apple 미리알림 연동',
  reads: [],
  excludes: [],
  method: 'unavailable',
  readiness: 'unsupported',
  aliases: ['미리알림'],
}

describe('ConnectorDetailModal', () => {
  it('isOpen이 false일 때는 모달이 표시되지 않는다', () => {
    render(
      <ConnectorDetailModal
        connector={sampleSetupRequiredConnector}
        isOpen={false}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('모달이 열리면 기본 정보(목적, 읽는 정보, 제외 정보, AI 처리 고지, 30일 보존)가 정확히 표시된다', () => {
    render(
      <ConnectorDetailModal
        connector={sampleSetupRequiredConnector}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    // 제목 및 목적
    expect(within(dialog).getByText('구글 캘린더')).toBeInTheDocument()
    expect(within(dialog).getByText(/홍보 제안 및 예약 최적화/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/매장 휴무일, 행사 일정 파악/i)).toBeInTheDocument()

    // 읽는 정보 & 제외 정보
    expect(within(dialog).getByText(/선택한 업무 캘린더의 일정 제목/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/개인 사서함 전체|개인 일정/i)).toBeInTheDocument()

    // AI 처리 고지 & 보존 기간
    expect(within(dialog).getByText(/AI 처리/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/최대 30일/i)).toBeInTheDocument()
  })

  it('available 소셜 공급자는 관리 페이지 링크(/app/channels)를 제공한다', () => {
    render(
      <ConnectorDetailModal
        connector={sampleSocialConnector}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    const link = within(dialog).getByRole('link', { name: /채널 관리|관리 페이지/i })
    expect(link).toHaveAttribute('href', '/app/channels')
  })

  it('setup_required 공급자는 연결 시작 CTA 버튼을 제공하고 클릭 시 onConnect를 호출한다', () => {
    const onConnect = vi.fn()
    render(
      <ConnectorDetailModal
        connector={sampleSetupRequiredConnector}
        isOpen={true}
        onClose={vi.fn()}
        onConnect={onConnect}
      />
    )

    const dialog = screen.getByRole('dialog')
    const connectButton = within(dialog).getByRole('button', { name: /연결 시작|연결하기/i })
    expect(connectButton).toBeInTheDocument()
    expect(connectButton).not.toBeDisabled()

    fireEvent.click(connectButton)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('review_required 공급자는 "현재 공급자 보안 심사 진행 중입니다" 뱃지 및 비활성화 안내를 제공한다', () => {
    const onConnect = vi.fn()
    render(
      <ConnectorDetailModal
        connector={sampleReviewRequiredConnector}
        isOpen={true}
        onClose={vi.fn()}
        onConnect={onConnect}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/현재 공급자 보안 심사 진행 중입니다/i)).toBeInTheDocument()

    // 연결 시작 버튼이 없거나 비활성화되어 있어야 함
    const connectBtn = within(dialog).queryByRole('button', { name: /연결 시작|연결하기/i })
    if (connectBtn) {
      expect(connectBtn).toBeDisabled()
    }
  })

  it('unsupported 공급자는 "공식 API 미지원으로 연동이 불가능합니다" 사유를 안내한다', () => {
    render(
      <ConnectorDetailModal
        connector={sampleUnsupportedConnector}
        isOpen={true}
        onClose={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/공식 지원 미제공으로 연결이 불가능합니다/i)).toBeInTheDocument()
  })

  it('연결된 커넥터(connection summary)의 경우 연결 상태와 연결 해제 버튼을 제공한다', () => {
    const connectedSummary: ConnectorConnectionSummary = {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T12:00:00Z',
      capabilities: ['events_read'],
    }
    const onDisconnect = vi.fn()

    render(
      <ConnectorDetailModal
        connector={sampleSetupRequiredConnector}
        connection={connectedSummary}
        isOpen={true}
        onClose={vi.fn()}
        onDisconnect={onDisconnect}
      />
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/연결됨/i)).toBeInTheDocument()

    const disconnectBtn = within(dialog).getByRole('button', { name: /연결 해제/i })
    fireEvent.click(disconnectBtn)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('닫기 버튼 클릭 시 onClose가 호출된다', () => {
    const onClose = vi.fn()
    render(
      <ConnectorDetailModal
        connector={sampleSetupRequiredConnector}
        isOpen={true}
        onClose={onClose}
      />
    )

    const closeBtn = screen.getByRole('button', { name: /닫기/i })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
