import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ContentHub } from '../content-hub'

const navMocks = vi.hoisted(() => ({ get: vi.fn((key?: string) => { void key; return null as string | null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => navMocks }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/hooks/use-workspace-context', () => ({ useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-test' }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn()
const channel = { provider: 'instagram', handle: '@momocafe', profileUrl: 'https://instagram.com/momocafe' }
const item = (missionId: string, status: string, topic = missionId) => ({
  missionId,
  status,
  topic,
  createdAt: '2025-01-01T00:00:00.000Z',
  copies: { instagram: { caption: `${topic} 소개 문구`, hashtags: ['카페'] }, threads: { content: `${topic} 스레드 문구` } },
  imageIds: ['image-1'],
  imageUrl: null,
  channels: [channel],
  approvalFingerprint: `fingerprint-${missionId}`,
  businessName: '모모 카페',
  revision: 1,
  receipts: {},
})

describe('ContentHub Navigation & Pagination Features', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ items: [], nextCursor: null, hasNextPage: false }) }
    })
  })

  it('renders search input and channel radio filters with accessible aria attributes', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      return { ok: true, json: async () => ({ items: [item('p-init', 'AWAITING_APPROVAL', '기본 글')], nextCursor: null, hasNextPage: false }) }
    })

    render(
      <NuqsTestingAdapter>
        <ContentHub />
      </NuqsTestingAdapter>,
    )

    expect(await screen.findByRole('textbox', { name: '게시물 검색' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '저장된 연결 채널 필터' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '모든 채널', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '인스타그램', pressed: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '스레드', pressed: false })).toBeInTheDocument()
  })

  it('submits search query and triggers server query with q parameter', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url.includes('q=%EA%B0%80%EC%9D%84') || url.includes('q=가을')) {
        return { ok: true, json: async () => ({ items: [item('m-autumn', 'AWAITING_APPROVAL', '가을 신메뉴')], nextCursor: null, hasNextPage: false }) }
      }
      return { ok: true, json: async () => ({ items: [item('m-normal', 'AWAITING_APPROVAL', '일반 메뉴')], nextCursor: null, hasNextPage: false }) }
    })

    render(
      <NuqsTestingAdapter>
        <ContentHub />
      </NuqsTestingAdapter>,
    )

    expect((await screen.findAllByText('일반 메뉴')).length).toBeGreaterThan(0)
    const searchInput = screen.getByRole('textbox', { name: '게시물 검색' })
    fireEvent.change(searchInput, { target: { value: '가을' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url.includes('q=') || url.includes('%EA%B0%80%EC%9D%84'))).toBe(true)
    })
  })

  it('supports pagination next button when nextCursor exists and handles independent fallback single post', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url.includes('/quick-post/deep-target')) {
        return { ok: true, json: async () => ({ item: item('deep-target', 'AWAITING_APPROVAL', '독립 딥링크 글') }) }
      }
      return {
        ok: true,
        json: async () => ({
          items: [item('p1-1', 'AWAITING_APPROVAL', '1페이지 글')],
          nextCursor: 'next-page-cursor-token',
          hasNextPage: true,
        }),
      }
    })

    render(
      <NuqsTestingAdapter searchParams={{ post: 'deep-target' }}>
        <ContentHub />
      </NuqsTestingAdapter>,
    )

    // Next page button should be enabled
    const nextBtn = await screen.findByRole('button', { name: /다음/ })
    expect(nextBtn).toBeEnabled()

    // Independent deep-link single post should be loaded and rendered in PostDetail
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '독립 딥링크 글' })).toBeInTheDocument()
    })
  })
})
