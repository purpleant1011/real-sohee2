import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
vi.mock('@/components/theme-provider', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: () => {} }) }))
import { MobileFixtureClient } from './mobile-fixture-client'
it('uses production presentation components but never sends a real request', () => {
  render(<MobileFixtureClient initialState="ready" initialPath="/app" initialTheme="light" />)
  expect(screen.getByText('테스트 예시 · 외부 실행 없음')).toBeVisible()
  expect(screen.getByRole('navigation', { name: '소희 업무 메뉴' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '소희와 채팅' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByRole('button', { name: '실제 요청은 실행되지 않아요' })).toBeDisabled()
})
