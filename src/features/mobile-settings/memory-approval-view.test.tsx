// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  MobileMemoryApprovalView,
  memoryApprovalScreenConfig,
  type MemoryApprovalViewSnapshot,
} from './memory-approval-view'
import type { MemoryCandidate } from './memory-approval'
import type { MemoryDecisionUiState } from './r2-memory-decisions'

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    key: 'price:cut',
    kind: 'price',
    proposalId: 'p-1',
    proposedValue: '35,000원',
    currentValue: '30,000원',
    origin: 'owner_stated',
    source: { label: '매장 안내문', href: null, observedAt: '2026-10-20T03:00:00Z' },
    customerVisible: true,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<MemoryApprovalViewSnapshot> = {}): MemoryApprovalViewSnapshot {
  return {
    loadState: 'ready',
    candidates: [makeCandidate()],
    complete: true,
    checkedAt: '2026-10-22T07:40:00Z',
    ...overrides,
  }
}

/** 화면은 항상 R2 배선(onDecide)과 함께 그려진다. 핸들러 없이 그리는 상태는 계약이 아니다. */
function renderView(
  snapshot: MemoryApprovalViewSnapshot,
  options: {
    onDecide?: (proposalId: string, decision: 'confirm' | 'reject') => void
    decisionStates?: Record<string, MemoryDecisionUiState>
  } = {},
) {
  return render(
    <MobileMemoryApprovalView
      snapshot={snapshot}
      onDecide={options.onDecide ?? vi.fn()}
      decisionStates={options.decisionStates}
    />,
  )
}

function approveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '이 내용으로 승인' }) as HTMLButtonElement
}

function rejectButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '이 내용은 아니에요' }) as HTMLButtonElement
}

describe('M22 가게 기억 승인 화면', () => {
  it('확정·추측·변경 제안을 라벨로 구분한다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [
        makeCandidate({ proposalId: 'p-c', key: 'k-c', currentValue: null, origin: 'owner_stated' }),
        makeCandidate({ proposalId: 'p-i', key: 'k-i', currentValue: null, origin: 'sohee_inferred' }),
        makeCandidate({ proposalId: 'p-x', key: 'k-x' }),
      ],
    }))

    expect(container.textContent).toContain('확정된 기억')
    expect(container.textContent).toContain('소희 추측')
    expect(container.textContent).toContain('변경 제안')
  })

  it('기존 값과 다르면 다시 확인을 요구하고 승인을 막는다', () => {
    renderView(makeSnapshot())

    expect(screen.getByText('기존 값과 달라요. 승인 전에 한 번 더 확인해 주세요.')).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    expect(approveButton().getAttribute('aria-disabled')).toBe('true')
  })

  it('기존 값과 비교해 확인하면 변경 제안도 승인할 수 있다', () => {
    renderView(makeSnapshot())

    fireEvent.click(screen.getByRole('checkbox', { name: '기존 값과 비교해 확인했어요' }))

    expect(approveButton().disabled).toBe(false)
    expect(screen.queryByText('기존 값과 달라요. 승인 전에 한 번 더 확인해 주세요.')).toBeNull()
  })

  it('차단 사유와 다음 행동을 함께 보여준다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [makeCandidate({ proposalId: 'p-2', source: null, currentValue: null })],
    }))

    expect(container.textContent).toContain('정보 출처를 확인하지 못했어요')
    expect(container.textContent).toContain('출처 입력')
    expect(container.textContent).toContain('출처를 확인하지 못했어요')
    expect(container.textContent).not.toContain('아직 기억하지 못했어요'.repeat(0) + '출처:')
    expect(approveButton().disabled).toBe(true)
  })

  it('추측을 고객 안내에 쓰려 하면 막는다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [makeCandidate({ proposalId: 'p-3', currentValue: null, origin: 'sohee_inferred', customerVisible: true })],
    }))

    expect(container.textContent).toContain('소희 추측은 고객 안내에 쓸 수 없어요')
    expect(approveButton().disabled).toBe(true)
  })

  it('확인된 값은 승인할 수 있고 승인 전 고객 비노출을 알린다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [makeCandidate({ proposalId: 'p-4', currentValue: null, customerVisible: true })],
    }))

    expect(container.textContent).toContain('승인 전에는 고객에게 보이지 않아요.')
    expect(approveButton().disabled).toBe(false)
    expect(approveButton().getAttribute('aria-disabled')).toBe('false')
  })

  it('고객 안내에 쓰이지 않는 내용은 그 사실을 알린다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [makeCandidate({ proposalId: 'p-5', currentValue: null, customerVisible: false })],
    }))

    expect(container.textContent).toContain('이 내용은 고객 안내에 쓰이지 않아요.')
    expect(container.textContent).not.toContain('승인 전에는 고객에게 보이지 않아요.')
  })

  it('출처와 확인 시각을 함께 보여준다', () => {
    const { container } = renderView(makeSnapshot({
      candidates: [makeCandidate({ proposalId: 'p-6', currentValue: null })],
    }))

    expect(container.textContent).toContain('출처: 매장 안내문')
    expect(container.textContent).toContain('2026-10-20 확인')
  })

  it('서버가 전체를 확인한 빈 목록은 없음으로, 아니면 일부만 확인으로 알린다', () => {
    const confirmed = renderView(makeSnapshot({
      candidates: [],
      complete: true,
    }))
    expect(confirmed.container.textContent).toContain('확인할 가게 정보가 없어요')
    confirmed.unmount()

    const partial = renderView(makeSnapshot({
      candidates: [],
      complete: false,
    }))
    expect(partial.container.textContent).toContain('일부만 불러왔어요')
  })

  it('조회 실패면 후보 값을 그리지 않고 실패를 알린다', () => {
    const { container } = renderView(makeSnapshot({ loadState: 'error' }))

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(container.textContent).not.toContain('35,000원')
    expect(container.textContent).not.toContain('매장 안내문')
    expect(screen.queryAllByRole('button', { name: '이 내용으로 승인' })).toHaveLength(0)
  })

  it('OH: 화면 설정은 REVIEW 모드의 가게 기억 화면이다', () => {
    expect(memoryApprovalScreenConfig()).toEqual({ mode: 'REVIEW', title: '가게 기억' })
  })
})

describe('M22 승인·거절 버튼 동작 (ANI-1709)', () => {
  const approved = () => makeCandidate({ proposalId: 'p-4', currentValue: null })

  it('승인 버튼은 그 제안 id 와 confirm 을 넘긴다', () => {
    const onDecide = vi.fn()
    renderView(makeSnapshot({ candidates: [approved()] }), { onDecide })

    fireEvent.click(approveButton())

    expect(onDecide).toHaveBeenCalledWith('p-4', 'confirm')
  })

  it('거절은 값이 상충해도(재확인 전) 누를 수 있고 reject 를 넘긴다', () => {
    const onDecide = vi.fn()
    renderView(makeSnapshot(), { onDecide })

    expect(approveButton().disabled).toBe(true)
    fireEvent.click(rejectButton())

    expect(onDecide).toHaveBeenCalledWith('p-1', 'reject')
  })

  it('저장 중에는 두 버튼을 모두 잠근다', () => {
    renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'submitting' } },
    })

    expect(screen.getByText('저장하고 있어요…')).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    expect(rejectButton().disabled).toBe(true)
  })

  it('처리된 항목은 승인·거절 결과를 알리고 다시 누를 수 없다', () => {
    const { unmount } = renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'decided', status: 'confirmed' } },
    })
    expect(screen.getByText('승인했어요.')).toBeTruthy()
    expect(approveButton().disabled).toBe(true)
    expect(rejectButton().disabled).toBe(true)
    unmount()

    renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'decided', status: 'rejected' } },
    })
    expect(screen.getByText('거절했어요.')).toBeTruthy()
  })

  it('이미 처리된 항목은 성공과 다른 문구로 알린다', () => {
    const { unmount } = renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'already_handled', status: 'confirmed' } },
    })
    expect(screen.getByText('이미 승인된 항목이에요.')).toBeTruthy()
    expect(screen.queryByText('승인했어요.')).toBeNull()
    unmount()

    renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'already_handled', status: 'rejected' } },
    })
    expect(screen.getByText('이미 거절된 항목이에요.')).toBeTruthy()
  })

  it('실패 사유를 구분해 알리고 다시 시도할 수 있게 둔다', () => {
    const { unmount } = renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'failed', reason: 'unavailable' } },
    })
    expect(screen.getByRole('alert').textContent).toBe('저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    expect(approveButton().disabled).toBe(false)
    unmount()

    renderView(makeSnapshot({ candidates: [approved()] }), {
      decisionStates: { 'p-4': { kind: 'failed', reason: 'not_found' } },
    })
    expect(screen.getByRole('alert').textContent)
      .toBe('이미 처리됐거나 찾을 수 없는 항목이에요. 화면을 새로 고쳐 확인해 주세요.')
  })

  it('기억 카드 배지에 shrink-0 whitespace-nowrap이 적용되고 재확인 체크박스는 44px 터치 영역을 준수한다', () => {
    renderView(makeSnapshot({ candidates: [makeCandidate({ proposalId: 'p-reconfirm', currentValue: '30,000원' })] }))
    const badge = screen.getByText('변경 제안')
    expect(badge.className).toContain('shrink-0')
    expect(badge.className).toContain('whitespace-nowrap')
    const checkbox = screen.getByRole('checkbox', { name: '기존 값과 비교해 확인했어요' })
    const label = checkbox.closest('label')
    expect(label?.className).toContain('min-h-11')
    expect(label?.className).toContain('cursor-pointer')
  })
})
