// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ConnectorCardActions } from './connector-card-actions'
import type { ConnectorDefinition, ConnectorConnectionSummary } from '../catalog'

const sampleSetupRequiredConnector: ConnectorDefinition = {
  id: 'google_calendar',
  name: 'Google Calendar',
  category: 'productivity',
  purpose: '매장 휴무일 및 프로모션 일정 연계',
  reads: ['캘린더 일정 제목 및 일시'],
  excludes: ['개인 일정'],
  method: 'oauth',
  readiness: 'setup_required',
  aliases: ['구글캘린더'],
}

const sampleReviewRequiredConnector: ConnectorDefinition = {
  id: 'gmail',
  name: 'Gmail',
  category: 'productivity',
  purpose: '업무 메일에서 행사·예약 관련 내용 파악',
  reads: ['선택한 라벨의 업무 메일 제목 및 본문'],
  excludes: ['개인 사서함 전체'],
  method: 'oauth',
  readiness: 'review_required',
  aliases: ['지메일'],
}

const sampleSocialConnector: ConnectorDefinition = {
  id: 'instagram',
  name: 'Instagram',
  category: 'social',
  purpose: '인스타그램 피드 및 스토리 마케팅 연동',
  reads: ['프로필 정보'],
  excludes: ['비공개 게시물'],
  method: 'existing',
  readiness: 'available',
  managementHref: '/app/channels',
  aliases: ['인스타'],
}

const sampleUnsupportedConnector: ConnectorDefinition = {
  id: 'apple_reminders',
  name: 'Apple Reminders',
  category: 'productivity',
  purpose: '미지원 커넥터',
  reads: [],
  excludes: [],
  method: 'unavailable',
  readiness: 'unsupported',
  aliases: ['미리알림'],
}

describe('ConnectorCardActions', () => {
  describe('미연결 상태', () => {
    it('setup_required 공급자는 "상세보기"와 "연결하기" 버튼이 표시된다', () => {
      const onViewDetail = vi.fn()
      const onConnect = vi.fn()

      render(
        <ConnectorCardActions
          connector={sampleSetupRequiredConnector}
          onViewDetail={onViewDetail}
          onConnect={onConnect}
        />
      )

      const detailBtn = screen.getByRole('button', { name: /상세 정보 보기|상세보기|상세 보기/i })
      const connectBtn = screen.getByRole('button', { name: /연결하기|연결 시작/i })

      expect(detailBtn).toBeInTheDocument()
      expect(connectBtn).toBeInTheDocument()
      expect(connectBtn).not.toBeDisabled()

      fireEvent.click(detailBtn)
      expect(onViewDetail).toHaveBeenCalledTimes(1)

      fireEvent.click(connectBtn)
      expect(onConnect).toHaveBeenCalledTimes(1)
    })

    it('review_required 공급자는 "심사중" 버튼(비활성화)과 "상세보기"가 표시된다', () => {
      const onViewDetail = vi.fn()

      render(
        <ConnectorCardActions
          connector={sampleReviewRequiredConnector}
          onViewDetail={onViewDetail}
        />
      )

      const reviewBtn = screen.getByRole('button', { name: /심사중|심사 준비/i })
      expect(reviewBtn).toBeInTheDocument()
      expect(reviewBtn).toBeDisabled()

      const detailBtn = screen.getByRole('button', { name: /상세 정보 보기|상세보기|상세 보기/i })
      expect(detailBtn).toBeInTheDocument()
      fireEvent.click(detailBtn)
      expect(onViewDetail).toHaveBeenCalledTimes(1)
    })

    it('unsupported 공급자는 "미지원" 비활성화 버튼과 "상세보기"가 표시된다', () => {
      render(
        <ConnectorCardActions
          connector={sampleUnsupportedConnector}
          onViewDetail={vi.fn()}
        />
      )

      const unsupportedBtn = screen.getByRole('button', { name: /미지원|지원 불가/i })
      expect(unsupportedBtn).toBeInTheDocument()
      expect(unsupportedBtn).toBeDisabled()
    })

    it('available 소셜 공급자는 채널 관리 링크 및 "상세보기"가 표시된다', () => {
      render(
        <ConnectorCardActions
          connector={sampleSocialConnector}
          onViewDetail={vi.fn()}
        />
      )

      const manageLink = screen.getByRole('link', { name: /관리|연결/i })
      expect(manageLink).toHaveAttribute('href', '/app/channels')

      const detailBtn = screen.getByRole('button', { name: /상세 정보 보기|상세보기|상세 보기/i })
      expect(detailBtn).toBeInTheDocument()
    })
  })

  describe('연결됨 상태', () => {
    const connectedSummary: ConnectorConnectionSummary = {
      connectorId: 'google_calendar',
      status: 'connected',
      lastSyncAt: '2026-11-10T09:00:00Z',
      capabilities: ['events_read'],
    }

    it('연결 완료 시 "연결됨" 상태와 "관리" 버튼이 표시된다', () => {
      const onManage = vi.fn()

      render(
        <ConnectorCardActions
          connector={sampleSetupRequiredConnector}
          connection={connectedSummary}
          onManage={onManage}
        />
      )

      expect(screen.getByText(/연결됨/i)).toBeInTheDocument()
      const manageBtn = screen.getByRole('button', { name: /관리/i })
      expect(manageBtn).toBeInTheDocument()

      fireEvent.click(manageBtn)
      expect(onManage).toHaveBeenCalledTimes(1)
    })

    it('onDisconnect가 제공된 경우 연결 해제 동작을 호출할 수 있다', () => {
      const onDisconnect = vi.fn()

      render(
        <ConnectorCardActions
          connector={sampleSetupRequiredConnector}
          connection={connectedSummary}
          onDisconnect={onDisconnect}
        />
      )

      const disconnectBtn = screen.getByRole('button', { name: /연결 해제|해제/i })
      expect(disconnectBtn).toBeInTheDocument()

      fireEvent.click(disconnectBtn)
      expect(onDisconnect).toHaveBeenCalledTimes(1)
    })

    it('isDisconnecting 중에는 해제 버튼이 비활성화된다', () => {
      render(
        <ConnectorCardActions
          connector={sampleSetupRequiredConnector}
          connection={connectedSummary}
          onDisconnect={vi.fn()}
          isDisconnecting={true}
        />
      )

      const btn = screen.getByRole('button', { name: /해제 중/i })
      expect(btn).toBeDisabled()
    })
  })
})
