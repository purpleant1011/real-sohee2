import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosisForm } from './diagnosis-form'

describe('DiagnosisForm', () => {
  it('비밀번호 없이 예비 진단을 먼저 보여준다', () => {
    render(<DiagnosisForm />)
    expect(screen.queryByLabelText(/비밀번호/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('매장 이름'), { target: { value: '별빛 헤어' } })
    fireEvent.change(screen.getByLabelText('업종'), { target: { value: 'beauty' } })
    fireEvent.change(screen.getByLabelText('가장 해결하고 싶은 문제'), { target: { value: 'booking' } })
    fireEvent.change(screen.getByLabelText('공개 채널'), { target: { value: 'instagram' } })
    fireEvent.click(screen.getByRole('button', { name: '내 매장 진단 보기' }))
    expect(screen.getByText('입력 내용을 바탕으로 준비한 예비 진단')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '이 진단으로 소희 시작하기' })).toHaveAttribute('href', '/signup?source=diagnosis')
  })

  it('진단 의도를 세션에만 저장한다', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<DiagnosisForm />)
    fireEvent.change(screen.getByLabelText('매장 이름'), { target: { value: '별빛 헤어' } })
    fireEvent.click(screen.getByRole('button', { name: '내 매장 진단 보기' }))
    const startLink = screen.getByRole('link', { name: '이 진단으로 소희 시작하기' })
    startLink.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(startLink)
    expect(setItem).toHaveBeenCalledWith('sohee-v085-diagnosis-intent', expect.any(String))
    setItem.mockRestore()
  })
})
