// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileDepositsView, depositsScreenConfig, type DepositsViewSnapshot } from './deposits-view'
import type { DepositRecord } from './deposit-model'

const WORKSPACE = 'w1'

const base = (o: Partial<DepositRecord> = {}): DepositRecord => ({
  workspaceId: WORKSPACE,
  bookingId: 'b1',
  provider: 'portone',
  availability: 'supported',
  amount: 30000,
  currency: 'KRW',
  termsAcceptedAt: '2026-10-22T00:00:00Z',
  transport: 'not_started',
  providerAccepted: null,
  readback: 'pending',
  readbackAt: null,
  receiptRef: null,
  refund: null,
  idempotencyKey: 'deposit-b1-1',
  seenCallbacks: [],
  ...o,
})

function makeSnapshot(overrides: Partial<DepositsViewSnapshot> = {}): DepositsViewSnapshot {
  return {
    loadState: 'ready',
    deposits: [base()],
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

const chargeButton = () => screen.getByRole('button', { name: '예약금 결제하기' }) as HTMLButtonElement

describe('M16 예약금 화면', () => {
  it('결제사 승인만 받고 서버 확인 전이면 완료로 표시하지 않고 버튼을 막는다', () => {
    const onCharge = vi.fn()
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'pending' })] })}
        onCharge={onCharge}
      />,
    )
    expect(screen.getByText('결제 확인 중')).toBeTruthy()
    expect(container.textContent).not.toContain('예약금 확인 완료')
    expect(container.textContent).not.toContain('결제 완료')
    expect(screen.getByText(/결제사 응답은 받았지만 서버 영수증 확인 전이에요/)).toBeTruthy()
    expect(chargeButton().disabled).toBe(true)
    fireEvent.click(chargeButton())
    expect(onCharge).not.toHaveBeenCalled()
  })

  it('서버 영수증까지 확인된 건만 결제 확인 완료로 표시하고 다시 결제시키지 않는다', () => {
    render(
      <MobileDepositsView
        snapshot={makeSnapshot({
          deposits: [base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'verified', readbackAt: '2026-10-22T01:00:00Z', receiptRef: 'r1' })],
        })}
        onCharge={vi.fn()}
      />,
    )
    expect(screen.getByText('예약금 확인 완료')).toBeTruthy()
    expect(screen.getByText('이미 예약금이 확인된 예약이에요')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '예약금 결제하기' })).toBeNull()
  })

  it('영수증 확인에 실패한 건은 재결제가 아니라 다시 확인으로 안내한다', () => {
    render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ transport: 'returned_success', readback: 'not_verified', readbackAt: '2026-10-22T01:00:00Z' })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(screen.getByText('결제가 확인되지 않았어요')).toBeTruthy()
    expect(chargeButton().disabled).toBe(true)
    // 재결제가 아니라 서버 영수증 재확인으로 안내한다.
    expect(screen.getByText('영수증 다시 확인')).toBeTruthy()
    expect(screen.queryByText(/다시 결제하기/)).toBeNull()
  })

  it('영수증 확인이 불가하면 0원·완료가 아니라 확인 불가로 남긴다', () => {
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'unavailable' })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(screen.getByText('결제 결과를 확인하지 못했어요')).toBeTruthy()
    expect(container.textContent).not.toContain('예약금 확인 완료')
    // 금액 자체를 0원으로 그리지 않는다. '30,000원' 같은 정상 금액의 부분 문자열과 구분한다.
    expect(container.textContent).not.toMatch(/(^|[^0-9,])0원/)
    expect(chargeButton().disabled).toBe(true)
  })

  it('결제 준비가 끝난 건은 결제 버튼을 누르면 해당 예약을 넘긴다', () => {
    const onCharge = vi.fn()
    const record = base()
    render(<MobileDepositsView snapshot={makeSnapshot({ deposits: [record] })} onCharge={onCharge} />)
    expect(chargeButton().disabled).toBe(false)
    fireEvent.click(chargeButton())
    expect(onCharge).toHaveBeenCalledWith(record)
  })

  it('환불 규정에 동의하지 않았으면 결제 버튼을 막고 사유를 보여준다', () => {
    render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ termsAcceptedAt: null })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(chargeButton().disabled).toBe(true)
    expect(screen.getByText(/환불 규정을 확인해야 결제할 수 있어요/)).toBeTruthy()
  })

  it('금액을 확인하지 못했으면 결제 예정 금액을 사실처럼 그리지 않는다', () => {
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ amount: null })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(container.textContent).not.toContain('결제 예정 금액')
    expect(screen.getByText(/예약금 금액을 확인하지 못했어요/)).toBeTruthy()
    expect(chargeButton().disabled).toBe(true)
  })

  it('확인 전 금액은 매출이 아니라 결제 예정 금액으로 표시한다', () => {
    render(<MobileDepositsView snapshot={makeSnapshot()} onCharge={vi.fn()} />)
    expect(screen.getByText('결제 예정 금액 30,000원')).toBeTruthy()
  })

  it('예약금을 쓰지 않는 매장은 화면 자체를 그리지 않는다', () => {
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ availability: 'not_supported' })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('예약금 설정을 확인하지 못한 매장은 숨기지 않고 확인 불가로 알린다', () => {
    render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ availability: 'unknown' })] })}
        onCharge={vi.fn()}
      />,
    )
    expect(screen.getByText('예약금 여부를 확인하지 못했어요')).toBeTruthy()
    expect(chargeButton().disabled).toBe(true)
  })

  it('조회 실패는 빈 목록이 아니라 실패로 알리고 예약금을 그리지 않는다', () => {
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ loadState: 'error', checkedAt: null })}
        onCharge={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(container.textContent).not.toContain('예약금 결제하기')
  })

  it('불러오는 중에는 스켈레톤만 그리고 예약금 문구를 그리지 않는다', () => {
    const { container } = render(
      <MobileDepositsView snapshot={makeSnapshot({ loadState: 'loading' })} onCharge={vi.fn()} />,
    )
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy()
    expect(container.textContent).not.toContain('예약금 결제하기')
  })

  it('확인해 본 빈 목록은 예약금 내역 없음으로 안내한다', () => {
    render(<MobileDepositsView snapshot={makeSnapshot({ deposits: [] })} onCharge={vi.fn()} />)
    expect(screen.getByText('예약금 내역이 없어요')).toBeTruthy()
  })

  it('내부 상태 코드를 사장님 화면에 노출하지 않는다', () => {
    const { container } = render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ transport: 'returned_success', providerAccepted: 'accepted', readback: 'pending' })] })}
        onCharge={vi.fn()}
      />,
    )
    for (const code of ['returned_success', 'accepted', 'pending', 'portone', 'customer_deposit']) {
      expect(container.textContent).not.toContain(code)
    }
  })

  it('예약금 화면은 BROWSE 모드 단일 화면 계약을 따른다', () => {
    const config = depositsScreenConfig()
    expect(config.mode).toBe('BROWSE')
    expect(config.title).toBe('예약금')
  })

  it('결제사가 연결되지 않았으면 버튼을 막고 사유를 함께 보여준다', () => {
    const onCharge = vi.fn()
    render(
      <MobileDepositsView
        snapshot={makeSnapshot({ deposits: [base({ provider: 'none', termsAcceptedAt: null, readback: 'unavailable', idempotencyKey: null })] })}
        onCharge={onCharge}
      />,
    )
    expect(screen.getByText('예약금 30,000원')).toBeTruthy()
    expect(screen.getByText('예약금 결제는 아직 연결되지 않았어요')).toBeTruthy()
    const button = chargeButton()
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-describedby')).toBeTruthy()
    fireEvent.click(button)
    expect(onCharge).not.toHaveBeenCalled()
  })
})
