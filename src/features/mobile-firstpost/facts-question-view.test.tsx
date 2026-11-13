import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FactsQuestionView } from './facts-question-view'
import { FACT_QUESTIONS } from './facts'

describe('FactsQuestionView (M05 사실 확인 화면)', () => {
  it('기존 확정 기억이 있으면 요약에 표시되고 해당 질문은 건너뛴다 (재질문 방지)', () => {
    render(
      <FactsQuestionView
        initialMemory={{ price: '아메리카노 4,500원' }}
      />
    )

    // 가격은 이미 확인된 내용에 존재
    expect(screen.getByText('이번 초안에서 확인한 내용')).toBeInTheDocument()
    expect(screen.getByText('아메리카노 4,500원')).toBeInTheDocument()

    // 다음 누락 질문인 'menu' 질문이 질문 카드에 표시되어야 함
    expect(screen.getByText(FACT_QUESTIONS.menu)).toBeInTheDocument()
    expect(screen.queryByText(FACT_QUESTIONS.price)).not.toBeInTheDocument()
  })

  it('initialMemory와 initialFacts가 모두 주어지면 두 항목이 모두 안전하게 병합 보존된다 (우선순위/회귀 방지)', () => {
    render(
      <FactsQuestionView
        initialMemory={{ price: '10,000원' }}
        initialFacts={[
          { field: 'hours', status: 'CONFIRMED', value: '매일 10:00 - 20:00' },
        ]}
      />
    )

    // initialMemory의 price와 initialFacts의 hours가 모두 보존되어야 함
    expect(screen.getByText('10,000원')).toBeInTheDocument()
    expect(screen.getByText('매일 10:00 - 20:00')).toBeInTheDocument()

    // price(0)와 hours(2)가 완료되었으므로 다음 질문은 menu(1)이어야 함
    expect(screen.getByText(FACT_QUESTIONS.menu)).toBeInTheDocument()
  })

  it('누락 질문에 답변 입력 시 정본으로 자동 승격되지 않고 제안(PROPOSED) 상태로 전환된다 (정직한 문구)', () => {
    render(<FactsQuestionView />)

    // 첫 질문: price
    expect(screen.getByText(FACT_QUESTIONS.price)).toBeInTheDocument()

    const input = screen.getByLabelText('답변 입력')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).not.toHaveAttribute('aria-describedby')

    fireEvent.change(input, { target: { value: '컷 25,000원' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    // 제안 상태 카드 노출 및 정직한 문구 검증
    expect(screen.getByText('소희의 제안')).toBeInTheDocument()
    expect(screen.getByText('컷 25,000원')).toBeInTheDocument()
    expect(screen.getByText(/이번 홍보 초안 작성에만 사용/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 내용으로 초안 준비' })).toBeInTheDocument()
  })

  it('새 가격 입력 후 로컬 확인 시 등록/저장된 기억으로 거짓 승격되지 않고 이번 초안에서 확인한 내용으로 표시된다 (P1 회귀 방지)', () => {
    render(<FactsQuestionView />)

    // 1. 답변 입력
    fireEvent.change(screen.getByLabelText('답변 입력'), { target: { value: '새 이벤트가 18,000원' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    // 2. 로컬 확인 클릭
    fireEvent.click(screen.getByRole('button', { name: '이 내용으로 초안 준비' }))

    // 3. 확인된 내용 섹션 검증
    expect(screen.getByText('새 이벤트가 18,000원')).toBeInTheDocument()
    expect(screen.getByText('이번 초안에서 확인한 내용')).toBeInTheDocument()

    // 4. 로컬 확인값이 서버 '등록된 기억' 또는 '저장된 기억'으로 둔갑하지 않음을 엄격히 단언
    expect(screen.queryByText(/등록.*기억/)).not.toBeInTheDocument()
    expect(screen.queryByText(/저장.*기억/)).not.toBeInTheDocument()
    expect(screen.queryByText(/확인된 사업장 기억/)).not.toBeInTheDocument()
  })

  it('제안 상태에서 사용자가 확인해야만 CONFIRMED로 승격되고 다음 질문으로 이동한다', () => {
    const onChange = vi.fn()
    render(<FactsQuestionView onChange={onChange} />)

    // 1. 답변 제안
    fireEvent.change(screen.getByLabelText('답변 입력'), { target: { value: '컷 25,000원' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    // 2. 확인 클릭 (정직한 버튼 문구)
    fireEvent.click(screen.getByRole('button', { name: '이 내용으로 초안 준비' }))

    // 다음 질문(menu)으로 이동
    expect(screen.getByText(FACT_QUESTIONS.menu)).toBeInTheDocument()
    // 가격은 확인된 항목으로 이동
    expect(screen.getByText('컷 25,000원')).toBeInTheDocument()

    expect(onChange).toHaveBeenCalled()
  })

  it('제안 상태에서 다시 작성을 누르면 제안이 취소되고 질문 입력으로 돌아온다', () => {
    render(<FactsQuestionView />)

    fireEvent.change(screen.getByLabelText('답변 입력'), { target: { value: '잘못된 가격' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    expect(screen.getByText('잘못된 가격')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다시 작성' }))

    // 다시 첫 질문 입력 폼으로 복귀
    expect(screen.getByText(FACT_QUESTIONS.price)).toBeInTheDocument()
    expect(screen.queryByText('소희의 제안')).not.toBeInTheDocument()
  })

  it('해당 정보 없이 진행을 누르면 SKIPPED 처리되고 재질문하지 않는다', () => {
    render(<FactsQuestionView />)

    // 가격 질문에서 건너뛰기
    expect(screen.getByText(FACT_QUESTIONS.price)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '해당 정보 없이 진행' }))

    // 다음 질문(menu)으로 바로 이동
    expect(screen.getByText(FACT_QUESTIONS.menu)).toBeInTheDocument()
    expect(screen.queryByText(FACT_QUESTIONS.price)).not.toBeInTheDocument()
  })

  it('답변이 120자를 초과하면 에러와 aria-invalid/describedby가 연결되고 제출을 차단한다 (접근성 검증)', () => {
    render(<FactsQuestionView />)

    const longText = '가'.repeat(121)
    const input = screen.getByLabelText('답변 입력')
    fireEvent.change(input, { target: { value: longText } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('120자 이내')
    expect(alert).toHaveAttribute('id', 'fact-error-msg')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'fact-error-msg')
    expect(screen.queryByText('소희의 제안')).not.toBeInTheDocument()
  })

  it('섹션 전환 시 새 헤딩이 tabIndex=-1을 가지고 포커스를 받아 스크린리더/키보드 길을 잃지 않는다', () => {
    render(<FactsQuestionView />)

    // 1. 초기 질문 헤딩 포커스 확인
    const questionHeading = screen.getByRole('heading', { name: FACT_QUESTIONS.price })
    expect(questionHeading).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(questionHeading)

    // 2. 제안으로 전환 시 제안 헤딩으로 포커스 이동
    const input = screen.getByLabelText('답변 입력')
    fireEvent.change(input, { target: { value: '컷 25,000원' } })
    fireEvent.click(screen.getByRole('button', { name: '소희에게 제안하기' }))

    const proposalHeading = screen.getByRole('heading', { name: /소희의 제안/ })
    expect(proposalHeading).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(proposalHeading)

    // 3. 확인 클릭 후 다음 질문(menu) 헤딩으로 포커스 이동
    fireEvent.click(screen.getByRole('button', { name: '이 내용으로 초안 준비' }))

    const nextHeading = screen.getByRole('heading', { name: FACT_QUESTIONS.menu })
    expect(nextHeading).toHaveAttribute('tabIndex', '-1')
    expect(document.activeElement).toBe(nextHeading)
  })

  it('onComplete 콜백이 없으면 완료 버튼이 비활성화된다', () => {
    render(
      <FactsQuestionView
        initialMemory={{
          price: '10,000원',
          menu: '기본 메뉴',
          hours: '10:00 - 20:00',
          eventPeriod: '10월 한달간',
          contact: '010-0000-0000',
        }}
      />
    )

    expect(screen.getByText('모든 사실 확인이 끝났어요')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: '홍보 초안 만들기' })
    expect(button).toBeDisabled()
    expect(screen.getByText('다음 단계가 연결되지 않았습니다 (서버 저장 미배선).')).toBeInTheDocument()
  })

  it('모든 질문 완료 후 버튼 연속 클릭 시 onComplete는 1회만 호출된다 (중복 방어)', () => {
    const onComplete = vi.fn()
    render(
      <FactsQuestionView
        initialMemory={{
          price: '10,000원',
          menu: '기본 메뉴',
          hours: '10:00 - 20:00',
          eventPeriod: '10월 한달간',
          contact: '010-0000-0000',
        }}
        onComplete={onComplete}
      />
    )

    const button = screen.getByRole('button', { name: '홍보 초안 만들기' })
    expect(button).not.toBeDisabled()

    // 연속 3회 클릭
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({
      price: '10,000원',
      menu: '기본 메뉴',
      hours: '10:00 - 20:00',
      eventPeriod: '10월 한달간',
      contact: '010-0000-0000',
    })
  })
})
