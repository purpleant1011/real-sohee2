import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CustomerWorkspace } from './customer-workspace'

describe('CustomerWorkspace', () => {
  it('renders focused 2-column layout: customer list and conversation stream', () => {
    render(<CustomerWorkspace workspaceId="ws-test-01" />)

    expect(screen.getByTestId('customer-workspace')).toBeInTheDocument()
    expect(screen.getByLabelText('고객 반응 목록')).toBeInTheDocument()
    expect(screen.getByLabelText('고객 대화 히스토리')).toBeInTheDocument()
    expect(screen.getByLabelText('고객 문맥 및 AI 답변 초안')).toBeInTheDocument()
  })

  it('renders Segmented Control 3-tone pill selector with real-time preview', () => {
    render(<CustomerWorkspace workspaceId="ws-test-01" />)

    expect(screen.getByTestId('tone-tab-fast_short')).toBeInTheDocument()
    expect(screen.getByTestId('tone-tab-warm_friendly')).toBeInTheDocument()
    expect(screen.getByTestId('tone-tab-booking_focused')).toBeInTheDocument()

    // Default or clicked tone shows active draft text in preview
    const warmTab = screen.getByTestId('tone-tab-warm_friendly')
    fireEvent.click(warmTab)
    expect(screen.getByTestId('draft-preview-box')).toBeInTheDocument()
  })

  it('sends the selected draft via one-click approval button and updates conversation', async () => {
    render(<CustomerWorkspace workspaceId="ws-test-01" />)

    // Select warm_friendly tone
    const warmTab = screen.getByTestId('tone-tab-warm_friendly')
    fireEvent.click(warmTab)

    // Click single send button
    const sendBtn = screen.getByTestId('send-selected-draft')
    fireEvent.click(sendBtn)

    const approvedFeedback = await screen.findByText(/답변 승인 완료/i)
    expect(approvedFeedback).toBeInTheDocument()
    const matches = screen.getAllByText(/매장 상담에 관심 가져주셔서/i)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('switches between customer cards', () => {
    render(<CustomerWorkspace workspaceId="ws-test-01" />)

    const secondCard = screen.getByTestId('customer-card-guide-cust-02')
    fireEvent.click(secondCard)

    expect(screen.getByText('이지수 님과의 대화')).toBeInTheDocument()
    const matches = screen.getAllByText(/사장님께서 상담 때 꼭 맞는 서비스를/i)
    expect(matches.length).toBeGreaterThan(0)
  })
})
