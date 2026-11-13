import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NaverPlaceConnectCard } from './naver-place-connect-card'

describe('NaverPlaceConnectCard', () => {
  it('네이버 플레이스 자동 수집 폼을 노출하지 않고 직접 입력 안내를 제공한다', () => {
    render(
      <NaverPlaceConnectCard
        workspaceId="00000000-0000-4000-8000-0000000000a2"
      />
    )

    expect(screen.getByText('매장 기본 정보 직접 등록')).toBeInTheDocument()
    expect(screen.getByText(/네이버 지도 자동 연동은 제공하지 않아요/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/naver.me/)).not.toBeInTheDocument()
    expect(screen.queryByText(/1초/)).not.toBeInTheDocument()
  })

  it('기존 매장 정보가 있는 경우 직접 등록 완료 상태로 카드와 CTA를 표시한다', async () => {
    const onStartBlogPost = vi.fn()
    const onStartSnsCard = vi.fn()

    const mockSummary = {
      placeId: '2085035251',
      name: '바이름 청라점',
      category: '속눈썹증모,연장',
      roadAddress: '인천 서해구 청라커낼로288번길 8-10 2층 208호',
      jibunAddress: '인천 서해구 청라동',
      businessHours: '20:00에 영업 종료',
      visitorReviewScore: 4.98,
      visitorReviewCount: 87,
      images: ['https://example.com/img1.jpg'],
      hasTalktalk: true,
    }

    render(
      <NaverPlaceConnectCard
        workspaceId="00000000-0000-4000-8000-0000000000a2"
        initialPlace={mockSummary}
        onStartBlogPost={onStartBlogPost}
        onStartSnsCard={onStartSnsCard}
      />
    )

    expect(screen.getByText('바이름 청라점')).toBeInTheDocument()
    expect(screen.getByText('등록 완료')).toBeInTheDocument()
    expect(screen.getByText('이 정보로 블로그 첫 글 쓰기')).toBeInTheDocument()
    expect(screen.getByText('⭐ 찐 후기 감사 카드뉴스 (인스타/스레드)')).toBeInTheDocument()

    // Click start SNS card CTA
    fireEvent.click(screen.getByRole('button', { name: '⭐ 찐 후기 감사 카드뉴스 (인스타/스레드)' }))
    expect(onStartSnsCard).toHaveBeenCalledWith(mockSummary)

    // Click start blog post CTA
    fireEvent.click(screen.getByRole('button', { name: '이 정보로 블로그 첫 글 쓰기' }))
    expect(onStartBlogPost).toHaveBeenCalledWith(mockSummary)
  })

  it('종료된 기능의 개발 이력 문구("비공식 자동 수집") 대신 직접 입력 안내를 보여준다', () => {
    const { container } = render(<NaverPlaceConnectCard workspaceId="00000000-0000-4000-8000-0000000000a2" />)
    expect(container).not.toHaveTextContent('비공식')
    expect(container).not.toHaveTextContent('자동 수집')
    expect(container).toHaveTextContent('우리 가게 정보')
  })
})
