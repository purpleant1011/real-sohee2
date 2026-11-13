import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FirstWowFlow } from '../first-wow-flow'

/**
 * ANI-1737 터치 타깃(≥44px) — first-wow-flow Step 3·4.
 * 모바일 게이트(tests/e2e/mobile-r2/support/gates.ts)는 요소의 실제 사각형을 재지만
 * jsdom 에서는 크기가 0 이므로, 여기서는 호출부에 44px 하한(min-h-11)이 붙었는지 고정한다.
 */
describe('first-wow-flow Step 3·4 터치 타깃', () => {
  it('Step 3 의 토글·채널 입력·연동 버튼·CTA 는 44px 하한을 갖는다', () => {
    render(<FirstWowFlow initialStep={3} />)

    expect(screen.getByRole('button', { name: /03단계 채널 URL/ }).className).toContain('min-h-11')

    for (const placeholder of [/instagram/i, /threads/i, /blog\.naver/i, /town\.daangn/i]) {
      expect(screen.getByPlaceholderText(placeholder).className).toContain('min-h-11')
    }

    for (const name of [/공식 연동/, /연동하기/]) {
      const buttons = screen.getAllByRole('button', { name })
      expect(buttons.length).toBe(2)
      for (const button of buttons) expect(button.className).toContain('min-h-11')
    }

    expect(screen.getByRole('button', { name: /다음: 자율 운영 규정/ }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: '이전' }).className).toContain('min-h-11')
  })

  it('Step 4 의 토글·이전·CTA 는 44px 하한을 갖는다', () => {
    render(<FirstWowFlow initialStep={4} />)

    expect(screen.getByRole('button', { name: /04단계 매출 목표 가이드/ }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: '이전' }).className).toContain('min-h-11')
    expect(screen.getByRole('button', { name: /다음: 첫 AI 실발행 체험하기/ }).className).toContain('min-h-11')
  })
})
