import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResultsRangeSheet } from './results-range-sheet'

// 서버 규칙(오늘까지만·최대 92일)을 화면이 같은 날짜 기준으로 판정하는지 본다.
const NOW = new Date('2026-10-24T13:05:00.000Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function renderSheet(overrides: Partial<Parameters<typeof ResultsRangeSheet>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onConfirm = vi.fn()
  render(<ResultsRangeSheet open onOpenChange={onOpenChange} value={null} onConfirm={onConfirm} {...overrides} />)
  return { onOpenChange, onConfirm }
}

const startInput = () => screen.getByLabelText('시작일') as HTMLInputElement
const endInput = () => screen.getByLabelText('종료일') as HTMLInputElement
const submitButton = () => screen.getByRole('button', { name: '이 기간 보기' })

function setRange(start: string, end: string) {
  fireEvent.change(startInput(), { target: { value: start } })
  fireEvent.change(endInput(), { target: { value: end } })
}

describe('기간 직접 선택 바텀시트(ANI-1782)', () => {
  it('값이 없으면 오늘(UTC)을 포함한 최근 7일로 시작한다', () => {
    renderSheet()

    expect(startInput().value).toBe('2026-10-18')
    expect(endInput().value).toBe('2026-10-24')
  })

  it('적용 중인 구간이 있으면 그 값으로 시작한다', () => {
    renderSheet({ value: { start: '2026-09-01', end: '2026-09-30' } })

    expect(startInput().value).toBe('2026-09-01')
    expect(endInput().value).toBe('2026-09-30')
  })

  it('종료일이 시작일보다 빠르면 사유를 보여주고 확인을 잠근다', () => {
    renderSheet()
    setRange('2026-10-03', '2026-10-01')

    expect(screen.getByRole('status')).toHaveTextContent('종료일은 시작일보다 빠를 수 없어요')
    expect(submitButton()).toBeDisabled()
  })

  it('92일을 넘는 구간은 사유를 보여주고 확인을 잠근다', () => {
    renderSheet()
    setRange('2026-07-01', '2026-10-01')

    expect(screen.getByRole('status')).toHaveTextContent('최대 92일까지 볼 수 있어요')
    expect(submitButton()).toBeDisabled()
  })

  it('오늘 이후로 끝나는 구간은 사유를 보여주고 확인을 잠근다', () => {
    renderSheet()
    setRange('2026-10-01', '2026-10-25')

    expect(screen.getByRole('status')).toHaveTextContent('오늘 이후는 볼 수 없어요')
    expect(submitButton()).toBeDisabled()
  })

  it('빈 칸은 사유 없이 확인만 잠근다', () => {
    renderSheet()
    fireEvent.change(startInput(), { target: { value: '' } })

    expect(screen.getByRole('status').textContent).toBe('')
    expect(submitButton()).toBeDisabled()
  })

  it('정상 구간을 확인하면 그대로 알리고 시트를 닫는다', () => {
    const { onConfirm, onOpenChange } = renderSheet()
    setRange('2026-10-17', '2026-10-23')

    fireEvent.click(submitButton())

    expect(onConfirm).toHaveBeenCalledWith({ start: '2026-10-17', end: '2026-10-23' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('취소하면 값 없이 닫는다', () => {
    const { onConfirm, onOpenChange } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('입력은 44px 터치·16px 글자이고 사유 문구와 이어진다', () => {
    renderSheet()

    for (const input of [startInput(), endInput()]) {
      expect(input.className).toContain('min-h-11')
      expect(input.className).toContain('text-base')
      const describedBy = input.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      expect(document.getElementById(describedBy as string)).toBe(screen.getByRole('status'))
    }
    for (const button of [submitButton(), screen.getByRole('button', { name: '취소' })]) {
      expect(button.className).toContain('min-h-11')
    }
  })
})
