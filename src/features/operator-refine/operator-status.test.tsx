import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OperatorEmpty, OperatorSourceState, OperatorStatusTag } from './operator-status'

describe('operator status primitives', () => {
  it('maps operational states to clear Korean labels', () => {
    render(<>
      <OperatorStatusTag state="success" label="활성" />
      <OperatorStatusTag state="warning" label="동의 대기" />
      <OperatorStatusTag state="critical" label="게시 실패" />
      <OperatorSourceState state="unknown" />
    </>)

    expect(screen.getByText('활성')).toHaveAttribute('data-operator-state', 'success')
    expect(screen.getByText('동의 대기')).toHaveAttribute('data-operator-state', 'warning')
    expect(screen.getByText('게시 실패')).toHaveAttribute('data-operator-state', 'critical')
    expect(screen.getByText('자료 확인 전')).toBeInTheDocument()
  })

  it('renders a useful empty state without fake operational values', () => {
    render(<OperatorEmpty title="등록된 고객사가 없습니다" description="검색 조건을 바꾸거나 고객사 등록 상태를 확인해 주세요." />)
    expect(screen.getByText('등록된 고객사가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('검색 조건을 바꾸거나 고객사 등록 상태를 확인해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText(/샘플|가짜|수집 전 0/)).not.toBeInTheDocument()
  })
})
