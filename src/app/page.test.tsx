import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import HomePage from './(public)/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
}))

it('공개 홈의 V0.85 핵심 가치 문구를 보여준다', () => {
  render(<HomePage />)

  expect(screen.getByRole('heading', { name: '여러 마케팅 채널을 돌아다니지 마세요.' })).toBeInTheDocument()
})

