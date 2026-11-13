import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MobileLandingView } from '../landing-view'
import { LANDING_EXAMPLES } from '../landing-model'

const snapshot = { loadState: 'ready' as const, examples: LANDING_EXAMPLES, checkedAt: null }

describe('MobileLandingView 로그인 상태', () => {
  it('로그인한 사용자는 가입 대신 내 작업 열기(/app)를 본다', () => {
    render(<MobileLandingView snapshot={snapshot} signedIn />)
    expect(screen.getByRole('link', { name: '내 작업 열기' })).toHaveAttribute('href', '/app')
    expect(screen.queryByRole('link', { name: '무료로 우리 가게 시작하기' })).toBeNull()
  })
  it('비로그인은 기존 가입 CTA 그대로', () => {
    render(<MobileLandingView snapshot={snapshot} />)
    expect(screen.getByRole('link', { name: '무료로 우리 가게 시작하기' })).toBeInTheDocument()
  })
})

describe('MobileLandingView 로그인 상태 안내 문구', () => {
  it('로그인한 사용자에게는 가입 화면 약관 안내를 보여주지 않는다', () => {
    render(<MobileLandingView snapshot={snapshot} signedIn />)
    expect(screen.queryByText(/가입 화면에서/)).toBeNull()
  })
  it('가로 스크롤 카드 목록은 첫 카드가 왼쪽 여백을 유지하도록 scroll-padding 을 갖는다', () => {
    const { container } = render(<MobileLandingView snapshot={snapshot} />)
    const snapLists = Array.from(container.querySelectorAll('ul')).filter(ul => ul.className.includes('snap-x'))
    expect(snapLists.length).toBeGreaterThan(0)
    for (const ul of snapLists) expect(ul.className).toContain('scroll-pl-4')
  })
})
