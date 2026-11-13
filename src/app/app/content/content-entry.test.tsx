import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { ContentEntry } from './content-entry'

vi.mock('next/navigation', () => ({ usePathname: () => '/app/content', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/components/quick-post/content-hub', () => ({ ContentHub: () => <p>legacy-content</p> }))

function narrow(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}

beforeEach(() => window.sessionStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('/app/content 배선(ANI-1688)', () => {
  it('플래그 OFF(기본) 이면 기존 콘텐츠 허브이고 새 API 호출이 없다', () => {
    narrow(true)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<ContentEntry workspaceId="ws-1" />)
    expect(screen.getByText('legacy-content')).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('플래그 ON 이어도 넓은 화면이면 기존 화면', () => {
    narrow(false)
    render(<MobileR2Provider enabled><ContentEntry workspaceId="ws-1" /></MobileR2Provider>)
    expect(screen.getByText('legacy-content')).toBeVisible()
  })

  it('플래그 ON + 좁은 화면이면 작업함 목록을 보여준다', async () => {
    narrow(true)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: [
          { contentId: 'c-1', title: '가을 신상 안내', status: 'draft', channel: 'instagram', workspaceId: 'ws-1' },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MobileR2Provider enabled><ContentEntry workspaceId="ws-1" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByText('가을 신상 안내')).toBeVisible())
    expect(screen.queryByText('legacy-content')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/content?view=mobile-list', expect.objectContaining({ cache: 'no-store' }))
  })

  it('플래그 ON 에서 조회 실패는 빈 목록이 아니라 오류로 보인다', async () => {
    narrow(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    render(<MobileR2Provider enabled><ContentEntry workspaceId="ws-1" /></MobileR2Provider>)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('작업을 불러오지 못했어요'))
    expect(screen.getByRole('button', { name: '다시 확인하기' })).toBeVisible()
  })
})
