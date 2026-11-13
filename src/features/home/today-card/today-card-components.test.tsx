import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TodayCardView } from './today-card-view'
import { VaultSummaryLine } from './vault-summary-line'
import { HomeMetricsWidget } from './metrics-widget'
import { SafetyControlMenu } from './safety-control-menu'
import type { TodayCardData, VaultSummaryLineData, HomeMetricsData } from './types'

describe('TodayCardView Component', () => {
  it('준비된 글이 있을 때 단 1개의 CTA(미리보기 열기)를 올바르게 렌더링한다', () => {
    const cardData: TodayCardData = {
      state: 'READY_POST',
      title: '오늘 올릴 글 소희가 준비했어요',
      description: '소희가 준비한 글을 확인해 보세요.',
      ctaLabel: '미리보기 열기',
      ctaHref: '/app/content?post=post-1',
      badgeLabel: '확인 대기',
      postId: 'post-1',
    }

    render(<TodayCardView card={cardData} />)

    expect(screen.getByText('오늘 올릴 글 소희가 준비했어요')).toBeTruthy()
    expect(screen.getByText('확인 대기')).toBeTruthy()
    const link = screen.getByRole('link', { name: /미리보기 열기/ })
    expect(link.getAttribute('href')).toBe('/app/content?post=post-1')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('채널 연결이 필요할 때 단 1개의 CTA(채널 연결하기)를 올바르게 렌더링한다', () => {
    const cardData: TodayCardData = {
      state: 'CONNECT_CHANNEL',
      title: '채널을 연결하면 소희가 소식을 올려요',
      description: '채널을 연결하면 준비된 소식을 바로 발행할 수 있어요.',
      ctaLabel: '채널 연결하기',
      ctaHref: '/app/channels',
      badgeLabel: '연결 필요',
    }

    render(<TodayCardView card={cardData} />)

    expect(screen.getByText('채널을 연결하면 소희가 소식을 올려요')).toBeTruthy()
    const link = screen.getByRole('link', { name: /채널 연결하기/ })
    expect(link.getAttribute('href')).toBe('/app/channels')
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})

describe('VaultSummaryLine Component', () => {
  it('실집계된 정상 보관함 요약 텍스트를 렌더링하고 링크를 제공한다', () => {
    const data: VaultSummaryLineData = {
      storedCount: 3,
      externalActionCount: 0,
      thisWeekCount: 2,
      hasError: false,
      lineText: '보관 3건 · 외부 게시 0건 · 이번 주 2건',
    }

    render(<VaultSummaryLine data={data} />)

    expect(screen.getByText('보관 3건 · 외부 게시 0건 · 이번 주 2건')).toBeTruthy()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/app/vault')
  })

  it('조회 실패 시 오류 문구를 렌더링한다(빈 값으로 위장하지 않음)', () => {
    const data: VaultSummaryLineData = {
      storedCount: null,
      externalActionCount: null,
      thisWeekCount: null,
      hasError: true,
      lineText: '보관함을 불러오지 못했어요 · 잠시 후 다시 시도해 주세요',
    }

    render(<VaultSummaryLine data={data} />)

    expect(screen.getByText('보관함을 불러오지 못했어요 · 잠시 후 다시 시도해 주세요')).toBeTruthy()
  })
})

describe('HomeMetricsWidget Component', () => {
  it('성과 지표 3개("올린 글·문의·예약")를 렌더링하며 데이터 부재 시 "아직 없어요"를 표시한다', () => {
    const metrics: HomeMetricsData = {
      posts: {
        key: 'posts',
        label: '올린 글',
        value: null,
        emptyLabel: '아직 없어요',
        actionLabel: '첫 소식 올리기',
        actionHref: '/app/content',
      },
      inquiries: {
        key: 'inquiries',
        label: '문의',
        value: null,
        emptyLabel: '아직 없어요',
        actionLabel: '채널 연결하기',
        actionHref: '/app/channels',
      },
      reservations: {
        key: 'reservations',
        label: '예약',
        value: null,
        emptyLabel: '아직 없어요',
        actionLabel: '예약 안내 설정하기',
        actionHref: '/app/sohee',
      },
    }

    render(<HomeMetricsWidget metrics={metrics} />)

    expect(screen.getByText('올린 글')).toBeTruthy()
    expect(screen.getByText('문의')).toBeTruthy()
    expect(screen.getByText('예약')).toBeTruthy()
    expect(screen.getAllByText('아직 없어요')).toHaveLength(3)
  })
})

describe('SafetyControlMenu Component (2클릭 이내 긴급 정지 회귀 테스트)', () => {
  it('정상 상태에서 2클릭으로 긴급 정지를 실행할 수 있다', () => {
    const onTogglePause = vi.fn()
    render(<SafetyControlMenu isPaused={false} onTogglePause={onTogglePause} />)

    // 기본 상태에서는 일시정지 경고 배너가 보이지 않음
    expect(screen.queryByRole('alert')).toBeNull()

    // 1클릭: 메뉴 열기
    const menuButton = screen.getByRole('button', { name: '소희 업무 제어 메뉴' })
    fireEvent.click(menuButton)

    // 2클릭: 긴급 정지 버튼 클릭
    const pauseItem = screen.getByRole('menuitem', { name: /소희 업무 잠시 멈추기 \(긴급 정지\)/ })
    fireEvent.click(pauseItem)

    // 정확히 2번의 클릭으로 호출 검증
    expect(onTogglePause).toHaveBeenCalledTimes(1)
  })

  it('일시 정지 상태에서는 사장님 친화적 안내 배너가 표시되고 1클릭으로 재개할 수 있다', () => {
    const onTogglePause = vi.fn()
    render(<SafetyControlMenu isPaused={true} onTogglePause={onTogglePause} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('소희의 업무가 잠시 멈춰 있어요.')).toBeTruthy()
    expect(screen.getByText('사장님이 원하실 때 언제든 다시 시작할 수 있어요.')).toBeTruthy()

    const resumeButton = screen.getByRole('button', { name: /소희 업무 다시 시작하기/ })
    fireEvent.click(resumeButton)

    expect(onTogglePause).toHaveBeenCalledTimes(1)
  })
})
