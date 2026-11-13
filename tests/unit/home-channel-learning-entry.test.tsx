import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TodayLayout } from '@/features/mobile-today/today-layout'
import { PcRightDock } from '@/components/home-today/pc/pc-right-dock'
import type { MobileHomeDto } from '@/features/mobile-decision/contracts'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => false,
}))

vi.mock('@/features/mobile-today/use-autonomy', () => ({
  useAutonomy: () => ({
    status: 'idle',
    label: '대기 중',
  }),
}))

vi.mock('@/features/mobile-decision/decision-return', () => ({
  useRestoreDecisionPosition: vi.fn(),
}))

vi.mock('@/features/agent-dock/chat-panel-store', () => ({
  useOptionalChatPanel: () => null,
}))

vi.mock('@/components/home-today/magic-photo-dropzone', () => ({
  MagicPhotoDropzone: () => <div data-testid="magic-photo-dropzone" />,
}))

vi.mock('@/features/mobile-today/decision-hero', () => ({
  DecisionHero: () => <div data-testid="decision-hero" />,
}))

vi.mock('@/features/mobile-today/delegate-bar', () => ({
  DelegateBar: () => <div data-testid="delegate-bar" />,
}))

vi.mock('@/features/mobile-today/quick-actions', () => ({
  QuickActions: () => <div data-testid="quick-actions" />,
}))

vi.mock('@/features/mobile-today/today-activity-card', () => ({
  TodayActivityCard: () => <div data-testid="today-activity-card" />,
}))

vi.mock('@/features/mobile-today/home-status-pill', () => ({
  HomeStatusPill: () => <div data-testid="home-status-pill" />,
}))

const mockView: MobileHomeDto = {
  workspaceId: 'ws-test-123',
  businessName: '맛있는 카페',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-11-11T09:00:00.000Z',
  agent: {
    state: 'ready',
    data: { label: '소희', detailHref: '/app/agent' },
    observedAt: '2026-11-11T09:00:00.000Z',
    validUntil: null,
  },
  decisions: {
    state: 'ready',
    data: { items: [], total: 0, complete: true },
    observedAt: '2026-11-11T09:00:00.000Z',
    validUntil: null,
  },
  activity: {
    state: 'ready',
    data: [],
    observedAt: '2026-11-11T09:00:00.000Z',
    validUntil: null,
  },
  results: {
    state: 'ready',
    data: [],
    observedAt: '2026-11-11T09:00:00.000Z',
    validUntil: null,
  },
}

describe('Home Channel Learning Entry Points', () => {
  describe('1) 모바일 TodayLayout 채널 지식 학습 배너', () => {
    it('소희에게 내 채널 가르치기 배너와 /app/channels 링크가 올바르게 렌더링된다', () => {
      render(
        <TodayLayout
          view={mockView}
          onRefresh={vi.fn()}
          onDelegate={vi.fn()}
          workspaceId="ws-test-123"
        />
      )

      // 라벨 및 설명 확인
      const title = screen.getByText('소희에게 내 채널 가르치기')
      expect(title).toBeDefined()

      const desc = screen.getByText('인스타그램·스레드 등록하고 맞춤 지식 학습')
      expect(desc).toBeDefined()

      // 링크 요소 및 href 속성 정밀 검증
      const link = title.closest('a')
      expect(link).not.toBeNull()
      expect(link?.getAttribute('href')).toBe('/app/channels')
    })
  })

  describe('2) PC PcRightDock 바로가기 채널 & 지식 학습 카드', () => {
    it('채널 & 지식 학습 바로가기 카드와 /app/channels 링크가 올바르게 렌더링된다', () => {
      render(
        <PcRightDock
          workspaceId="ws-test-123"
          onOpenChat={vi.fn()}
        />
      )

      // 바로가기 카드 제목 및 설명 확인
      const title = screen.getByText('채널 & 지식 학습')
      expect(title).toBeDefined()

      const desc = screen.getByText('공식 SNS 채널 학습')
      expect(desc).toBeDefined()

      // 링크 요소 및 href 속성 정밀 검증
      const link = title.closest('a')
      expect(link).not.toBeNull()
      expect(link?.getAttribute('href')).toBe('/app/channels')
    })
  })
})
