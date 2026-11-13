import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WelcomeFirstPostBanner } from './welcome-first-post-banner'

describe('WelcomeFirstPostBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('renders banner when welcome=first-post query is present and not dismissed', () => {
    window.history.pushState({}, '', '/app?welcome=first-post')
    render(<WelcomeFirstPostBanner />)

    expect(
      screen.getByText('첫 글이 완성됐어요. 이제 이번 주 글도 소희와 함께 만들어 볼까요?'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '다음 글 만들기' })).toHaveAttribute(
      'href',
      '/app/content',
    )
    expect(screen.getByRole('button', { name: '둘러보기' })).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('dismisses banner on "둘러보기" click and persists flag to localStorage', () => {
    window.history.pushState({}, '', '/app?welcome=first-post')
    render(<WelcomeFirstPostBanner />)

    const dismissBtn = screen.getByRole('button', { name: '둘러보기' })
    fireEvent.click(dismissBtn)

    expect(
      screen.queryByText('첫 글이 완성됐어요. 이제 이번 주 글도 소희와 함께 만들어 볼까요?'),
    ).not.toBeInTheDocument()
    expect(localStorage.getItem('sohee_welcome_first_post_dismissed')).toBe('true')
  })

  it('does not render banner if already dismissed in localStorage', () => {
    localStorage.setItem('sohee_welcome_first_post_dismissed', 'true')
    window.history.pushState({}, '', '/app?welcome=first-post')
    render(<WelcomeFirstPostBanner />)

    expect(
      screen.queryByText('첫 글이 완성됐어요. 이제 이번 주 글도 소희와 함께 만들어 볼까요?'),
    ).not.toBeInTheDocument()
  })

  it('does not render banner when welcome query is absent', () => {
    window.history.pushState({}, '', '/app')
    render(<WelcomeFirstPostBanner />)

    expect(
      screen.queryByText('첫 글이 완성됐어요. 이제 이번 주 글도 소희와 함께 만들어 볼까요?'),
    ).not.toBeInTheDocument()
  })
})
