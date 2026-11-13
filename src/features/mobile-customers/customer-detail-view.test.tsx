// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileCustomerDetailView, customerDetailScreenConfig } from './customer-detail-view'
import type { CustomersViewSnapshot } from './customers-view'
import type { MobileCustomerDto } from './customer-model'
import * as useKakaoHistoryModule from '@/features/kakao/history/use-kakao-history'

vi.mock('@/features/kakao/history/use-kakao-history', () => ({
  useKakaoHistory: vi.fn().mockReturnValue({
    items: [],
    load: 'ready',
    refresh: vi.fn(),
  }),
}))

const WORKSPACE = 'ws-1'

function makeCustomer(overrides: Partial<MobileCustomerDto> = {}): MobileCustomerDto {
  return {
    id: 'c1',
    workspaceId: WORKSPACE,
    displayName: '김민지',
    segment: 'upcoming',
    consent: { status: 'granted', checkedAt: '2026-10-20T03:00:00Z', source: 'reservation_form' },
    verifiedContacts: ['phone'],
    lastAction: { label: '예약 확정', at: '2026-10-21T05:00:00Z' },
    sourceLabel: '예약 문의',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<CustomersViewSnapshot> = {}): CustomersViewSnapshot {
  return {
    loadState: 'ready',
    customers: [makeCustomer()],
    workspaceId: WORKSPACE,
    complete: true,
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

function renderDetail(snapshot: CustomersViewSnapshot, customerId = 'c1') {
  return render(<MobileCustomerDetailView snapshot={snapshot} customerId={customerId} />)
}

describe('M17b 고객 상세', () => {
  it('요청한 고객 한 사람만 그린다', () => {
    const { container } = renderDetail(makeSnapshot({
      customers: [makeCustomer(), makeCustomer({ id: 'c2', displayName: '박서연' })],
    }), 'c2')
    expect(container.textContent).toContain('박서연')
    expect(container.textContent).not.toContain('김민지')
  })

  it('수신 동의·최근 진행·기록 출처를 사람이 읽는 문구로 보여준다', () => {
    renderDetail(makeSnapshot())
    expect(screen.getByRole('heading', { name: '김민지' })).toBeTruthy()
    expect(screen.getByText('수신 동의 확인됨')).toBeTruthy()
    expect(screen.getByText('2026-10-20 확인')).toBeTruthy()
    expect(screen.getByText('예약 확정')).toBeTruthy()
    expect(screen.getByText('기록 출처: 예약 문의')).toBeTruthy()
    expect(screen.getByText('확인된 연락처: 전화')).toBeTruthy()
  })

  it('동의를 철회한 고객은 이름을 마스킹하고 연락 버튼을 모두 막는다', () => {
    const { container } = renderDetail(makeSnapshot({
      customers: [makeCustomer({
        consent: { status: 'withdrawn', checkedAt: '2026-10-21T01:00:00Z', source: 'customer_request' },
      })],
    }))
    expect(container.textContent).not.toContain('김민지')
    expect(screen.getByText('김○지')).toBeTruthy()
    expect((screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '문자로 연락' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('조회 실패면 "없는 고객"이 아니라 실패를 알리고 이름을 그리지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({ loadState: 'error', customers: [] }))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.textContent).not.toContain('김민지')
    expect(container.textContent).not.toContain('고객을 찾지 못했어요')
  })

  it('날짜 값이 깨져 있으면 그 문자열을 그대로 내보내지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({
      customers: [makeCustomer({
        consent: { status: 'granted', checkedAt: 'not-a-date', source: null },
        lastAction: { label: '예약 확정', at: 'abc-def-ghi' },
      })],
    }))

    expect(container.textContent).not.toContain('not-a-date')
    expect(container.textContent).not.toContain('abc-def-gh')
    expect(container.textContent).toContain('확인한 날짜를 알 수 없어요')
    expect(container.textContent).toContain('날짜를 확인하지 못했어요')
  })

  it('네트워크가 끊긴 상태에서는 고객 부재를 단정하지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({ loadState: 'error', customers: [], offline: true }))
    expect(screen.getByText('네트워크에 연결할 수 없습니다')).toBeTruthy()
    expect(container.textContent).not.toContain('고객을 찾지 못했어요')
    expect(container.textContent).not.toContain('불러오지 못했어요')
  })

  it('불러오는 중에는 스켈레톤만 그리고 이름을 그리지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({ loadState: 'loading' }))
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain('김민지')
  })

  it('목록을 끝까지 확인했는데 없으면 찾지 못했다고 말한다', () => {
    renderDetail(makeSnapshot({ customers: [], complete: true }))
    expect(screen.getByText('고객을 찾지 못했어요')).toBeTruthy()
    expect(screen.getByText('이미 정리됐거나 지금은 볼 수 없는 고객이에요.')).toBeTruthy()
    expect(screen.getByRole('link', { name: '목록으로 돌아가기' })).toHaveAttribute('href', '/app/customers')
  })

  it('일부만 확인했는데 없으면 없다고 단정하지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({ customers: [], complete: false }))
    // 불완전한 근거에서 부재를 단정하지 않는다 — 제목도 '일부만 불러왔어요'로 남긴다.
    expect(screen.getByText('일부만 불러왔어요')).toBeTruthy()
    expect(screen.getByText(/모두 확인하지 못했어요/)).toBeTruthy()
    expect(container.textContent).not.toContain('고객을 찾지 못했어요')
    expect(container.textContent).not.toContain('이미 정리됐거나')
  })

  it('readOnlyContacts 를 켜면 전송 경로가 없을 때 연락 버튼을 막고 읽기 전용 사유를 보여준다', () => {
    render(
      <MobileCustomerDetailView snapshot={makeSnapshot()} customerId="c1" readOnlyContacts />,
    )
    const phone = screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement
    expect(phone.disabled).toBe(true)
    expect(screen.getByText('읽기 전용 화면이라 연락을 보낼 수 없어요')).toBeTruthy()
  })

  it('기본값은 origin/main 과 같다 — 서버 근거만으로 활성 여부를 정한다', () => {
    renderDetail(makeSnapshot())
    const phone = screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement
    expect(phone.disabled).toBe(false)
    expect(phone.className).toBe(
      'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium bg-primary text-primary-foreground',
    )
    expect(screen.queryByText('읽기 전용 화면이라 연락을 보낼 수 없어요')).toBeNull()
  })

  it('다른 워크스페이스 고객은 id 가 같아도 그리지 않는다', () => {
    const { container } = renderDetail(makeSnapshot({
      customers: [makeCustomer({ workspaceId: 'ws-2', displayName: '박서연' })],
    }))
    expect(container.textContent).not.toContain('박서연')
    expect(screen.getByText('고객을 찾지 못했어요')).toBeTruthy()
  })

  it('내부 상태 코드를 사장님 화면에 노출하지 않는다', () => {
    const { container } = renderDetail(makeSnapshot())
    for (const code of ['granted', 'withdrawn', 'upcoming', 'phone', 'message', 'reservation_form']) {
      expect(container.textContent).not.toContain(code)
    }
  })

  it('고객 상세는 DETAIL 모드 단일 화면이고 뒤로가기는 고객 목록이다', () => {
    expect(customerDetailScreenConfig()).toEqual({ mode: 'DETAIL', title: '고객 상세', backHref: '/app/customers' })
  })

})
