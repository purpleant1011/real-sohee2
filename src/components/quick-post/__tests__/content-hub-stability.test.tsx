import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import { ContentHub } from '../content-hub'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/hooks/use-workspace-context', () => ({ useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-test' }) }))
vi.mock('@/features/knowledge/naver-place/naver-place-connect-card', () => ({ NaverPlaceConnectCard: () => null }))
vi.mock('../post-detail', () => ({ PostDetail: ({ item }: any) => <h2>{item.topic}</h2> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
const post = (id: string) => ({ missionId: id, topic: id, status: 'AWAITING_APPROVAL', revision: 1, createdAt: '2026-10-19T12:00:00Z', copies: { instagram: { caption: id }, threads: { content: id } }, channels: [], imageIds: [], imageUrl: null, receipts: {} })
const result = (items: ReturnType<typeof post>[] = [], extra = {}) => ({ items, nextCursor: null, prevCursor: null, hasNextPage: false, hasAnySupportedContent: true, ...extra })
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const mockFetch = vi.fn()
const listPath = '/api/workspaces/ws-test/quick-post'
function show(query = '', onUrlUpdate?: (event: UrlUpdateEvent) => void) {
  return render(<NuqsTestingAdapter hasMemory searchParams={query} onUrlUpdate={onUrlUpdate}><ContentHub /></NuqsTestingAdapter>)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockImplementation(async (url: string) => response(url.startsWith(listPath) ? result([post('현재 글')]) : {}))
})

describe('ContentHub stability regression', () => {
  it('supports arrow-key navigation between status tabs', async () => {
    show()
    const waiting = await screen.findByRole('tab', { name: '확인 필요' })
    waiting.focus()
    fireEvent.keyDown(waiting, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: '발행됨' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tab', { name: '발행됨' })).toHaveFocus()
  })

  it('shows retryable detail errors rather than a not-found or another post', async () => {
    mockFetch.mockImplementation(async (url: string) => response(url === `${listPath}/old` ? { error: '상세 장애' } : url.startsWith(listPath) ? result([post('다른 글')]) : {}, url === `${listPath}/old` ? 500 : 200))
    show('?post=old')
    expect(await screen.findByText('상세 장애')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상세 다시 시도' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다른 글' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '선택 해제' }))
    expect(await screen.findByRole('heading', { name: '다른 글' })).toBeInTheDocument()
  })

  it('keeps controls on an empty filtered result and provides reset without first-post generation', async () => {
    mockFetch.mockImplementation(async (url: string) => response(url.startsWith(listPath) ? result() : {}))
    show('?q=없는글&compose=first')
    expect(await screen.findByText('검색 조건에 맞는 게시물이 없어요.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '게시물 검색' })).toHaveValue('없는글')
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '게시물 검색' })).toHaveValue(''))
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST' && init?.body?.includes('우리 가게 첫 인사'))).toBe(false)
  })

  it('does not generate a first post after a list failure', async () => {
    mockFetch.mockImplementation(async () => response({ error: '조회 실패' }, 500))
    show('?compose=first')
    expect(await screen.findByText('조회 실패')).toBeInTheDocument()
    expect(mockFetch.mock.calls.filter(([url, init]) => url === listPath && init?.method === 'POST')).toEqual([])
  })

  it('never falls back to another post for an explicit missing deep link', async () => {
    mockFetch.mockImplementation(async (url: string) => response(url === `${listPath}/missing` ? { error: '게시물을 찾을 수 없어요.' } : url.startsWith(listPath) && !url.includes('/approval-options') ? result([post('다른 글')]) : {}, url === `${listPath}/missing` ? 404 : 200))
    show('?post=missing')
    expect(await screen.findByText('게시물을 찾을 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '다른 글' })).not.toBeInTheDocument()
    expect(mockFetch.mock.calls.some(([url]) => url.includes('다른') && url.endsWith('approval-options'))).toBe(false)
    expect(mockFetch.mock.calls.some(([url]) => url === '/api/onboarding/funnel')).toBe(false)
  })

  it('renders a deep link even if the filtered list is empty and distinguishes detail failures', async () => {
    mockFetch.mockImplementation(async (url: string) => response(url === `${listPath}/old` ? { item: { ...post('old'), topic: '오래된 글' } } : url.startsWith(listPath) ? result() : {}))
    show('?q=없는글&post=old')
    expect(await screen.findByRole('heading', { name: '오래된 글' })).toBeInTheDocument()
    expect(screen.getByText('현재 검색 조건 밖의 게시물을 보고 있어요.')).toBeInTheDocument()
  })

  it('keeps initial cursor errors visible instead of getting stuck in a skeleton', async () => {
    mockFetch.mockImplementation(async () => response({ error: '페이지 조회 실패' }, 500))
    show('?cursor=some-page')
    expect(await screen.findByText('페이지 조회 실패')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /다시 불러오기/ })).toBeInTheDocument()
  })

  it('ignores a slower old response after searching and marks previous results as stale', async () => {
    const slow = deferred<any>()
    mockFetch.mockImplementation((url: string) => {
      if (!url.startsWith(listPath) || url.endsWith('/approval-options')) return Promise.resolve(response({}))
      const q = new URL(url, 'http://localhost').searchParams.get('q')
      return q === '느린검색' ? slow.promise : Promise.resolve(response(result([post(q || '현재 글')])))
    })
    show()
    await screen.findByRole('heading', { name: '현재 글' })
    fireEvent.change(screen.getByRole('textbox', { name: '게시물 검색' }), { target: { value: '느린검색' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    expect(await screen.findByText('검색 중 · 이전 결과를 표시하고 있어요.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '게시물 검색' }), { target: { value: '빠른검색' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    await screen.findByRole('heading', { name: '빠른검색' })
    await act(async () => slow.resolve(response(result([post('느린검색')]))))
    expect(screen.queryByRole('heading', { name: '느린검색' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '빠른검색' })).toBeInTheDocument()
  })

  it('keeps page loading locked until the network finishes and preserves unrelated URL parameters', async () => {
    const initial = deferred<any>()
    const slow = deferred<any>()
    const updates = vi.fn()
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('cursor=next')) return slow.promise
      if (url.startsWith(listPath)) return initial.promise
      return Promise.resolve(response({}))
    })
    show('?studio=other&panel=other&custom=keep', updates)

    const nextButton = await screen.findByRole('button', { name: '다음 페이지' })
    expect(nextButton).toBeDisabled()
    expect(mockFetch.mock.calls.some(([url]) => url.includes('cursor=next'))).toBe(false)

    await act(async () => initial.resolve(response(result([post('첫 페이지')], { nextCursor: 'next', hasNextPage: true }))))
    await screen.findByRole('heading', { name: '첫 페이지' })
    await waitFor(() => expect(screen.getByRole('button', { name: '다음 페이지' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '다음 페이지' })).toBeDisabled())
    await waitFor(() => expect(mockFetch.mock.calls.some(([url]) => url.includes('cursor=next'))).toBe(true))

    await act(async () => slow.resolve(response(result([post('둘째 페이지')], { prevCursor: 'prev' }))))
    await screen.findByRole('heading', { name: '둘째 페이지' })
    expect(screen.getByRole('button', { name: '이전 페이지' })).toBeEnabled()
    expect(updates.mock.calls.at(-1)?.[0].searchParams.get('custom')).toBe('keep')
    expect(updates.mock.calls.at(-1)?.[0].searchParams.get('panel')).toBe('other')
  })

  it('retains controls and previous page data after a page request fails', async () => {
    mockFetch.mockImplementation(async (url: string) => url.includes('cursor=next') ? response({ error: '페이지 실패' }, 500) : response(url.startsWith(listPath) ? result([post('첫 페이지')], { nextCursor: 'next', hasNextPage: true }) : {}))
    show()
    await screen.findByRole('heading', { name: '첫 페이지' })
    await waitFor(() => expect(screen.getByRole('button', { name: '다음 페이지' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
    expect(await screen.findByText('페이지 실패')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '첫 페이지' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '페이지 다시 시도' })).toBeInTheDocument()
  })
})
