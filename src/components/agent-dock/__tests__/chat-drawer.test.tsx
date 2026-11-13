import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChatDrawer, CHAT_DRAWER_WIDTH_PX } from '../chat-drawer'
import { mockMatchMedia } from '@/test/mock-match-media'

const MOBILE = '(max-width: 767px)'
let media: ReturnType<typeof mockMatchMedia> | null = null

afterEach(() => {
  media?.restore()
  media = null
})

function renderOpen(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <ChatDrawer open onClose={onClose}>
        <button>첫째</button>
        <button>둘째</button>
      </ChatDrawer>,
    ),
  }
}

describe('ChatDrawer (desktop)', () => {
  it('renders nothing when closed', () => {
    render(
      <ChatDrawer open={false} onClose={vi.fn()}>
        <p>내용</p>
      </ChatDrawer>,
    )
    expect(screen.queryByTestId('sohee-chat-drawer')).toBeNull()
  })

  it('renders a labelled non-modal dialog without a scrim', () => {
    renderOpen()
    const dialog = screen.getByRole('dialog', { name: '소희와 대화' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(screen.queryByTestId('sohee-chat-drawer-scrim')).toBeNull()
  })

  it('calls onClose on Escape', () => {
    const { onClose } = renderOpen()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape that another layer already handled', () => {
    const { onClose } = renderOpen()
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not listen for Escape while closed', () => {
    const onClose = vi.fn()
    render(
      <ChatDrawer open={false} onClose={onClose}>
        <p>내용</p>
      </ChatDrawer>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('exposes the desktop width', () => {
    expect(CHAT_DRAWER_WIDTH_PX).toBe(460)
  })
})

describe('ChatDrawer (mobile)', () => {
  it('moves focus inside the sheet when it opens', async () => {
    media = mockMatchMedia({ [MOBILE]: true })
    renderOpen()
    await waitFor(() => expect(screen.getByRole('button', { name: '첫째' })).toHaveFocus())
  })
  it('is a modal bottom sheet with a scrim that closes it', () => {
    media = mockMatchMedia({ [MOBILE]: true })
    const { onClose } = renderOpen()
    expect(screen.getByRole('dialog', { name: '소희와 대화' })).toHaveAttribute('aria-modal', 'true')
    const scrim = screen.getByTestId('sohee-chat-drawer-scrim')
    expect(scrim.className).toContain('z-[45]')
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the sheet', () => {
    media = mockMatchMedia({ [MOBILE]: true })
    renderOpen()
    const [first, second] = screen.getAllByRole('button', { name: /첫째|둘째/ })
    second.focus()
    fireEvent.keyDown(screen.getByTestId('sohee-chat-drawer'), { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    first.focus()
    fireEvent.keyDown(screen.getByTestId('sohee-chat-drawer'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(second)
  })
})
