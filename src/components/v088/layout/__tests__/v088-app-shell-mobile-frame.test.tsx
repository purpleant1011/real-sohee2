import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { useSurfaceContext } from '@/features/agent-dock/surface-context'

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/sohee',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ href, children, prefetch: _p, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }))

import { V088AppShell } from '../v088-app-shell'

function NeedsSurface() {
  const { setContextDetails } = useSurfaceContext()
  setContextDetails
  return <p>스튜디오 본문</p>
}

describe('V088AppShell 모바일 프레임', () => {
  it('모바일 호스트에서는 PC 사이드바 대신 모바일 셸 안에 본문을 그린다', () => {
    render(
      <MobileR2Provider enabled forceMobile>
        <V088AppShell workspaceId="ws-1"><NeedsSurface /></V088AppShell>
      </MobileR2Provider>,
    )
    expect(screen.getByText('스튜디오 본문')).toBeInTheDocument()
    expect(document.querySelector('[data-mobile-shell]')).not.toBeNull()
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).toBeNull()
    expect(screen.queryByText('마케팅 전담 직원')).toBeNull()
  })
})
