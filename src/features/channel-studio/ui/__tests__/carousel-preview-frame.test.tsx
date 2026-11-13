import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CarouselPreviewFrame } from '../carousel-preview-frame'

describe('CarouselPreviewFrame', () => {
  it('renders single image correctly without slide navigation', () => {
    render(<CarouselPreviewFrame images={['https://example.com/img1.jpg']} />)

    expect(screen.getByTestId('carousel-preview-frame')).toBeInTheDocument()
    expect(screen.getByText('단일 피드 이미지')).toBeInTheDocument()
    expect(screen.queryByLabelText('다음 슬라이드')).toBeNull()
  })

  it('renders carousel slide navigation and step badges when multiple images are provided', () => {
    const images = [
      'https://example.com/slide1.jpg',
      'https://example.com/slide2.jpg',
      'https://example.com/slide3.jpg',
    ]

    render(<CarouselPreviewFrame images={images} />)

    expect(screen.getByText(/카드뉴스 캐러셀 \(1\/3\)/)).toBeInTheDocument()
    expect(screen.getByText('1. 메인 표지')).toBeInTheDocument()

    // Next slide
    const nextBtn = screen.getByLabelText('다음 슬라이드')
    fireEvent.click(nextBtn)

    expect(screen.getByText(/카드뉴스 캐러셀 \(2\/3\)/)).toBeInTheDocument()
    expect(screen.getByText('2. 매장 공간 및 대표 메뉴')).toBeInTheDocument()

    // Aspect ratio toggle
    const storyToggle = screen.getByRole('button', { name: /스토리 9:16/ })
    fireEvent.click(storyToggle)
    expect(storyToggle).toHaveClass('font-bold')
  })
})
