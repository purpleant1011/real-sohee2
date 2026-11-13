import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { MobileNavigation, MobileHeader, MobileMoreMenu } from './mobile-navigation'

it('uses five task destinations and one selected compatibility link', () => {
  render(<MobileNavigation pathname="/app/vault" />)
  const nav = screen.getByRole('navigation', { name: '소희 업무 메뉴' })
  expect(nav.querySelectorAll('a')).toHaveLength(5)
  expect(screen.getByRole('link', { name: '작업' })).toHaveAttribute('aria-current', 'page')
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '소희대화' })).not.toBeInTheDocument()
})

it('names delegation and safety controls without logout clutter', () => {
  render(<MobileHeader onDelegate={() => {}} />)
  expect(screen.getByRole('button', { name: '소희와 채팅' })).toBeVisible()
  expect(screen.getByRole('link', { name: '업무 제어' })).toHaveAttribute('href', '/app/sohee?tab=work&section=autonomy')
  expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
})

it('labels billing section as "이용 플랜" instead of "요금과 크레딧"', () => {
  render(<MobileMoreMenu />)
  expect(screen.getByRole('link', { name: '이용 플랜' })).toHaveAttribute('href', '/app/system?mobileSection=credits')
  expect(screen.queryByText('요금과 크레딧')).not.toBeInTheDocument()
})
