// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DecisionCard, FreshnessLabel, StateView, StatusPill, formatCheckedAt, formatCheckedMoment } from './index'

describe('StateView', () => {
  it('error 는 children 을 렌더하지 않고(빈 목록 위장 금지) alert 로 알린다', () => {
    render(<StateView kind="error"><p>0건</p></StateView>)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByText('0건')).toBeNull()
  })
  it('confirmed_empty 와 error 는 서로 다른 문구', () => {
    const a = render(<StateView kind="confirmed_empty" />)
    const empty = a.container.textContent
    a.unmount()
    const b = render(<StateView kind="error" />)
    expect(b.container.textContent).not.toBe(empty)
  })
  it('stale 은 children 과 확인 시각을 함께 보여준다', () => {
    render(<StateView kind="stale" checkedAt="2026-10-22T07:40:00Z"><p>지난 내용</p></StateView>)
    expect(screen.getByText('지난 내용')).toBeTruthy()
    expect(screen.getByText(/확인/, { selector: 'time' })).toBeTruthy()
  })
  it('loading 은 busy status, ready 는 children 만', () => {
    const l = render(<StateView kind="loading" />)
    expect(l.container.querySelector('[aria-busy="true"]')).toBeTruthy()
    l.unmount()
    render(<StateView kind="ready"><p>ok</p></StateView>)
    expect(screen.getByText('ok')).toBeTruthy()
  })
  it('offline 은 지정된 정직한 문구', () => {
    render(<StateView kind="offline" />)
    expect(screen.getByText('마지막 확인 내용은 서버에서 다시 확인해야 합니다.')).toBeTruthy()
  })
})

describe('formatCheckedAt', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  it('오늘/어제/그 외, 없으면 null', () => {
    expect(formatCheckedAt('2026-10-22T07:40:00Z', now)).toBe('16:40 확인')
    expect(formatCheckedAt('2026-10-21T07:40:00Z', now)).toBe('어제 16:40 확인')
    expect(formatCheckedAt('2026-10-01T07:40:00Z', now)).toContain('10월 1일')
    expect(formatCheckedAt(null, now)).toBeNull()
    expect(formatCheckedAt('nope', now)).toBeNull()
  })
})

describe('formatCheckedMoment', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  it('시점만 돌려준다 — prefix 와 붙일 때 "확인" 이 겹치지 않는다', () => {
    expect(formatCheckedMoment('2026-10-22T07:40:00Z', now)).toBe('16:40')
    expect(formatCheckedMoment('2026-10-21T07:40:00Z', now)).toBe('어제 16:40')
    expect(formatCheckedMoment(null, now)).toBeNull()
  })
  it('FreshnessLabel 은 prefix 가 있으면 "확인" 을 한 번만 쓴다', () => {
    render(<FreshnessLabel checkedAt="2026-10-22T07:40:00Z" prefix="서버 확인" />)
    const text = screen.getByText(/서버 확인/).textContent ?? ''
    expect(text.startsWith('서버 확인 · ')).toBe(true)
    expect(text.match(/확인/g)).toHaveLength(1)
  })
})

describe('StatusPill', () => {
  it('색 외에 글자로 상태를 표시', () => {
    render(<StatusPill kind="verified" />)
    expect(screen.getByText('확인됨')).toBeTruthy()
  })
})

describe('DecisionCard', () => {
  it('분류·대상·제목을 담은 읽기 전용 링크로 렌더한다', () => {
    render(<DecisionCard id="mobile-decision-1" href="/app/approvals?item=1" kindLabel="메시지" targetLabel="테스트 고객" title="예약 문의를 확인해 주세요" />)
    const link = screen.getByRole('link', { name: /예약 문의를 확인해 주세요/ })
    expect(link).toHaveAttribute('href', '/app/approvals?item=1')
    expect(link).toHaveAttribute('id', 'mobile-decision-1')
    expect(screen.getByText('메시지')).toBeTruthy()
    expect(screen.getByText('테스트 고객')).toBeTruthy()
    expect(screen.getByText('검토하기')).toBeTruthy()
  })
  it('클릭 시 이동을 가로채는 훅을 호출한다', () => {
    let clicked = 0
    render(<DecisionCard href="/app/approvals?item=1" kindLabel="댓글" targetLabel="고객" title="확인" onNavigate={event => { clicked += 1; event.preventDefault() }} />)
    fireEvent.click(screen.getByRole('link', { name: /확인/ }))
    expect(clicked).toBe(1)
  })
  it('알 수 없는 분류도 사장님 어휘 그대로 노출한다', () => {
    render(<DecisionCard href="/app/approvals" kindLabel="소희 제안" targetLabel="가게" title="제안 확인" actionLabel="살펴보기" />)
    expect(screen.getByText('소희 제안')).toBeTruthy()
    expect(screen.getByText('살펴보기')).toBeTruthy()
  })
})
