import { render, screen } from '@testing-library/react'
import { MessageSquare } from 'lucide-react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/actions', () => ({ signOutAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a data-prefetch={prefetch === false ? 'false' : 'enabled'} {...props} />
  ),
}))

import { AppHeader } from './app-header'
import { ContextRail } from './context-rail'
import { DesktopSidebar } from './desktop-sidebar'
import { MobileNav } from './mobile-nav'

const items = [{ href: '/app', label: '대화', icon: MessageSquare }]

describe('Free plan navigation', () => {
  it('does not preload protected destinations before the user selects them', () => {
    render(<>
      <DesktopSidebar items={items} pathname="/app" />
      <MobileNav items={items} pathname="/app" />
      <AppHeader />
      <ContextRail variant="menu" />
    </>)

    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(5)
    for (const link of links) expect(link).toHaveAttribute('data-prefetch', 'false')
  })
})
