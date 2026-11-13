import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MobileCustomersView } from './customers-view'

const snapshot = { loadState: 'ready' as const, customers: [], workspaceId: 'ws-1', complete: true, checkedAt: '2026-10-22T07:40:00Z' }

describe('고객 탭 바로가기', () => {
  it('등록 고객이 없어도 소통함·예약 일정으로 바로 갈 수 있다 (PC 고객 화면과 같은 진입점)', () => {
    render(<MobileCustomersView snapshot={snapshot} />)
    expect(screen.getByRole('link', { name: '소통함' })).toHaveAttribute('href', '/app/engagement')
    expect(screen.getByRole('link', { name: '예약 일정' })).toHaveAttribute('href', '/app/schedule')
  })
})
