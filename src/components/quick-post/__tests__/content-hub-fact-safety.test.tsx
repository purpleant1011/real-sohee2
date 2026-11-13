import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ContentHubWorkspace } from '../content-hub'
import type { NaverPlaceConnectCardProps } from '@/features/knowledge/naver-place/naver-place-connect-card'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/channel-studio/naver/ui/naver-post-panel', () => ({
  NaverPostPanel: ({ initialTopic }: { initialTopic: string | null }) => <output data-testid="naver-topic">{initialTopic}</output>,
}))
vi.mock('@/features/knowledge/naver-place/naver-place-connect-card', () => ({
  NaverPlaceConnectCard: ({ onStartSnsCard, onStartBlogPost }: NaverPlaceConnectCardProps) => <>
    <button onClick={() => onStartSnsCard?.()}>연동 정보 없이 SNS 만들기</button>
    <button onClick={() => onStartBlogPost?.()}>연동 정보 없이 블로그 만들기</button>
  </>,
}))

const fetchMock = vi.fn()
function show() {
  return render(<NuqsTestingAdapter hasMemory><ContentHubWorkspace workspaceId="ws-test" /></NuqsTestingAdapter>)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => init?.method === 'POST'
      ? { item: { missionId: 'draft', businessName: '우리 매장', topic: '매장 안내', status: 'DRAFT', revision: 1, copies: { instagram: { caption: '' }, threads: { content: '' } }, channels: [], imageIds: [], receipts: {} } }
      : { items: [], hasAnySupportedContent: false },
  }))
})

describe('ContentHub source-free recommendations', () => {
  it('does not present an invented rating or customer review as a recommended fact', async () => {
    show()
    await screen.findByText('아직 만든 게시물이 없어요')
    expect(screen.queryByRole('button', { name: /4\.98|찐 후기/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /매장 소개와 방문 안내/ }))
    expect(screen.getByTestId('naver-topic')).toHaveTextContent('확인된 매장 정보')
    expect(screen.getByTestId('naver-topic').textContent).not.toMatch(/4\.98|찐 고객|감동 후기/)
  })

  it('does not invent a rating or a testimonial when Place data is absent', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: '연동 정보 없이 SNS 만들기' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/workspaces/ws-test/quick-post' && init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([url, init]) => url === '/api/workspaces/ws-test/quick-post' && init?.method === 'POST')!
    const { topic } = JSON.parse(init.body)
    expect(topic).not.toMatch(/4\.98|평점\s*\d|찐 고객|감동 후기/)
    expect(topic).toContain('확인된 매장 정보')
  })

  it('does not claim customer stories from missing Place reviews in a blog topic', () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: '연동 정보 없이 블로그 만들기' }))
    expect(screen.getByTestId('naver-topic').textContent).not.toMatch(/평점\s*\d|리뷰\s*\d|고객 이야기/)
    expect(screen.getByTestId('naver-topic')).toHaveTextContent('확인된 매장 정보')
  })
})
