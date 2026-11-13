import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) => (
    <a data-prefetch={prefetch === false ? 'false' : 'enabled'} {...props} />
  ),
}))

import { AppLink } from './app-link'

describe('AppLink', () => {
  it('disables Next.js prefetch by default for protected app destinations', () => {
    render(<AppLink href="/app/account/knowledge">지식 자료</AppLink>)

    expect(screen.getByRole('link', { name: '지식 자료' })).toHaveAttribute('data-prefetch', 'false')
  })
})
