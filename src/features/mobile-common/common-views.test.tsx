// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { classifyCommonError } from './error-model'
import { CommonErrorView } from './error-state'
import { consentStatusFor } from './consent-model'
import { ConsentStatusView } from './consent-status'

afterEach(cleanup)

describe('CommonErrorView', () => {
  describe('Given 실서버가 500 과 영문 원문을 돌려줬을 때', () => {
    it('Then alert 로 확인 실패를 알리고 원문은 그리지 않는다', () => {
      const error = classifyCommonError(500, { error: 'Failed to list evidence' })
      render(<CommonErrorView error={error} />)
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('서버에서 확인하지 못했어요')
      expect(alert.textContent).toContain('내용이 없는 것이 아니라')
      expect(alert.textContent).not.toContain('Failed')
    })
  })

  describe('Given 다음 행동을 받을 수 있을 때', () => {
    it('Then 오류에 맞는 버튼 하나를 보여 주고 그 행동을 넘긴다', () => {
      const onAction = vi.fn()
      const error = classifyCommonError(401, { error: '인증 세션이 필요합니다.' })
      render(<CommonErrorView error={error} onAction={onAction} />)
      const button = screen.getByRole('button', { name: '다시 로그인' })
      fireEvent.click(button)
      expect(onAction).toHaveBeenCalledWith('sign_in')
    })
  })

  describe('Given 다음 행동을 받을 수 없을 때', () => {
    it('Then 눌러도 아무 일이 없는 버튼을 만들지 않는다', () => {
      render(<CommonErrorView error={classifyCommonError('network')} />)
      expect(screen.queryByRole('button')).toBeNull()
    })
  })
})

describe('ConsentStatusView', () => {
  describe('Given 동의가 확인된 고객일 때', () => {
    it('Then 확인된 알약과 확인 날짜를 보여 준다', () => {
      const { container } = render(
        <ConsentStatusView consent={consentStatusFor({ status: 'granted', checkedAt: '2026-10-20T05:00:00Z' })} />,
      )
      expect(container.querySelector('[data-consent-status="granted"]')).toBeTruthy()
      expect(screen.getByText('수신 동의 확인됨')).toBeTruthy()
      expect(screen.getByText(/2026-10-20 확인/)).toBeTruthy()
    })
  })

  describe('Given 동의를 철회한 고객일 때', () => {
    it('Then 철회 문구를 쓰고 "확인됨"을 쓰지 않는다', () => {
      const { container } = render(
        <ConsentStatusView consent={consentStatusFor({ status: 'withdrawn', checkedAt: '2026-10-20T00:00:00Z', source: '고객 요청' })} />,
      )
      expect(container.querySelector('[data-consent-status="withdrawn"]')).toBeTruthy()
      expect(screen.getByText('수신 동의 철회')).toBeTruthy()
      expect(screen.queryByText('수신 동의 확인됨')).toBeNull()
      expect(screen.getByText(/고객 요청/)).toBeTruthy()
    })
  })

  describe('Given 동의 여부를 모를 때', () => {
    it('Then 미확인으로 두고 날짜·출처를 꾸며내지 않는다', () => {
      const { container } = render(
        <ConsentStatusView consent={consentStatusFor({ status: 'unknown', source: 'customer_request' })} />,
      )
      expect(container.querySelector('[data-consent-status="unknown"]')).toBeTruthy()
      expect(screen.getByText('수신 동의 미확인')).toBeTruthy()
      expect(screen.getByText('확인 날짜를 알 수 없어요')).toBeTruthy()
      expect(screen.queryByText(/customer_request/)).toBeNull()
    })
  })
})
