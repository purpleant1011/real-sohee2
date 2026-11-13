// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  CustomerContactCtas,
  MobileCustomersView,
  customersScreenConfig,
  type CustomersViewSnapshot,
} from './customers-view'
import type { MobileCustomerDto } from './customer-model'

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

describe('M17 고객 화면', () => {
  it('조회 실패면 빈 목록이 아니라 실패를 알리고 고객을 그리지 않는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({ loadState: 'error' })} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.textContent).not.toContain('김민지')
    expect(container.textContent).not.toContain('예약 확정')
  })

  it('화면의 다시 확인하기를 누르면 예약 고객 조회도 refresh 된다', () => {
    const onRetry = vi.fn()
    const canonicalRefresh = vi.fn()
    render(
      <MobileCustomersView
        snapshot={makeSnapshot({ loadState: 'error' })}
        onRetry={onRetry}
        canonicalState={{ load: 'error', items: [], refresh: canonicalRefresh }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(canonicalRefresh).toHaveBeenCalledTimes(1)
  })

  it('날짜 값이 깨져 있으면 그 문자열을 화면에 그대로 내보내지 않는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({
      customers: [makeCustomer({
        consent: { status: 'granted', checkedAt: 'not-a-date', source: null },
        lastAction: { label: '예약 확정', at: 'abc-def-ghi' },
      })],
    })} />)

    expect(container.textContent).not.toContain('not-a-date')
    expect(container.textContent).not.toContain('abc-def-gh')
    // 값이 없으면 시각 표시를 지어내지 않고 생략한다.
    expect(container.textContent).toContain('예약 확정')
  })

  it('날짜가 정상이면 그대로 보여준다(회귀)', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot()} />)
    expect(container.textContent).toContain('2026-10-21')
    expect(container.textContent).toContain('2026-10-20 확인')
  })

  it('네트워크 끊김은 조회 실패도 빈 목록도 아닌 별도 상태로 알린다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({ loadState: 'error', customers: [], offline: true })} />)
    expect(screen.getByText('네트워크에 연결할 수 없습니다')).toBeTruthy()
    expect(container.textContent).not.toContain('불러오지 못했어요')
    expect(container.textContent).not.toContain('등록된 고객이 없어요')
  })

  it('동의를 철회한 고객은 이름을 마스킹하고 연락 버튼을 모두 막는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({
      customers: [makeCustomer({ consent: { status: 'withdrawn', checkedAt: '2026-10-21T01:00:00Z', source: 'customer_request' } })],
    })} />)
    expect(screen.getByText('김○지')).toBeTruthy()
    expect(container.textContent).not.toContain('김민지')
    expect((screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '문자로 연락' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('수신 동의가 철회됐어요')).toHaveLength(2)
  })

  it('readOnlyContacts 를 켜면 전송 경로가 없을 때 버튼을 막고 읽기 전용 사유를 보여준다', () => {
    render(<MobileCustomersView snapshot={makeSnapshot()} readOnlyContacts />)
    expect((screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '문자로 연락' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('읽기 전용 화면이라 연락을 보낼 수 없어요')).toBeTruthy()
    expect(screen.getByText('확인된 연락처가 없어요')).toBeTruthy()
  })

  // 기본값 렌더는 origin/main 과 같아야 한다 — 이 컴포넌트를 이미 쓰는 화면의 동작을 바꾸지 않는다.
  describe('기본값 렌더 = origin/main', () => {
    const ENABLED_CLASS = 'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium bg-primary text-primary-foreground'
    const DISABLED_CLASS = 'inline-flex min-h-11 items-center rounded-xl px-3.5 text-sm font-medium bg-muted text-muted-foreground'

    it('조건을 만족한 CTA 는 핸들러가 없어도 활성·기본 색이며 사유를 덧붙이지 않는다', () => {
      render(<CustomerContactCtas customer={makeCustomer()} />)
      const phone = screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement
      expect(phone.disabled).toBe(false)
      expect(phone.getAttribute('aria-disabled')).toBe('false')
      expect(phone.className).toBe(ENABLED_CLASS)
      // origin/main 은 조건 미충족 사유만 보여줬다. 읽기 전용 사유를 덧붙이지 않는다.
      expect(screen.queryByText('읽기 전용 화면이라 연락을 보낼 수 없어요')).toBeNull()
    })

    it('조건을 못 채운 CTA 는 비활성·회색이고 서버 사유를 그대로 보여준다', () => {
      render(<CustomerContactCtas customer={makeCustomer()} />)
      const message = screen.getByRole('button', { name: '문자로 연락' }) as HTMLButtonElement
      expect(message.disabled).toBe(true)
      expect(message.getAttribute('aria-disabled')).toBe('true')
      expect(message.className).toBe(DISABLED_CLASS)
      expect(screen.getByText('확인된 연락처가 없어요')).toBeTruthy()
    })

    it('목록 화면도 기본값에서는 서버 근거만으로 활성 여부를 정한다', () => {
      render(<MobileCustomersView snapshot={makeSnapshot()} />)
      const phone = screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement
      expect(phone.disabled).toBe(false)
      expect(phone.className).toBe(ENABLED_CLASS)
      expect(screen.queryByText('읽기 전용 화면이라 연락을 보낼 수 없어요')).toBeNull()
    })
  })

  it('전송 핸들러가 있으면 조건을 만족한 채널만 누를 수 있다', () => {
    const onContact = vi.fn()
    render(<CustomerContactCtas customer={makeCustomer()} onContact={onContact} />)
    const phone = screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement
    expect(phone.disabled).toBe(false)
    fireEvent.click(phone)
    expect(onContact).toHaveBeenCalledWith('phone')
  })

  it('동의를 확인하지 못한 고객은 연락 버튼을 막는다', () => {
    render(<MobileCustomersView snapshot={makeSnapshot({
      customers: [makeCustomer({ consent: { status: 'unknown', checkedAt: null, source: null } })],
    })} />)
    expect(screen.getAllByText('수신 동의를 확인하지 못했어요')).toHaveLength(2)
    expect((screen.getByRole('button', { name: '전화로 연락' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('다른 워크스페이스 고객은 목록에 포함하지 않는다', () => {
    const { container } = render(
      <MobileCustomersView
        snapshot={makeSnapshot({
          customers: [makeCustomer({ id: 'c9', workspaceId: 'ws-2', displayName: '박서연' })],
        })}
        canonicalState={{ load: 'ready', items: [], refresh: vi.fn() }}
      />,
    )
    expect(container.textContent).not.toContain('박서연')
    expect(screen.getByText('등록된 고객이 없어요')).toBeTruthy()
  })

  it('전체를 확인한 빈 목록만 "고객 없음"으로 단정한다', () => {
    render(
      <MobileCustomersView
        snapshot={makeSnapshot({ customers: [] })}
        canonicalState={{ load: 'ready', items: [], refresh: vi.fn() }}
      />,
    )
    expect(screen.getByText('등록된 고객이 없어요')).toBeTruthy()
    expect(screen.getByText('문의 주신 손님은 소통함에서 볼 수 있어요')).toBeTruthy()
    const openInbox = screen.getByRole('link', { name: '소통함 열기' })
    expect(openInbox.getAttribute('href')).toBe('/app/engagement')
    expect(screen.getByText('예약이나 문의가 들어오면 자동으로 손님이 등록돼요.')).toBeTruthy()
  })

  describe('정본 예약 고객 결합 TDD', () => {
    const CANONICAL_CUSTOMER = {
      id: 'canon-1',
      displayName: '이예약',
      phoneMasked: '010-****-1234',
      reservationCount: 2,
      lastBookingStartsAt: '2026-11-09T05:00:00Z',
    }

    it('대화 0건 + 예약 고객 1건 → 섹션 보임 · "등록된 고객이 없어요" 안 보임', () => {
      render(
        <MobileCustomersView
          snapshot={makeSnapshot({ customers: [] })}
          canonicalState={{ load: 'ready', items: [CANONICAL_CUSTOMER], refresh: vi.fn() }}
        />,
      )

      expect(screen.getByText('예약 고객')).toBeVisible()
      expect(screen.getByText('이예약')).toBeVisible()
      expect(screen.getByText('010-****-1234')).toBeVisible()
      expect(screen.getByText('예약 2건')).toBeVisible()
      expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
    })

    it('둘 다 0건 → 빈 상태 ("등록된 고객이 없어요" 표시)', () => {
      render(
        <MobileCustomersView
          snapshot={makeSnapshot({ customers: [] })}
          canonicalState={{ load: 'ready', items: [], refresh: vi.fn() }}
        />,
      )

      expect(screen.getByText('등록된 고객이 없어요')).toBeVisible()
      expect(screen.getByText('문의 주신 손님은 소통함에서 볼 수 있어요')).toBeVisible()
      expect(screen.getByRole('link', { name: '소통함 열기' })).toBeVisible()
    })

    it('예약 고객 조회 오류 → 불러오지 못했어요 ("고객 없음"으로 치환 금지)', () => {
      render(
        <MobileCustomersView
          snapshot={makeSnapshot({ customers: [] })}
          canonicalState={{ load: 'error', items: [], refresh: vi.fn() }}
        />,
      )

      expect(screen.getByText('예약 고객을 불러오지 못했어요')).toBeVisible()
      expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible()
      expect(screen.queryByText('등록된 고객이 없어요')).toBeNull()
    })
  })

  it('일부만 불러온 빈 목록은 "고객 없음"으로 단정하지 않는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({ customers: [], complete: false })} />)
    expect(screen.getByText('일부만 불러왔어요')).toBeTruthy()
    expect(container.textContent).not.toContain('등록된 고객이 없어요')
  })

  it('불러오는 중에는 스켈레톤만 그리고 이름을 그리지 않는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot({ loadState: 'loading' })} />)
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain('김민지')
  })

  it('내부 상태 코드를 사장님 화면에 노출하지 않는다', () => {
    const { container } = render(<MobileCustomersView snapshot={makeSnapshot()} />)
    for (const code of ['granted', 'withdrawn', 'upcoming', 'phone', 'message']) {
      expect(container.textContent).not.toContain(code)
    }
  })

  it('고객마다 상세 화면 링크가 있다', () => {
    render(<MobileCustomersView snapshot={makeSnapshot()} />)
    const link = screen.getByRole('link', { name: '자세히 보기' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/app/customers/c1')
  })

  it('고객 화면은 BROWSE 모드 단일 화면 계약을 따른다', () => {
    const config = customersScreenConfig()
    expect(config.mode).toBe('BROWSE')
    expect(config.title).toBe('고객')
  })
})
