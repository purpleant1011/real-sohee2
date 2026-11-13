import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReservationActionCard, type ReservationAction } from './reservation-action-card'

describe('ReservationActionCard', () => {
  it('action.kind가 "none"일 때는 아무것도 렌더링하지 않는다', () => {
    const action: ReservationAction = {
      kind: 'none',
      title: '할 일 없음',
      detail: '세부 내용',
      ctaLabel: '확인',
    }
    const { container } = render(<ReservationActionCard action={action} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('일반 대기 알림(booking_pending) 정보를 올바르게 표시한다', () => {
    const action: ReservationAction = {
      kind: 'booking_pending',
      title: '신규 예약 대기 1건',
      detail: '오후 2시 커트 예약 승인이 필요해요',
      reservationId: 'res-101',
      ctaLabel: '10초 만에 확정하기',
    }
    render(<ReservationActionCard action={action} />)

    expect(screen.getByText('신규 예약 대기 1건')).toBeInTheDocument()
    expect(screen.getByText('오후 2시 커트 예약 승인이 필요해요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /10초 만에 확정하기/ })).toBeInTheDocument()
  })

  it('연타 방어: 버튼 연타 시 onAction은 1회만 호출되고 로딩 중 중복 호출이 차단된다', async () => {
    let resolvePromise: () => void = () => {}
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })
    const onAction = vi.fn().mockImplementation(() => pendingPromise)

    const action: ReservationAction = {
      kind: 'notification_failed',
      title: '알림톡 발송 실패',
      detail: '고객 전화번호 오류로 알림톡이 전송되지 않았어요',
      ctaLabel: '문자로 다시 발송하기',
      onAction,
    }

    render(<ReservationActionCard action={action} />)
    const button = screen.getByRole('button', { name: /문자로 다시 발송하기/ })

    // 첫 번째 클릭
    fireEvent.click(button)
    // 연타 시도
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    // 작업 완료 후 비활성화 해제
    resolvePromise()
    await waitFor(() => {
      expect(button).not.toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'false')
    })
  })

  it('시술집중 모드(isFocusMode=true)일 때 일반 알림(booking_pending)은 숨겨진다', () => {
    const action: ReservationAction = {
      kind: 'booking_pending',
      title: '새로운 예약 접수',
      detail: '내일 오전 예약 접수건입니다',
      ctaLabel: '확인하기',
    }
    const { container } = render(<ReservationActionCard action={action} isFocusMode={true} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('시술집중 모드(isFocusMode=true)일 때 긴급 알림(notification_failed)은 강조되어 노출된다', () => {
    const action: ReservationAction = {
      kind: 'notification_failed',
      title: '알림톡 발송 실패',
      detail: '즉시 확인이 필요한 발송 오류예요',
      ctaLabel: '재전송하기',
    }
    render(<ReservationActionCard action={action} isFocusMode={true} />)

    expect(screen.getByText('알림톡 발송 실패')).toBeInTheDocument()
    expect(screen.getByText('즉시 확인이 필요한 발송 오류예요')).toBeInTheDocument()
    // 긴급 안내 배지/강조 표시 확인
    expect(screen.getByText(/긴급|시술 중 긴급 안내/)).toBeInTheDocument()
    const alertSection = screen.getByRole('region', { name: /예약 긴급 조치|예약 조치/ })
    expect(alertSection).toBeInTheDocument()
  })

  it('시술집중 모드(isFocusMode=true)일 때 예약 충돌(slot_conflict)도 긴급 조치로 노출된다', () => {
    const action: ReservationAction = {
      kind: 'slot_conflict',
      title: '예약 시간 중복 충돌',
      detail: '동일 시간대 2개 예약이 겹쳐 있어요',
      ctaLabel: '시간 조율하기',
    }
    render(<ReservationActionCard action={action} isFocusMode={true} />)

    expect(screen.getByText('예약 시간 중복 충돌')).toBeInTheDocument()
    expect(screen.getByText(/긴급|시술 중 긴급 안내/)).toBeInTheDocument()
  })

  it('ctaHref가 주어졌을 때는 링크로 렌더링된다', () => {
    const action: ReservationAction = {
      kind: 'booking_pending',
      title: '예약 확인',
      detail: '예약 상세 페이지로 이동합니다',
      ctaLabel: '상세 보기',
      ctaHref: '/app/reservations/123',
    }
    render(<ReservationActionCard action={action} />)

    const link = screen.getByRole('link', { name: /상세 보기/ })
    expect(link).toHaveAttribute('href', '/app/reservations/123')
  })

  it('크레딧, 캐시, 잔액 등 불필요한 숫자나 과금 문구를 일체 노출하지 않는다 (No-Credit-Display)', () => {
    const action: ReservationAction = {
      kind: 'notification_failed',
      title: '알림톡 발송 실패',
      detail: '문자로 전환 발송할 수 있어요',
      ctaLabel: '즉시 발송',
    }
    const { container } = render(<ReservationActionCard action={action} />)

    expect(container.textContent).not.toMatch(/크레딧|잔여|코인|원|포인트|\d+C/i)
  })

  it('배지와 제목 컨테이너에 shrink-0 whitespace-nowrap 및 break-keep이 적용된다', () => {
    const action: ReservationAction = {
      kind: 'notification_failed',
      title: '알림톡 발송 실패',
      detail: '즉시 확인이 필요한 발송 오류예요',
      ctaLabel: '재전송하기',
    }
    render(<ReservationActionCard action={action} />)
    const urgentSpan = screen.getByText('긴급 조치 필요')
    expect(urgentSpan.className).toContain('shrink-0')
    expect(urgentSpan.className).toContain('whitespace-nowrap')
    const heading = screen.getByRole('heading', { level: 2, name: '알림톡 발송 실패' })
    expect(heading.className).toContain('break-keep')
  })
})
