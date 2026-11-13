import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FirstActionCard } from './first-action-card'
import type { DecisionPage, MobileHomeDto, Remote } from '../mobile-decision/contracts'

const rem = <T,>(state: Remote<T>['state'], data: T | null): Remote<T> => ({
  state,
  data,
  observedAt: '2026-10-22T07:40:00Z',
  validUntil: null,
})

const createView = (decisions: Remote<DecisionPage>): Pick<MobileHomeDto, 'decisions'> => ({
  decisions,
})

describe('FirstActionCard', () => {
  it('review 상태: 지금 확인할 일 라벨, 제목, 대상 라벨, 검토하기 CTA를 표시한다', () => {
    const view = createView(
      rem('ready', {
        items: [{ id: 'd1', kind: 'dm_reply', title: '인스타 DM 답변 검토', targetLabel: '인스타그램', createdAt: '2026-10-22T01:00:00Z', expiresAt: null }],
        total: 1,
        complete: true,
      })
    )
    render(<FirstActionCard view={view} onRefresh={vi.fn()} onDelegate={vi.fn()} />)
    expect(screen.getByText('지금 확인할 일')).toBeInTheDocument()
    expect(screen.getByText('인스타 DM 답변 검토')).toBeInTheDocument()
    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /검토하기/ })
    expect(link).toHaveAttribute('href', '/app/approvals?item=d1')
  })

  it('checking 상태: "확인이 끝날 때까지 완료로 표시하지 않아요" 문구를 노출한다', () => {
    const view = createView(rem<DecisionPage>('loading', null))
    render(<FirstActionCard view={view} onRefresh={vi.fn()} onDelegate={vi.fn()} />)
    expect(screen.getByText('다음 할 일을 확인하고 있어요')).toBeInTheDocument()
    expect(screen.getByText('확인이 끝날 때까지 완료로 표시하지 않아요.')).toBeInTheDocument()
  })

  it('retry 상태: "다음 할 일을 확인하지 못했어요"를 노출하고 재시도 버튼을 제공한다', () => {
    const view = createView(rem<DecisionPage>('error', null))
    const onRefresh = vi.fn()
    render(<FirstActionCard view={view} onRefresh={onRefresh} onDelegate={vi.fn()} />)
    expect(screen.getByText('다음 할 일을 확인하지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /다시 확인하기/ })).toBeInTheDocument()
  })

  it('delegate 상태: 확인한 일이 없을 때 소희에게 일 맡기기 CTA를 제공한다', () => {
    const view = createView(rem('ready', { items: [], total: 0, complete: true }))
    render(<FirstActionCard view={view} onRefresh={vi.fn()} onDelegate={vi.fn()} />)
    expect(screen.getByText('지금 확인하실 일은 없어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /소희에게 일 맡기기/ })).toBeInTheDocument()
  })

  it('확인 필요 배지에 shrink-0 whitespace-nowrap 및 제목에 break-keep이 적용된다', () => {
    const view = createView(
      rem('ready', {
        items: [{ id: 'd1', kind: 'dm_reply', title: '인스타 DM 답변 검토', targetLabel: '인스타그램', createdAt: '2026-10-22T01:00:00Z', expiresAt: null }],
        total: 1,
        complete: true,
      })
    )
    render(<FirstActionCard view={view} onRefresh={vi.fn()} onDelegate={vi.fn()} />)
    const badge = screen.getByText('확인 필요')
    expect(badge.className).toContain('shrink-0')
    expect(badge.className).toContain('whitespace-nowrap')
    const heading = screen.getByRole('heading', { level: 2, name: '인스타 DM 답변 검토' })
    expect(heading.className).toContain('break-keep')
  })
})
