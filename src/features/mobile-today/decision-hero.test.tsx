import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DecisionHero } from './decision-hero'
import { consumeDecisionReturn, takeDecisionRestore } from '../mobile-decision/decision-return'
import type { DecisionPage, MobileDecision, MobileHomeDto, Remote } from '../mobile-decision/contracts'

const rem = <T,>(state: Remote<T>['state'], data: T | null): Remote<T> => ({
  state,
  data,
  observedAt: '2026-11-06T09:00:00Z',
  validUntil: null,
})

const createView = (decisions: Remote<DecisionPage>): Pick<MobileHomeDto, 'decisions' | 'workspaceId'> => ({
  workspaceId: 'decision-hero-workspace',
  decisions,
})

describe('DecisionHero', () => {
  it('결정 클릭 시 오늘 경로·스크롤을 기억하고 복원할 링크 ID를 제공한다', () => {
    const view = createView(rem('ready', {
      items: [{ id: 'return-item', kind: 'dm_reply', title: '복원할 결정', targetLabel: '메시지', createdAt: '2026-11-06T08:00:00Z', expiresAt: null }],
      total: 1,
      complete: true,
    }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)
    const link = screen.getByRole('link', { name: /복원할 결정/ })
    // Let React record the click, then cancel the browser's default navigation.
    const originalHref = location.pathname + location.search
    const href = '/app?filter=waiting'
    history.replaceState(null, '', href)
    window.addEventListener('click', event => event.preventDefault(), { once: true })
    fireEvent.click(link)
    history.replaceState(null, '', originalHref)
    expect(consumeDecisionReturn(view.workspaceId, 'return-item')).toBe(href)
    expect(takeDecisionRestore(view.workspaceId, href)).toMatchObject({ itemId: 'return-item', scrollY: window.scrollY })
    expect(link).toHaveAttribute('id', 'mobile-decision-return-item')
  })

  it('확인 완료·0건일 때 "지금 확인하실 일은 없어요" 문구를 노출한다', () => {
    const view = createView(rem('ready', { items: [], total: 0, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    expect(screen.getByText('지금 확인할 일')).toBeInTheDocument()
    expect(screen.getByText('지금 확인하실 일은 없어요')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    const allLink = screen.getByRole('link', { name: /모두 확인/ })
    expect(allLink).toHaveAttribute('href', '/app/approvals')
    expect(allLink).toHaveClass('min-h-11')
  })

  it('대기 항목이 있을 때 종류 Badge, 제목, 대상 라벨, 링크를 표시하고 total Badge를 노출한다', () => {
    const items: MobileDecision[] = [
      { id: 'item-1', kind: 'dm_reply', title: '인스타 DM 답변 승인', targetLabel: '인스타그램', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
      { id: 'item-2', kind: 'comment_reply', title: '네이버 예약 댓글 확인', targetLabel: '네이버 플레이스', createdAt: '2026-11-06T08:10:00Z', expiresAt: null },
      { id: 'item-3', kind: 'post_publish', title: '신메뉴 홍보 글 발행', targetLabel: '인스타 피드', createdAt: '2026-11-06T08:20:00Z', expiresAt: null },
      { id: 'item-4', kind: 'proposal', title: '소희 제안: 리뷰 이벤트', targetLabel: '소희 제안', createdAt: '2026-11-06T08:30:00Z', expiresAt: null },
    ]
    const view = createView(rem('ready', { items, total: 4, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    // total 배지 노출
    expect(screen.getByText('4')).toBeInTheDocument()

    // 최대 3개 항목만 노출 확인
    expect(screen.getByText('인스타 DM 답변 승인')).toBeInTheDocument()
    expect(screen.getByText('메시지')).toBeInTheDocument()
    expect(screen.getByText('인스타그램')).toBeInTheDocument()

    expect(screen.getByText('네이버 예약 댓글 확인')).toBeInTheDocument()
    expect(screen.getByText('댓글')).toBeInTheDocument()

    expect(screen.getByText('신메뉴 홍보 글 발행')).toBeInTheDocument()
    expect(screen.getByText('콘텐츠')).toBeInTheDocument()

    // 4번째 항목은 최대 3개 제한으로 미노출
    expect(screen.queryByText('소희 제안: 리뷰 이벤트')).not.toBeInTheDocument()

    // 개별 링크 확인
    const link1 = screen.getByRole('link', { name: /인스타 DM 답변 승인/ })
    expect(link1).toHaveAttribute('href', '/app/approvals?item=item-1')

    // 모두 확인 링크
    const allLink = screen.getByRole('link', { name: /모두 확인/ })
    expect(allLink).toHaveAttribute('href', '/app/approvals')
    expect(allLink).toHaveClass('min-h-11')
  })

  it('total이 null이거나 숫자가 아닐 때는 total Badge를 노출하지 않는다', () => {
    const view = createView(rem('ready', { items: [], total: null, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    expect(screen.getByText('지금 확인할 일')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('확인 중(loading) 상태: "다음 할 일을 확인하고 있어요"를 노출한다', () => {
    const view = createView(rem<DecisionPage>('loading', null))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    expect(screen.getByText('다음 할 일을 확인하고 있어요')).toBeInTheDocument()
  })

  it('조회 실패(error) 상태: "다음 할 일을 확인하지 못했어요", 안내 문구, 다시 확인 버튼을 제공하고 클릭 시 onRefresh를 호출한다', () => {
    const onRefresh = vi.fn()
    const view = createView(rem<DecisionPage>('error', null))
    render(<DecisionHero view={view} onRefresh={onRefresh} />)

    expect(screen.getByText('다음 할 일을 확인하지 못했어요')).toBeInTheDocument()
    // 실패 != 할 일 없음 구분 문구
    expect(screen.getByText(/할 일이 없는 것은 아니/)).toBeInTheDocument()

    const retryBtn = screen.getByRole('button', { name: /다시 확인/ })
    expect(retryBtn).toHaveClass('min-h-11')
    fireEvent.click(retryBtn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('일부만 읽음(complete=false) 상태: "확인된 항목만 보여드려요" 문구를 노출한다', () => {
    const items: MobileDecision[] = [
      { id: 'item-1', kind: 'proposal', title: '소희 제안: 리뷰 이벤트', targetLabel: '마케팅 제안', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
    ]
    const view = createView(rem('ready', { items, total: 1, complete: false }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    expect(screen.getByText('소희 제안')).toBeInTheDocument()
    expect(screen.getByText('마케팅 제안')).toBeInTheDocument()
    expect(screen.getByText('확인된 항목만 보여드려요')).toBeInTheDocument()
  })

  it('stale 상태: "마지막 확인 이후 바뀌었을 수 있어요" 문구를 노출한다', () => {
    const items: MobileDecision[] = [
      { id: 'item-1', kind: 'dm_reply', title: '인스타 DM 답변 승인', targetLabel: '인스타그램', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
    ]
    const view = createView(rem('stale', { items, total: 1, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    expect(screen.getByText('마지막 확인 이후 바뀌었을 수 있어요')).toBeInTheDocument()
    expect(screen.queryByText('1')).toBeNull()
    expect(screen.getByText('인스타 DM 답변 승인')).toBeInTheDocument()
  })

  it('stale 빈 목록의 이전 0건을 최신 확정 건수로 표시하지 않는다', () => {
    render(<DecisionHero view={createView(rem('stale', { items: [], total: 0, complete: true }))} onRefresh={vi.fn()} />)
    expect(screen.getByText('마지막 확인 이후 바뀌었을 수 있어요')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.queryByText('지금 확인하실 일은 없어요')).toBeNull()
  })

  it.each(['loading', 'error', 'unknown'] as const)('%s의 캐시 건수를 최신 확정 배지로 표시하지 않는다', state => {
    const items: MobileDecision[] = [
      { id: 'cached-item', kind: 'dm_reply', title: '이전에 확인한 답변', targetLabel: '예시 채널', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
    ]
    render(<DecisionHero view={createView(rem(state, { items, total: 7, complete: true }))} onRefresh={vi.fn()} />)
    expect(screen.queryByText('7')).toBeNull()
    if (state === 'error') {
      expect(screen.getByText('다음 할 일을 확인하지 못했어요')).toBeInTheDocument()
      expect(screen.getByText('이전에 확인한 답변')).toBeInTheDocument()
    }
  })

  it('결함 1 검증: complete=false이면 total이 숫자여도 배지를 노출하지 않는다', () => {
    const view = createView(rem('ready', { items: [], total: 0, complete: false }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('결함 2 검증: unknown 또는 stale+빈목록에서는 partial 전용 문구 "확인된 항목만 보여드려요"가 노출되지 않는다', () => {
    // unknown 상태
    const { unmount } = render(<DecisionHero view={createView(rem<DecisionPage>('unknown', null))} onRefresh={vi.fn()} />)
    expect(screen.queryByText('확인된 항목만 보여드려요')).not.toBeInTheDocument()
    unmount()

    // stale + 빈목록 상태
    render(<DecisionHero view={createView(rem('stale', { items: [], total: 0, complete: true }))} onRefresh={vi.fn()} />)
    expect(screen.queryByText('확인된 항목만 보여드려요')).not.toBeInTheDocument()
  })

  it('결함 2 검증: ready && complete=false이고 total 미확정인 빈 목록일 때 partial 문구가 노출된다', () => {
    const view = createView(rem('ready', { items: [], total: null, complete: false }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)
    expect(screen.getByText('확인된 항목만 보여드려요')).toBeInTheDocument()
  })

  it('결함 2 검증: ready && complete=false이면 items가 빈 목록이고 total=0이어도 "확인된 항목만 보여드려요" 단독 안내가 노출된다', () => {
    const view = createView(rem('ready', { items: [], total: 0, complete: false }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)
    expect(screen.getByText('확인된 항목만 보여드려요')).toBeInTheDocument()
  })

  it('unknown 상태 검증: state unknown일 때 "다음 할 일 연결을 확인하고 있어요" 안내가 role="status"로 노출된다', () => {
    render(<DecisionHero view={createView(rem<DecisionPage>('unknown', null))} onRefresh={vi.fn()} />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('다음 할 일 연결을 확인하고 있어요')
    expect(status).toHaveTextContent('확인되지 않은 항목은 완료로 표시하지 않아요.')
  })

  it('결함 3 검증: state unknown일 때 "모두 확인" 링크가 노출되지 않고, ready/stale일 때만 노출된다', () => {
    const { unmount } = render(<DecisionHero view={createView(rem<DecisionPage>('unknown', null))} onRefresh={vi.fn()} />)
    expect(screen.queryByRole('link', { name: /모두 확인/ })).not.toBeInTheDocument()
    unmount()

    const { unmount: unmountStale } = render(<DecisionHero view={createView(rem('stale', { items: [], total: 0, complete: true }))} onRefresh={vi.fn()} />)
    expect(screen.getByRole('link', { name: /모두 확인/ })).toBeInTheDocument()
    unmountStale()

    render(<DecisionHero view={createView(rem('ready', { items: [], total: 0, complete: true }))} onRefresh={vi.fn()} />)
    expect(screen.getByRole('link', { name: /모두 확인/ })).toBeInTheDocument()
  })

  it('접근성 검증: "지금 확인할 일" 제목이 heading(role="heading", level 3)으로 인식된다', () => {
    const view = createView(rem('ready', { items: [], total: 0, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)
    const heading = screen.getByRole('heading', { name: '지금 확인할 일' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveAttribute('aria-level', '3')
  })

  it('동일한 종류의 결정(예: 고객 댓글 2건)은 한 줄로 묶고 출처 "sohee.ai"를 "인스타그램"으로 매핑한다', () => {
    const items: MobileDecision[] = [
      { id: 'comment-1', kind: 'comment_reply', title: '고객 댓글 확인', targetLabel: 'sohee.ai', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
      { id: 'comment-2', kind: 'comment_reply', title: '고객 댓글 확인', targetLabel: 'sohee.ai', createdAt: '2026-11-06T08:10:00Z', expiresAt: null },
    ]
    const view = createView(rem('ready', { items, total: 2, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    // "고객 댓글 2건"으로 한 줄로 묶임
    expect(screen.getByText('고객 댓글 2건')).toBeInTheDocument()
    // 2개의 개별 "고객 댓글 확인" 카드로 중복 노출되지 않음
    expect(screen.queryByText('고객 댓글 확인')).not.toBeInTheDocument()
    // "sohee.ai" 출처가 "인스타그램"으로 한국어 매핑됨
    expect(screen.getByText('인스타그램')).toBeInTheDocument()
    expect(screen.queryByText('sohee.ai')).not.toBeInTheDocument()
  })

  it('배지와 제목 컨테이너에 shrink-0 whitespace-nowrap 및 break-keep 처리가 적용된다', () => {
    const items: MobileDecision[] = [
      { id: 'item-1', kind: 'dm_reply', title: '인스타 DM 답변 승인', targetLabel: '인스타그램', createdAt: '2026-11-06T08:00:00Z', expiresAt: null },
    ]
    const view = createView(rem('ready', { items, total: 1, complete: true }))
    render(<DecisionHero view={view} onRefresh={vi.fn()} />)

    const totalBadge = screen.getByText('1')
    expect(totalBadge.className).toContain('shrink-0')
    expect(totalBadge.className).toContain('whitespace-nowrap')

    const kindBadge = screen.getByText('메시지')
    expect(kindBadge.className).toContain('shrink-0')
    expect(kindBadge.className).toContain('whitespace-nowrap')
  })
})
