import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MasterDetail } from './master-detail'

describe('MasterDetail', () => {
  it('목록과 상세를 한 화면에 나란히 그린다', () => {
    render(
      <MasterDetail
        listLabel="작업 목록"
        detailLabel="작업 상세"
        list={<ul><li>글 1</li></ul>}
        detail={<p>상세 내용</p>}
      />,
    )
    expect(screen.getByRole('region', { name: '작업 목록' })).toHaveTextContent('글 1')
    expect(screen.getByRole('region', { name: '작업 상세' })).toHaveTextContent('상세 내용')
  })

  it('선택된 항목이 없으면 안내 문구를 상세 자리에 보여준다', () => {
    render(
      <MasterDetail
        listLabel="소통함 목록"
        detailLabel="소통함 상세"
        list={<p>목록</p>}
        detail={null}
        emptyDetail="왼쪽에서 하나를 골라 보세요."
      />,
    )
    expect(screen.getByRole('region', { name: '소통함 상세' })).toHaveTextContent('왼쪽에서 하나를 골라 보세요.')
  })

  it('넓은 화면에서만 2단 격자가 되고, 좁으면 한 칸씩 쌓이며 상세가 선택되면 목록은 숨는다', () => {
    const { container } = render(
      <MasterDetail listLabel="목록" detailLabel="상세" list={<p>목록</p>} detail={<p>상세</p>} hasSelection />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/lg:grid/)
    const list = screen.getByRole('region', { name: '목록' })
    expect(list.className).toMatch(/hidden/)
    expect(list.className).toMatch(/lg:block/)
  })

  it('선택이 없으면 좁은 화면에서도 목록이 보이고 상세는 넓은 화면에서만 보인다', () => {
    render(<MasterDetail listLabel="목록" detailLabel="상세" list={<p>목록</p>} detail={null} emptyDetail="고르세요" />)
    expect(screen.getByRole('region', { name: '목록' }).className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByRole('region', { name: '상세' }).className).toMatch(/hidden/)
  })
})
