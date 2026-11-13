import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomerDetailEntry } from './customer-detail-entry'

const activeMock = vi.hoisted(() => ({ value: true }))
const routerReplace = vi.hoisted(() => vi.fn())

vi.mock('@/features/mobile-shell/r2-gate', () => ({
  useMobileR2Active: () => activeMock.value,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/features/mobile-customers/r2-customer-detail', () => ({
  R2CustomerDetail: ({ customerId, workspaceId }: { customerId: string; workspaceId: string }) => (
    <div data-testid="r2-customer-detail">{`r2:${customerId}:${workspaceId}`}</div>
  ),
}))

vi.mock('../customers-view', () => ({
  default: ({ initialCustomerId }: { initialCustomerId?: string }) => (
    <div data-testid="pc-customers-view">{`pc:${initialCustomerId}`}</div>
  ),
}))

describe('CustomerDetailEntry', () => {
  it('모바일 R2 활성화 시 R2 고객 상세를 렌더링한다', () => {
    activeMock.value = true
    render(<CustomerDetailEntry workspaceId="ws-1" customerId="cust-123" />)
    expect(screen.getByTestId('r2-customer-detail')).toHaveTextContent('r2:cust-123:ws-1')
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('PC(넓은 화면)에서는 목록으로 강제 리다이렉트하지 않고 해당 고객이 선택된 CustomersView를 렌더링한다', () => {
    activeMock.value = false
    render(<CustomerDetailEntry workspaceId="ws-1" customerId="cust-123" />)
    expect(routerReplace).not.toHaveBeenCalled()
    expect(screen.getByTestId('pc-customers-view')).toHaveTextContent('pc:cust-123')
  })
})
