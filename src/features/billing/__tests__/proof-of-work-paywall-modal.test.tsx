import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ProofOfWorkPaywallModal } from '../proof-of-work-paywall-modal'

const props = { isOpen: true, onClose: vi.fn(), workspaceId: 'review-workspace', businessName: '심사 테스트 매장' }

describe('구독은 기능 이용권이며 정책 확정 전 구매를 차단한다', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('세 요금제에 크레딧 지급량이나 임의 증명 실적을 표시하지 않는다', () => {
    render(<ProofOfWorkPaywallModal {...props} energySpent={50} energyCapacity={50} />)
    for (const name of ['기본 마케팅 직원', '고성장 전담 직원', '최상위 총괄']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    for (const price of ['₩150,000', '₩300,000', '₩500,000']) {
      expect(screen.getByText(price)).toBeInTheDocument()
    }
    expect(screen.getByText(/월 구독에 크레딧을 지급하지 않습니다/)).toBeInTheDocument()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/\d[\d,.]*\s*(?:Agent )?Energy|실측 영수증 발급 완료|무제한/)
    expect(screen.getAllByText('VAT 포함')).toHaveLength(3)
    expect(screen.getByText('서비스 제공기간: 결제일부터 1개월')).toBeInTheDocument()
    expect(screen.getByText(/다음 달에 같은 날짜가 없으면 말일/)).toBeInTheDocument()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/165,000|330,000|550,000|최종 청구금액.*확정 전|부가가치세 포함 여부/)
    expect(screen.queryByText('네이버 플레이스 키워드 최적화 및 대표 소식 발행')).not.toBeInTheDocument()
  })

  it('정책과 PG 준비가 안 된 상태에서 API나 결제 콜백을 실행하지 않는다', () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const onSelectPlan = vi.fn()
    render(<ProofOfWorkPaywallModal {...props} onSelectPlan={onSelectPlan} />)
    const checkout = screen.getByRole('button', { name: '결제 준비 중' })
    expect(checkout).toBeDisabled()
    fireEvent.click(checkout)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(onSelectPlan).not.toHaveBeenCalled()
    expect(screen.getByText(/AI 모델과 기능별 이용 범위/)).toBeInTheDocument()
    expect(screen.getByText(/부가가치세/)).toBeInTheDocument()
    expect(screen.queryByText(/결제 승인창으로 이동합니다/)).not.toBeInTheDocument()
  })

  it('키보드로도 상품 선택과 닫기가 가능하다', () => {
    const onClose = vi.fn()
    render(<ProofOfWorkPaywallModal {...props} onClose={onClose} />)
    const option = screen.getByRole('radio', { name: /기본 마케팅 직원/ })
    fireEvent.click(option)
    expect(option).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '나중에 하기' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('제공되지 않은 실적은 만들지 않고 전달된 기록만 보여준다', () => {
    render(<ProofOfWorkPaywallModal {...props} recentProofs={[{
      id: 'actual-record', title: '확인된 작업 기록', channel: 'INSTAGRAM', verifiedAt: '확인 시각', energyCost: 10,
    }]} />)
    expect(screen.getByText('확인된 작업 기록')).toBeInTheDocument()
    expect(screen.queryByText(/10 Energy/)).not.toBeInTheDocument()
  })

  it('해지는 다음 갱신 중단으로 안내하고 환불 권리와 구분하여 표시한다', () => {
    render(<ProofOfWorkPaywallModal {...props} />)
    expect(screen.getByText(/다음 갱신부터 해지/)).toBeInTheDocument()
    expect(screen.getByText(/현재 결제된 이용기간은 유지/)).toBeInTheDocument()
    expect(screen.getByText(/법령에 따른 권리를 제한하지 않습니다/)).toBeInTheDocument()
    const dialogText = screen.getByRole('dialog').textContent
    expect(dialogText).not.toContain('해지 조건 확정 전')
    expect(dialogText).not.toContain('해지 조건 미확정')
    expect(dialogText).not.toContain('해지·환불 조건을 확정')
    expect(dialogText).toMatch(/자동갱신/)
    expect(dialogText).toMatch(/환불/)
    expect(dialogText).toMatch(/PG/)
  })

  it('닫힌 모달은 렌더링하지 않는다', () => {
    const { container } = render(<ProofOfWorkPaywallModal {...props} isOpen={false} />)
    expect(container.firstChild).toBeNull()
  })
})
