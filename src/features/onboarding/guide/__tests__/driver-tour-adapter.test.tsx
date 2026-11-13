import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DriverTourAdapter, ONBOARDING_TOUR_STEPS } from '../driver-tour-adapter'

describe('DriverTourAdapter (소희 AI 가이드 0.9.0 튜토리얼)', () => {
  it('isOpen이 false면 가이드 모달을 렌더링하지 않는다', () => {
    const { container } = render(<DriverTourAdapter isOpen={false} />)
    expect(container.querySelector('[role="dialog"], .fixed')).toBeNull()
  })

  it('isOpen이 true면 4대 핵심 가이드의 첫 번째 단계를 보여준다', () => {
    render(<DriverTourAdapter isOpen={true} />)
    expect(screen.getByText('매장 기본 정보 직접 등록')).toBeInTheDocument()
    expect(screen.getByText(/상호, 주소, 대표 메뉴와 매장 특징을 입력해 주시면/)).toBeInTheDocument()
    expect(screen.queryByText(/1초 연동/)).not.toBeInTheDocument()
    expect(screen.queryByText(/자동으로 채워/)).not.toBeInTheDocument()
    expect(screen.getByText(`1 / ${ONBOARDING_TOUR_STEPS.length}`)).toBeInTheDocument()
  })

  it('다음 버튼을 누르면 2단계, 3단계, 4단계로 순차 이동하고 마지막에 가이드 완료 버튼이 뜬다', () => {
    const handleClose = vi.fn()
    render(<DriverTourAdapter isOpen={true} onClose={handleClose} />)

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole('button', { name: /다음/ }))
    expect(screen.getByText('사장님 취향의 6종 맞춤 말투')).toBeInTheDocument()

    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /다음/ }))
    expect(screen.getByText('4채널 원클릭 맞춤 글 만들기')).toBeInTheDocument()

    // Step 3 -> Step 4 (마지막)
    fireEvent.click(screen.getByRole('button', { name: /다음/ }))
    expect(screen.getByText('사장님 안심 승인 원칙')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /가이드 완료/ })).toBeInTheDocument()

    // Step 4 완료 클릭 시 onClose 호출
    fireEvent.click(screen.getByRole('button', { name: /가이드 완료/ }))
    expect(handleClose).toHaveBeenCalled()
  })

  it('닫기 버튼(X)을 누르면 onClose가 호출된다', () => {
    const handleClose = vi.fn()
    const { container } = render(<DriverTourAdapter isOpen={true} onClose={handleClose} />)
    const closeBtn = container.querySelector('button svg.lucide-x')?.parentElement
    expect(closeBtn).toBeDefined()
    if (closeBtn) {
      fireEvent.click(closeBtn)
      expect(handleClose).toHaveBeenCalled()
    }
  })
})
