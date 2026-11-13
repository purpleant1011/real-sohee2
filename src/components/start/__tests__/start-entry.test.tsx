import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StartEntry } from '../start-entry'

describe('StartEntry', () => {
  it('비로그인 방문자에게 로그인 벽 대신 가입으로 이어지는 진입 화면을 보여준다', () => {
    render(<StartEntry />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('10분 안에 첫 게시물까지')
    expect(screen.getByRole('link', { name: /무료로 시작하기/ })).toHaveAttribute('href', '/signup?next=%2Fstart')
    expect(screen.getByRole('link', { name: /이미 계정이 있어요/ })).toHaveAttribute('href', '/login?next=%2Fstart')
  })

  it('가입 후 진행할 4단계를 순서대로 안내한다', () => {
    render(<StartEntry />)

    const journey = screen.getByRole('list', { name: '가입 후 진행 순서' })
    const steps = Array.from(journey.querySelectorAll('li')).map((li) => li.textContent ?? '')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toContain('계정 만들기')
    expect(steps[1]).toContain('우리 가게 알려주기')
    expect(steps[1]).not.toContain('네이버 지도')
    expect(steps[1]).not.toContain('자동 입력')
    expect(steps[2]).toContain('인스타·스레드 연결')
    expect(steps[3]).toContain('첫 글 확인하고 발행')
  })
})
