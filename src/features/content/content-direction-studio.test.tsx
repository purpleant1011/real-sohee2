import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ContentDirectionStudio } from './content-direction-studio'
import { IMAGE_LOOK_DEFINITIONS } from './direction-types'

describe('ContentDirectionStudio', () => {
  it('renders all 3 sections: conversation rail, workspace, and live brief', () => {
    render(<ContentDirectionStudio workspaceId="ws-test-01" />)

    expect(screen.getByTestId('content-direction-studio')).toBeInTheDocument()
    expect(screen.getByLabelText('소희 대화 레일')).toBeInTheDocument()
    expect(screen.getByLabelText('콘텐츠 디렉션 작업면')).toBeInTheDocument()
    expect(screen.getByLabelText('실시간 라이브 브리프')).toBeInTheDocument()
  })

  it('renders all 4 image look cards with badges and titles', () => {
    render(<ContentDirectionStudio workspaceId="ws-test-01" />)

    Object.keys(IMAGE_LOOK_DEFINITIONS).forEach((lookKey) => {
      const card = screen.getByTestId(`look-card-${lookKey}`)
      expect(card).toBeInTheDocument()
    })

    // '추천 1위' should be '추천' without '1위' keyword
    expect(IMAGE_LOOK_DEFINITIONS.owner_explaining.badge).toBe('추천')
    expect(IMAGE_LOOK_DEFINITIONS.owner_explaining.badge).not.toContain('1위')
  })

  it('synchronizes live brief when an image look is selected', () => {
    const onSave = vi.fn()
    render(<ContentDirectionStudio workspaceId="ws-test-01" onSaveDirection={onSave} />)

    // Click '따뜻한 실내 무드'
    const indoorCard = screen.getByTestId('look-card-indoor_mood')
    fireEvent.click(indoorCard)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        imageLook: 'indoor_mood',
      })
    )

    // Verify live brief shows updated value
    const liveBrief = screen.getByLabelText('실시간 라이브 브리프')
    expect(liveBrief).toHaveTextContent(IMAGE_LOOK_DEFINITIONS.indoor_mood.label)
  })

  it('toggles composition tags and updates live brief', () => {
    const onSave = vi.fn()
    render(<ContentDirectionStudio workspaceId="ws-test-01" onSaveDirection={onSave} />)

    const productTag = screen.getByTestId('comp-tag-product_focus')
    fireEvent.click(productTag)

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        compositions: expect.arrayContaining(['product_focus']),
      })
    )
  })

  it('updates freeform instruction and triggers save callback', () => {
    const onSave = vi.fn()
    render(<ContentDirectionStudio workspaceId="ws-test-01" onSaveDirection={onSave} />)

    const textarea = screen.getByTestId('freeform-instruction')
    fireEvent.change(textarea, { target: { value: '가을 신제품 앰플을 집중 조명해줘' } })

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        freeformInstruction: '가을 신제품 앰플을 집중 조명해줘',
      })
    )
  })

  it('transitions to ready_for_review status on review button click', () => {
    const onRequestReview = vi.fn()
    render(<ContentDirectionStudio workspaceId="ws-test-01" onRequestReview={onRequestReview} />)

    const reviewBtn = screen.getByTestId('review-board-button')
    fireEvent.click(reviewBtn)

    expect(onRequestReview).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready_for_review',
      })
    )

    expect(screen.getByText('✓ 디렉션 보드 준비됨')).toBeInTheDocument()
  })
})
