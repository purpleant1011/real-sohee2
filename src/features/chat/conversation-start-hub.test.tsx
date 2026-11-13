import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationStartHub } from './conversation-start-hub'

describe('ConversationStartHub', () => {
  it('큼직한 질문과 대화 종류 카드를 보여 준다', () => {
    render(<ConversationStartHub onStart={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /무엇을 하고 싶으세요/ })).toBeInTheDocument()
    for (const name of ['포스팅 만들기', '소희 가르치기', '고객 문의 답변', '성과 점검']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: '시작하기' })).toBeNull()
  })
  it('포스팅: 목적 하나와 채널(체크)을 고르면 시작할 수 있고, 시작을 눌러야 전송된다', () => {
    const onStart = vi.fn()
    render(<ConversationStartHub onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: /포스팅 만들기/ }))
    const start = screen.getByRole('button', { name: '시작하기' })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: '이벤트' }))
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /인스타그램/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /네이버 블로그/ }))
    expect(start).toBeEnabled()
    expect(onStart).not.toHaveBeenCalled()
    fireEvent.click(start)
    expect(onStart).toHaveBeenCalledOnce()
    expect(onStart.mock.calls[0][0]).toContain('이벤트')
    expect(onStart.mock.calls[0][0]).toContain('네이버 블로그')
  })
  it('채널 체크는 다시 누르면 해제되고, 수동 채널에는 직접 올리는 채널임을 알린다', () => {
    render(<ConversationStartHub onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /포스팅 만들기/ }))
    const naver = screen.getByRole('checkbox', { name: /네이버 블로그/ })
    fireEvent.click(naver); expect(naver).toBeChecked()
    fireEvent.click(naver); expect(naver).not.toBeChecked()
    expect(screen.getAllByText('직접 올리기').length).toBe(2)
    expect(screen.getAllByText('소희가 게시').length).toBe(2)
  })
  it('가르치기는 설정 없이 바로 시작할 수 있다', () => {
    const onStart = vi.fn()
    render(<ConversationStartHub onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: /소희 가르치기/ }))
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }))
    expect(onStart.mock.calls[0][0]).toMatch(/가르/)
  })
  it('모드가 선택되었을 때 sticky 시작하기 컨테이너는 하단 바 높이만큼 바닥에서 띄운다', () => {
    render(<ConversationStartHub onStart={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /소희 가르치기/ }))
    const startBtn = screen.getByRole('button', { name: '시작하기' })
    const stickyContainer = startBtn.parentElement
    expect(stickyContainer).toHaveStyle({ bottom: 'var(--conversation-scroll-clearance, 0px)' })
  })
  it('비활성화되면 아무것도 보내지 못한다', () => {
    const onStart = vi.fn()
    render(<ConversationStartHub onStart={onStart} disabled />)
    expect(screen.getByRole('button', { name: /포스팅 만들기/ })).toBeDisabled()
  })
})

describe('ConversationStartHub 가르치기 주제', () => {
  it('가르치기에서 주제를 고르면 그 주제로 시작 메시지가 만들어진다(고르는 것만으로는 전송하지 않는다)', () => {
    const onStart = vi.fn()
    render(<ConversationStartHub onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: /소희 가르치기/ }))
    const chip = screen.getAllByRole('button').find(b => /가격/.test(b.textContent ?? '') && !/소희 가르치기/.test(b.textContent ?? ''))!
    fireEvent.click(chip)
    expect(onStart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }))
    expect(onStart.mock.calls[0][0]).toMatch(/가격/)
  })
})
