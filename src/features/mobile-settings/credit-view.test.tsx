// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileCreditView, creditScreenConfig, type CreditViewSnapshot } from './credit-view'
import type { CreditLedger } from './credit-model'

function makeLedger(overrides: Partial<CreditLedger> = {}): CreditLedger {
  return {
    available: 12,
    reserved: 3,
    consumed: 40,
    refunded: 2,
    observedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<CreditViewSnapshot> = {}): CreditViewSnapshot {
  return {
    loadState: 'ready',
    credit: makeLedger(),
    customerDeposit: makeLedger({ available: 50000, reserved: null, consumed: null, refunded: 20000 }),
    estimate: 5,
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

describe('M16 크레딧 화면', () => {
  it('예상 비용을 모르면 실행을 막고 0원으로 단정하지 않는다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({ estimate: null })} />)

    expect(screen.getByText('예상 비용을 아직 확인하지 못했어요')).toBeTruthy()
    expect(screen.getByText('예상 비용을 아직 확인하지 못했어요').textContent).not.toContain('0')
    expect(container.textContent).toContain('다시 확인')
    expect(container.textContent).not.toContain('지금 실행할 수 있어요')
  })

  it('잔액을 확인하지 못하면 금액 대신 사유를 보여준다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({
      credit: makeLedger({ available: null }),
    })} />)

    expect(container.textContent).toContain('잔액을 확인하지 못했어요')
    expect(container.textContent).toContain('확인하지 못했어요')
    expect(container.textContent).not.toContain('지금 실행할 수 있어요')
  })

  it('크레딧이 부족하면 한도 도달 안내를 준다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({
      credit: makeLedger({ available: 2 }),
      estimate: 5,
    })} />)

    expect(container.textContent).toContain('이용 한도에 도달했어요')
    expect(container.textContent).toContain('플랜 변경을 문의해 주세요')
    expect(container.textContent).not.toContain('지금 실행할 수 있어요')
    expect(container.textContent).not.toContain('2 크레딧')
  })

  it('잔액과 예상 비용이 확인되면 실행 가능을 알리고 크레딧 숫자는 숨긴다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot()} />)

    expect(container.textContent).toContain('지금 실행할 수 있어요')
    expect(container.textContent).toContain('정상 이용 중')
    expect(container.textContent).not.toContain('12 크레딧')
    expect(container.textContent).not.toContain('5 크레딧')
  })

  it('구독 원장에서는 수량을 숨기고 고객 예약금은 원화로 보여준다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot()} />)

    expect(container.textContent).toContain('소희 이용 요금')
    expect(container.textContent).toContain('고객 예약금')
    expect(container.textContent).not.toContain('12 크레딧')
    expect(container.textContent).toContain('50,000원')
    // 12 크레딧 + 50,000원을 더한 62 같은 합산값이 어디에도 없어야 한다.
    expect(container.textContent).not.toContain('62')
  })

  it('예약금 원장을 못 받으면 0원이 아니라 확인 실패로 표시한다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({ customerDeposit: null })} />)

    expect(container.textContent).toContain('예약금 현황을 확인하지 못했어요')
    expect(container.textContent).not.toContain('0원')
  })

  it('조회 실패면 금액과 잔액을 그리지 않고 실패를 알린다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({ loadState: 'error' })} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.textContent).toContain('잔액이 없는 것이 아니라, 확인에 실패한 상태예요. 다시 확인해 주세요.')
    expect(container.textContent).not.toContain('12 크레딧')
    expect(container.textContent).not.toContain('50,000원')
    expect(container.textContent).not.toContain('지금 실행할 수 있어요')
  })

  it('로그인이 만료되면(401) 조회 실패도 잔액 0도 아닌 다시 로그인 안내를 준다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({
      loadState: 'error',
      credit: makeLedger({ available: null }),
      customerDeposit: null,
      estimate: null,
      checkedAt: null,
      authFailure: 'expired',
    })} />)

    expect(screen.getByText('로그인이 만료됐어요')).toBeTruthy()
    expect(screen.getByText('다시 로그인하면 이어서 볼 수 있어요.')).toBeTruthy()
    // 일시적 조회 실패 문구로 뭉개지 않는다.
    expect(container.textContent).not.toContain('잔액이 없는 것이 아니라, 확인에 실패한 상태예요.')
    expect(container.textContent).not.toContain('이 내용을 볼 권한이 없어요')
    expect(container.textContent).not.toContain('12 크레딧')
  })

  it('권한이 없으면(403) 권한 요청 안내를 준다 — 만료와 구분한다', () => {
    const { container } = render(<MobileCreditView snapshot={makeSnapshot({
      loadState: 'error',
      credit: makeLedger({ available: null }),
      customerDeposit: null,
      estimate: null,
      checkedAt: null,
      authFailure: 'forbidden',
    })} />)

    expect(screen.getByText('이 내용을 볼 권한이 없어요')).toBeTruthy()
    expect(screen.getByText('가게 관리자에게 권한을 요청해 주세요.')).toBeTruthy()
    expect(container.textContent).not.toContain('로그인이 만료됐어요')
    expect(container.textContent).not.toContain('잔액이 없는 것이 아니라, 확인에 실패한 상태예요.')
  })

  it('OH: 화면 설정은 BROWSE 모드의 이용 현황 화면이다', () => {
    expect(creditScreenConfig()).toEqual({ mode: 'BROWSE', title: '이용 현황' })
  })
})
