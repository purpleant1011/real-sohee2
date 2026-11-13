import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TEACH_TOPICS } from './teach-model'
import { TeachQuestionChips } from './teach-question-chips'

describe('TeachQuestionChips', () => {
  it('7개의 모든 주제 칩과 진행 상태 텍스트를 렌더링한다', () => {
    render(<TeachQuestionChips covered={[]} onPick={vi.fn()} />)

    // 진행 상태 텍스트
    expect(screen.getByText('0/7 가르쳤어요')).toBeInTheDocument()

    // 7개 칩 확인
    for (const topic of TEACH_TOPICS) {
      expect(screen.getByRole('button', { name: new RegExp(topic.label) })).toBeInTheDocument()
    }
  })

  it('가르친 주제는 체크 표시 및 완료 스타일이 적용되고 진행률(3/7)이 업데이트된다', () => {
    const covered = [TEACH_TOPICS[0].id, TEACH_TOPICS[1].id, TEACH_TOPICS[2].id]
    render(<TeachQuestionChips covered={covered} onPick={vi.fn()} />)

    expect(screen.getByText('3/7 가르쳤어요')).toBeInTheDocument()

    // 첫 번째 칩(가게 소개)은 완료 상태
    const firstButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[0].label) })
    expect(firstButton).toHaveAttribute('data-covered', 'true')
    // 체크 아이콘(svg) 포함 여부
    expect(firstButton.querySelector('svg')).toBeInTheDocument()

    // 4번째 칩(영업시간·위치)은 미완료 상태이자 다음 추천 주제
    const nextButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[3].label) })
    expect(nextButton).toHaveAttribute('data-covered', 'false')
    expect(nextButton).toHaveAttribute('data-next', 'true')
  })

  it('다음 추천 주제(첫 미완료 주제)는 primary로 강조된다', () => {
    render(<TeachQuestionChips covered={[]} onPick={vi.fn()} />)

    // 첫 번째 칩이 다음 추천
    const firstButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[0].label) })
    expect(firstButton).toHaveAttribute('data-next', 'true')
    // primary 스타일 클래스 포함 확인
    expect(firstButton.className).toMatch(/bg-primary/)
  })

  it('칩은 min-h-11 이상의 큰 터치 영역을 갖는다', () => {
    render(<TeachQuestionChips covered={[]} onPick={vi.fn()} />)
    const firstButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[0].label) })
    expect(firstButton.className).toContain('min-h-11')
  })

  it('칩을 클릭하면 onPick(prompt)만 호출하고 자체 전송하지 않는다', () => {
    const onPick = vi.fn()
    render(<TeachQuestionChips covered={[]} onPick={onPick} />)

    const menuButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[1].label) })
    fireEvent.click(menuButton)

    expect(onPick).toHaveBeenCalledTimes(1)
    const pickedPrompt = onPick.mock.calls[0][0]
    expect(pickedPrompt).toContain(TEACH_TOPICS[1].label)
    expect(pickedPrompt).toContain('한 번에 하나씩')
  })

  it('disabled일 때 칩 클릭이 동작하지 않는다', () => {
    const onPick = vi.fn()
    render(<TeachQuestionChips covered={[]} onPick={onPick} disabled />)

    const firstButton = screen.getByRole('button', { name: new RegExp(TEACH_TOPICS[0].label) })
    expect(firstButton).toBeDisabled()

    fireEvent.click(firstButton)
    expect(onPick).not.toHaveBeenCalled()
  })
})
