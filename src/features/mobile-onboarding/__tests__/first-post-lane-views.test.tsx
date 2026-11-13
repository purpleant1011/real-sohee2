import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PhotoRightsStepView, ShopInfoStepView } from '../first-post-lane-views'

/** W11 접근성 지적: 손가락 터치 영역은 최소 44px이어야 한다. */
describe('first-post-lane-views 터치 타깃', () => {
  it('뒤로 버튼은 44px 터치 영역을 갖는다', () => {
    render(<ShopInfoStepView />)
    const back = screen.getByRole('button', { name: '‹ 뒤로' })
    expect(back.className).toContain('min-h-11')
    expect(back.className).toContain('min-w-11')
  })

  it('가게 정보 입력칸은 공용 Input 기본 h-9를 덮어써 44px 높이를 갖는다', () => {
    render(<ShopInfoStepView />)
    for (const label of ['가게 이름', '업종']) {
      expect(screen.getByLabelText(label).className).toContain('min-h-11')
    }
  })

  it('스위치는 루트 버튼이 44×44이고 알약은 안쪽 트랙이 담당한다', () => {
    render(<PhotoRightsStepView />)
    const toggle = screen.getByRole('switch', { name: '사진에 다른 사람이 나오나요' })
    // 게이트(tests/e2e/mobile-r2/support/gates.ts)는 role=switch 루트의 getBoundingClientRect 를
    // 잰다. ::before 의사요소는 그 사각형을 넓히지 않으므로, 실제 상자를 44×44로 만든다.
    expect(toggle.className).toContain('size-11')
    const track = toggle.querySelector('[data-slot="switch-track"]')
    expect(track).not.toBeNull()
    expect(track!.className).toContain('h-5')
    expect(track!.className).toContain('w-9')
  })
})
