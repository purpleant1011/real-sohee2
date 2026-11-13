import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { V085CommandCenter } from './v085-command-center'

describe('V085CommandCenter — 계획과 적용을 지어내지 않는다', () => {
  it('지시를 보내도 샘플 실행 계획을 결과로 내놓지 않는다', async () => {
    const { container } = render(<V085CommandCenter />)

    fireEvent.change(screen.getByLabelText('소희에게 지시할 내용 입력'), {
      target: { value: '화·목 오후 빈 예약 채워줘' },
    })
    fireEvent.click(screen.getByRole('button', { name: '지시하기' }))

    await waitFor(() => {
      expect(container.textContent).not.toMatch(/미연결/)
      expect(screen.getByText(/계획 세우기가 아직 연결되지 않았어요/)).toBeInTheDocument()
    })

    const text = container.textContent ?? ''
    expect(text).not.toMatch(/미예약 14명/)
    expect(text).not.toMatch(/약 120 ~ 170 credits/)
    expect(text).not.toMatch(/이번 주 화요일, 목요일 오후 예약이 많이 비는데/)
  })

  it('서버 확인 없이 "적용되었습니다" 성공 문구를 띄우지 않는다', async () => {
    const { container } = render(<V085CommandCenter />)

    fireEvent.change(screen.getByLabelText('소희에게 지시할 내용 입력'), { target: { value: '예산 아껴줘' } })
    fireEvent.click(screen.getByRole('button', { name: '지시하기' }))

    await waitFor(() => {
      expect(screen.getByText(/계획 세우기가 아직 연결되지 않았어요/)).toBeInTheDocument()
    })
    // 성공 상태로 전이하는 버튼 자체가 없어야 한다.
    expect(screen.queryByRole('button', { name: /이 계획대로 즉시 운영하기/ })).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/자동화 엔진에 즉시 반영되었습니다/)
  })
})
