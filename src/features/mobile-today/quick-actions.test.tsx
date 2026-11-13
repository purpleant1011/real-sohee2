import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuickActions } from './quick-actions'

describe('QuickActions', () => {
  it('nav aria-label과 보이는 소제목으로 바로가기를 제공한다', () => {
    render(<QuickActions />)
    const nav = screen.getByRole('navigation', { name: '바로가기' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '바로가기' })).toBeInTheDocument()
  })

  it('하단 탭 바(더보기)와의 중복을 방지하기 위해 전체 메뉴 링크를 노출하지 않는다', () => {
    render(<QuickActions />)
    expect(screen.queryByRole('link', { name: /전체 메뉴/ })).toBeNull()
  })

  it('4칸 한 줄(소통함·승인 대기·예약 일정·보관함) 바로가기 항목을 제공하고 설명 텍스트는 없다', () => {
    render(<QuickActions />)
    const nav = screen.getByRole('navigation', { name: '바로가기' })
    const itemLinks = Array.from(nav.querySelectorAll('ul a')).map(a => ({
      text: a.textContent?.trim(),
      href: a.getAttribute('href'),
      hasMinHeight: a.className.includes('min-h-[76px]'),
    }))

    expect(itemLinks).toEqual([
      { text: '소통함', href: '/app/engagement', hasMinHeight: true },
      { text: '승인 대기', href: '/app/approvals', hasMinHeight: true },
      { text: '예약 일정', href: '/app/schedule', hasMinHeight: true },
      { text: '보관함', href: '/app/vault', hasMinHeight: true },
    ])

    // 이전의 설명 문구들이 노출되지 않는지 확인
    expect(screen.queryByText('댓글·DM 문의 답하기')).toBeNull()
    expect(screen.queryByText('내 결정이 필요해요')).toBeNull()
    expect(screen.queryByText('성과 리포트')).toBeNull()
    expect(screen.queryByText('소희 스튜디오')).toBeNull()
  })

  it('모바일 320px 등 협소 폭에서도 라벨이 세로로 쪼개지지 않도록 max-w-full truncate 처리를 갖춘다', () => {
    render(<QuickActions />)
    const nav = screen.getByRole('navigation', { name: '바로가기' })
    const labelSpans = Array.from(nav.querySelectorAll('ul a span.truncate'))
    expect(labelSpans).toHaveLength(4)
    for (const span of labelSpans) {
      expect(span.className).toContain('max-w-full')
      expect(span.className).toContain('truncate')
    }
  })
})
