import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactToPostModal } from '../components/fact-to-post-modal'
import type { FactItem } from '@/features/sohee-knowledge/types'

describe('FactToPostModal', () => {
  const mockFact: FactItem = {
    id: 'fact-1',
    category: 'MENU',
    content: '100% 제주산 흑돼지만을 엄선하여 14일간 저온 숙성합니다.',
    createdAt: '2026-10-15T10:00:00Z',
    source: 'interview',
  }

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    fact: mockFact,
    businessName: '제주흑돈',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isOpen이 false이거나 fact가 없으면 모달을 렌더링하지 않는다', () => {
    const { rerender } = render(<FactToPostModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('소희가 쓴 마케팅 글 초안')).not.toBeInTheDocument()

    rerender(<FactToPostModal {...defaultProps} fact={null} />)
    expect(screen.queryByText('소희가 쓴 마케팅 글 초안')).not.toBeInTheDocument()
  })

  it('소희 헤더, 원본 팩트 내용, 3가지 톤 탭을 정상 렌더링한다', () => {
    render(<FactToPostModal {...defaultProps} />)

    // 헤더 및 서브 카피
    expect(screen.getByText('소희가 쓴 마케팅 글 초안')).toBeInTheDocument()
    expect(
      screen.getByText('선택하신 지식을 바탕으로 인스타·블로그 글을 미리 지어봤어요'),
    ).toBeInTheDocument()

    // 원본 지식 팩트 카드
    expect(screen.getByText(mockFact.content)).toBeInTheDocument()

    // 3가지 톤앤매너 탭
    expect(screen.getByRole('tab', { name: /친근하고 다정하게/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /트렌디하고 감성 있게/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /전문적이고 신뢰감 있게/ })).toBeInTheDocument()
  })

  it('기본 톤(친근하고 다정하게)의 카피가 렌더링되고, 탭 전환 시 각 톤에 맞는 카피가 노출된다', () => {
    render(<FactToPostModal {...defaultProps} />)

    // 기본 다정체 카피 확인
    expect(screen.getByText(/안녕하세요 이웃님들!/)).toBeInTheDocument()
    expect(screen.getByText(/오늘도 행복한 하루 보내세요/)).toBeInTheDocument()

    // 트렌디 감성체 탭 클릭
    const trendyTab = screen.getByRole('tab', { name: /트렌디하고 감성 있게/ })
    fireEvent.click(trendyTab)
    expect(screen.getByText(/햇살 가득한 오후, 놓치면 아쉬운/)).toBeInTheDocument()
    expect(screen.getByText(/피드 저장해두고 이번 주말에 꼭 들러보세요!/)).toBeInTheDocument()

    // 전문가 신뢰체 탭 클릭
    const expertTab = screen.getByRole('tab', { name: /전문적이고 신뢰감 있게/ })
    fireEvent.click(expertTab)
    expect(screen.getByText(/정성과 기본에 충실한/)).toBeInTheDocument()
    expect(screen.getByText(/언제나 최상의 만족을 드리기 위해/)).toBeInTheDocument()
  })

  it('[본문 복사하기] 클릭 시 클립보드에 현재 카피가 복사되고 "복사 완료!" 피드백이 표시된다', async () => {
    render(<FactToPostModal {...defaultProps} />)

    const copyButton = screen.getByRole('button', { name: /본문 복사하기/ })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('안녕하세요 이웃님들!'),
      )
    })

    // 피드백 문구 확인
    expect(await screen.findByText('복사 완료!')).toBeInTheDocument()
  })

  it('[4채널 콘텐츠 센터로 이동] 버튼이 올바른 링크(/app/content)를 가진다', () => {
    render(<FactToPostModal {...defaultProps} />)

    const contentLink = screen.getByRole('link', { name: /4채널 콘텐츠 센터로 이동/ })
    expect(contentLink).toHaveAttribute('href', '/app/content')
  })

  it('[닫기] 버튼 클릭 시 onClose 콜백이 호출된다', () => {
    const onClose = vi.fn()
    render(<FactToPostModal {...defaultProps} onClose={onClose} />)

    const closeButtons = screen.getAllByRole('button', { name: /닫기/ })
    // 하단 액션 버튼의 닫기 클릭
    fireEvent.click(closeButtons[closeButtons.length - 1])

    expect(onClose).toHaveBeenCalled()
  })
})
