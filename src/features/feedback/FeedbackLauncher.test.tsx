// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedbackLauncher, isPreviewScreen, normalizeScreen } from './FeedbackLauncher'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FeedbackLauncher', () => {
  it('화면 이름에서 긴 번호를 빼고 보관함은 미리보기 화면으로 본다', () => {
    expect(normalizeScreen('/app/content/0b1c2d3e-1111-4222-8333-444455556666?x=1')).toBe('/app/content/:번호')
    expect(isPreviewScreen('/app/vault')).toBe(true)
    expect(isPreviewScreen('/app/customers')).toBe(false)
  })

  it('설정 입력 화면에서는 의견 버튼이 폼 위에 고정되지 않는다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app/settings/services" />)
    expect(screen.getByRole('button', { name: '의견 보내기' })).not.toHaveClass('fixed')
  })

  it('PC 사이드바용 변형은 화면에 떠 있지 않고 콘텐츠를 가리지 않는다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app/customers" variant="sidebar" />)
    const button = screen.getByRole('button', { name: '의견 보내기' })
    expect(button).not.toHaveClass('fixed')
  })

  it('모바일 전용 떠 있는 변형은 넓은 화면에서 숨겨진다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app/customers" variant="floating-mobile" />)
    const button = screen.getByRole('button', { name: '의견 보내기' })
    expect(button).toHaveClass('fixed')
    expect(button).toHaveClass('md:hidden')
  })

  it('보관함에서는 "실제 앱과 달라 보여요"가 기본 선택이고 민감정보 주의 문구가 보인다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app/vault" />)
    fireEvent.click(screen.getByRole('button', { name: '의견 보내기' }))
    expect(screen.getByRole('button', { name: '이 화면이 실제 앱과 달라 보여요' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/민감한 정보는 적지 말아 주세요/)).toBeTruthy()
  })

  it('평점과 내용을 보내고 성공 문구를 보여 준다', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 201 }))
    render(<FeedbackLauncher workspaceId="ws" pathname="/app/customers" />)
    fireEvent.click(screen.getByRole('button', { name: '의견 보내기' }))
    fireEvent.click(screen.getByRole('button', { name: '4점' }))
    fireEvent.change(screen.getByLabelText('자세한 내용'), { target: { value: '좋아요' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('고마워요'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workspaces/ws/feedback')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ screen: '/app/customers', kind: 'GENERAL', rating: 4, message: '좋아요' })
  })

  it('보내기에 실패하면 성공처럼 보이지 않고 오류를 알린다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: '의견을 보내지 못했어요.' }), { status: 500 }))
    render(<FeedbackLauncher workspaceId="ws" pathname="/app" />)
    fireEvent.click(screen.getByRole('button', { name: '의견 보내기' }))
    fireEvent.change(screen.getByLabelText('자세한 내용'), { target: { value: '안녕' } })
    fireEvent.click(screen.getByRole('button', { name: '보내기' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('보내지 못했어요'))
    expect(screen.queryByText(/고마워요/)).toBeNull()
  })

  it('데스크톱 고정 의견 버튼의 하단 여백이 커맨드바 높이 변수(--command-bar-height)를 반영하고 md:bottom-4를 쓰지 않는다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app" />)
    const button = screen.getByRole('button', { name: '의견 보내기' })
    expect(button).toHaveClass('fixed')
    expect(button.className).not.toMatch(/md:bottom-4\b/)
    expect(button.className).toMatch(/--command-bar-height/)
  })

  it('열린 대화상자도 데스크톱에서 커맨드바 높이 변수(--command-bar-height)를 반영한다', () => {
    render(<FeedbackLauncher workspaceId="ws" pathname="/app" />)
    fireEvent.click(screen.getByRole('button', { name: '의견 보내기' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/--command-bar-height/)
  })
})
