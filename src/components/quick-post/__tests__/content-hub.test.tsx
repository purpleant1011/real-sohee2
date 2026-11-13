import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { toast } from 'sonner'
import { DUPLICATE_WRITE_COPY, OFFLINE_WRITE_COPY } from '@/features/pwa/action-guard'
import { resetPageActionGuardForTests } from '@/features/pwa/external-write'
import { ContentHub } from '../content-hub'
import type { QuickPostItem } from '../types'

function TestContentHub() {
  return (
    <NuqsTestingAdapter hasMemory>
      <ContentHub />
    </NuqsTestingAdapter>
  )
}

const navMocks = vi.hoisted(() => ({ get: vi.fn((key?: string) => { void key; return null as string | null }) }))
vi.mock('next/navigation', () => ({ useSearchParams: () => navMocks }))
// 외부 쓰기 가드는 실제 연결 확인(probe)을 거친다. 이 스위트는 발행 흐름을 보는 것이므로
// probe 는 통과로 고정하고, 오프라인 케이스는 navigator 힌트로 만든다(ANI-1778).
vi.mock('@/features/pwa/network', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pwa/network')>()
  return { ...actual, probeConnectivity: async () => true }
})
vi.mock('@/components/v088/layout/v088-app-shell', () => ({ V088AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('@/hooks/use-workspace-context', () => ({ useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-test' }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn()
const channel = { provider: 'instagram', handle: '@momocafe', profileUrl: 'https://instagram.com/momocafe' }
const item = (missionId: string, status: string) => ({
  missionId,
  status,
  topic: missionId,
  createdAt: '2025-01-01T00:00:00.000Z',
  copies: { instagram: { caption: `${missionId} 소개 문구`, hashtags: ['카페'] }, threads: { content: `${missionId} 스레드 문구` } },
  imageIds: ['image-1'],
  imageUrl: null,
  channels: [channel],
  approvalFingerprint: `fingerprint-${missionId}`,
  businessName: '모모 카페',
  revision: 1,
  receipts: {},
})

function allowedPublishOptions(url: string) {
  if (!url.endsWith('/approval-options')) return null
  const missionId = decodeURIComponent(url.split('/').at(-2)!)
  return { ok: true, json: async () => ({ missionId, revision: 1, targets: [{
    channel: 'instagram', contentId: 'content-instagram', versionId: 'version-instagram', handle: '@momocafe', specLabel: '규격 확인 완료',
    actions: { VAULT: { allowed: true, message: null }, PUBLISH: { allowed: true, message: null }, SCHEDULE: { allowed: false, message: '일정 확인 필요' } },
  }] }) }
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  setOnLine(true)
  resetPageActionGuardForTests()
  vi.mocked(toast.error).mockClear()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
    if (url.split('?')[0] === '/api/workspaces/ws-test/quick-post' && !init?.method) return { ok: true, json: async () => ({ items: [], hasAnySupportedContent: false }) }
    return { ok: true, json: async () => ({}) }
  })
})

describe('ContentHub', () => {
  it('does not cancel the new filter request when a previous publish finishes later', async () => {
    let finishPublish!: (value: unknown) => void
    let finishList!: (value: unknown) => void
    const publish = new Promise(resolve => { finishPublish = resolve })
    const nextList = new Promise(resolve => { finishList = resolve })
    fetchMock.mockImplementation(async (url: string) => {
      if (allowedPublishOptions(url)) return allowedPublishOptions(url)
      if (url === '/api/missions/first-post/publish') return publish
      if (url.includes('/quick-post?status=all')) return nextList
      if (url.startsWith('/api/workspaces/ws-test/quick-post?')) return { ok: true, json: async () => ({ items: [item('처음 글', 'AWAITING_APPROVAL')], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    render(<TestContentHub />)
    await waitFor(() => expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
    fireEvent.click(screen.getByRole('button', { name: /네, 발행합니다/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/first-post/publish')).toBe(true))
    fireEvent.click(screen.getByRole('tab', { name: '전체' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/quick-post?status=all'))).toBe(true))
    await act(async () => { finishPublish({ ok: true, json: async () => ({ executionResult: { overallStatus: 'ALL_VERIFIED' } }) }) })
    await act(async () => { finishList({ ok: true, json: async () => ({ items: [item('새 필터 글', 'PUBLISHED_VERIFIED')], hasAnySupportedContent: true }) }) })
    expect(await screen.findByRole('heading', { name: '새 필터 글' })).toBeInTheDocument()
    expect(screen.queryByText('검색 중 · 이전 결과를 표시하고 있어요.')).not.toBeInTheDocument()
  })

  it('refreshes an independently loaded deep link after publishing even when the list stays empty', async () => {
    let published = false
    fetchMock.mockImplementation(async (url: string) => {
      if (allowedPublishOptions(url)) return allowedPublishOptions(url)
      if (url === '/api/missions/first-post/publish') {
        published = true
        return { ok: true, json: async () => ({ executionResult: { overallStatus: 'ALL_VERIFIED' } }) }
      }
      if (url === '/api/workspaces/ws-test/quick-post/old') return { ok: true, json: async () => ({ item: item('old', published ? 'PUBLISHED_VERIFIED' : 'AWAITING_APPROVAL') }) }
      if (url.startsWith('/api/workspaces/ws-test/quick-post?')) return { ok: true, json: async () => ({ items: [], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    render(<NuqsTestingAdapter hasMemory searchParams="?post=old"><ContentHub /></NuqsTestingAdapter>)
    await waitFor(() => expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
    fireEvent.click(screen.getByRole('button', { name: /네, 발행합니다/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '발행하기' })).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/workspaces/ws-test/quick-post/old').length).toBeGreaterThan(1)
  })

  it('renders the empty state copy when there are no posts', async () => {
    render(<TestContentHub />)

    expect(await screen.findByText('아직 만든 게시물이 없어요')).toBeInTheDocument()
    expect(screen.getByText(/위에 소식을 한 줄 적어 주시면/)).toBeInTheDocument()
    expect(screen.getByText(/채널이 아직 연결되지 않았다면/)).toBeInTheDocument()
  })

  it('does not show the empty state when loading fails', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: '조회 실패' }) }))
    render(<TestContentHub />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('empty-content')).not.toBeInTheDocument()
  })

  it('filters posts by waiting, published and all statuses', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/funnel'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ items: [item('waiting-post', 'AWAITING_APPROVAL'), item('published-post', 'PUBLISHED_VERIFIED')] }) })
    render(<TestContentHub />)

    expect(await screen.findAllByText('waiting-post')).toHaveLength(2)
    const list = screen.getByRole('tablist', { name: '게시물 보기 필터' }).parentElement!
    fireEvent.click(within(list).getByRole('tab', { name: /발행됨/ }))
    expect(screen.queryAllByText('waiting-post')).toHaveLength(0)
    expect(screen.getAllByText('published-post')).toHaveLength(2)

    fireEvent.click(within(list).getByRole('tab', { name: /전체/ }))
    expect(screen.getAllByText('waiting-post')).toHaveLength(2)
    expect(screen.getAllByText('published-post')).toHaveLength(1)
    fireEvent.click(within(list).getByRole('tab', { name: /확인 필요/ }))
    expect(screen.getAllByText('waiting-post')).toHaveLength(2)
    expect(screen.queryAllByText('published-post')).toHaveLength(0)
  })

  it('approves before publishing and skips approval when already approved', async () => {
    const waiting = item('waiting-post', 'AWAITING_APPROVAL')
    const approved = item('approved-post', 'APPROVED')
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url.split('?')[0] === '/api/workspaces/ws-test/quick-post' && !init?.method) {
        return { ok: true, json: async () => ({ items: [waiting, approved] }) }
      }
      if (allowedPublishOptions(url)) return allowedPublishOptions(url)
      if (url === '/api/missions/first-post/approve' || url === '/api/missions/first-post/publish') {
        return { ok: true, json: async () => ({ success: true, executionResult: { overallStatus: 'ALL_VERIFIED' } }) }
      }
      return { ok: true, json: async () => ({ items: [waiting, approved] }) }
    })
    render(<TestContentHub />)

    await screen.findAllByText('waiting-post')
    await waitFor(() => expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
    fireEvent.click(screen.getByRole('button', { name: /네, 발행합니다/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/missions/first-post/publish', expect.objectContaining({ method: 'POST' })))

    const firstApproveIndex = fetchMock.mock.calls.findIndex(([url]) => url === '/api/missions/first-post/approve')
    const firstPublishIndex = fetchMock.mock.calls.findIndex(([url]) => url === '/api/missions/first-post/publish')
    expect(firstApproveIndex).toBeGreaterThanOrEqual(0)
    expect(firstPublishIndex).toBeGreaterThan(firstApproveIndex)
    expect(JSON.parse(fetchMock.mock.calls[firstApproveIndex][1].body)).toMatchObject({ missionId: 'waiting-post', fingerprint: 'fingerprint-waiting-post' })

    const list = screen.getByRole('tablist', { name: '게시물 보기 필터' }).parentElement!
    fireEvent.click(within(list).getByRole('tab', { name: /전체/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /approved-post/ })[0])
    await waitFor(() => expect(screen.getByRole('heading', { name: 'approved-post' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '발행하기' }))
    fireEvent.click(screen.getByRole('button', { name: /네, 발행합니다/ }))

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/missions/first-post/publish')).toHaveLength(2))
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/missions/first-post/approve')).toHaveLength(1)
  })

  it('keeps the disclaimer visible when switching the quick-post channel', async () => {
    const both = { ...item('both-post', 'AWAITING_APPROVAL'), channels: [channel, { provider: 'threads', handle: '@momocafe' }] }
    fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/funnel'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ items: [both] }) })
    render(<TestContentHub />)
    const instagram = await screen.findByRole('region', { name: '인스타그램 예상 화면' })
    expect(within(instagram).getByText('실제 게시 화면과 다를 수 있어요.')).toBeVisible()
    expect(screen.queryByText(/실제 인스타그램·스레드 모습 그대로/)).not.toBeInTheDocument()
    expect(screen.queryByText(/미리보기가 실제로 올라가는 모습이에요/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '스레드' }))
    const threads = screen.getByRole('region', { name: '스레드 예상 화면' })
    expect(within(threads).getByText('실제 게시 화면과 다를 수 있어요.')).toBeVisible()
    expect(within(threads).getByText('both-post 스레드 문구')).toBeInTheDocument()
  })

  it('keeps publishing and failed posts under the default "확인 필요" filter', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/funnel'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ items: [item('failed-post', 'FAILED'), item('busy-post', 'EXECUTING'), item('done-post', 'PUBLISHED_VERIFIED')] }) })
    render(<TestContentHub />)

    expect((await screen.findAllByText('failed-post')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('busy-post').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('done-post')).toHaveLength(0)
    const tab = screen.getByRole('tab', { name: /확인 필요/ })
    expect(tab).toHaveTextContent('확인 필요')
    expect(tab).not.toHaveTextContent('2')
  })

  it('keeps vault actions unavailable without server policy and canonical version, while opening the existing voice revision flow', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/funnel'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ items: [item('waiting-post', 'AWAITING_APPROVAL')] }) })
    render(<TestContentHub />)
    expect(await screen.findByRole('button', { name: '승인하고 보관' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '승인하고 발행' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '발행하기' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '말투 고치기' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('어떤 점을 바꿀까요?')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/workspaces/ws-test/vault')).toBe(false)
  })

  it('fetches canonical per-channel approval options and saves only the eligible version without publishing', async () => {
    const post = { ...item('waiting-post', 'AWAITING_APPROVAL'), channels: [] }
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.split('?')[0] === '/api/workspaces/ws-test/quick-post' && !init?.method) return { ok: true, json: async () => ({ items: [post] }) }
      if (url === '/api/workspaces/ws-test/quick-post/waiting-post/approval-options') return { ok: true, json: async () => ({ missionId: 'waiting-post', revision: 1, targets: [{ channel: 'threads', contentId: 'content-threads', versionId: 'version-threads', handle: null, specLabel: '규격 확인 완료', actions: { VAULT: { allowed: true, message: null }, PUBLISH: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' }, SCHEDULE: { allowed: false, message: '채널을 연결하면 발행할 수 있어요' } } }] }) }
      if (url === '/api/workspaces/ws-test/vault') return { ok: true, json: async () => ({ saved: [{ channel: 'threads', status_label: '발행 준비 완료 · 외부 게시 전', release_gate_label: '채널 연결을 기다리는 중 · 외부 게시 전' }], rejected: [], external_posts: 0 }) }
      return { ok: true, json: async () => ({}) }
    })
    render(<TestContentHub />)
    const vault = await screen.findByRole('button', { name: '승인하고 보관' })
    await waitFor(() => expect(vault).toBeEnabled())
    expect(screen.getByRole('button', { name: '승인하고 발행' })).toBeDisabled()
    expect(screen.getAllByText(/채널을 연결하면 발행할 수 있어요/).length).toBeGreaterThan(0)
    fireEvent.click(vault)
    expect(await screen.findByText('외부 게시 0건')).toBeInTheDocument()
    const saved = fetchMock.mock.calls.find(([url]) => url === '/api/workspaces/ws-test/vault')
    expect(JSON.parse(saved![1].body)).toMatchObject({ contentId: 'content-threads', versionId: 'version-threads', channels: ['threads'] })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/first-post/approve' || url === '/api/missions/first-post/publish')).toBe(false)
  })

  it('does not display credit balance or draft cost even when credits are provided', async () => {
    fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/funnel'
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => ({ items: [], credits: { available: 350, draftCost: 250 } }) })
    render(<TestContentHub />)

    await screen.findByRole('heading', { name: '콘텐츠' })
    expect(screen.queryByTestId('credit-balance')).not.toBeInTheDocument()
    expect(screen.queryByText(/남은 크레딧/)).not.toBeInTheDocument()
    expect(screen.queryByText(/크레딧/)).not.toBeInTheDocument()
  })

  it('opens 4-channel studio when clicking entry button', async () => {
    render(<TestContentHub />)

    const toggleBtn = await screen.findByRole('button', { name: '4채널 글 만들기' })
    expect(screen.queryByLabelText('어떤 소식을 전할까요?')).not.toBeInTheDocument()

    fireEvent.click(toggleBtn)
    expect(await screen.findByLabelText('어떤 소식을 전할까요?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '스튜디오 접기' })).toBeInTheDocument()
  })

  it('automatically opens 4-channel studio when ?studio=four-channel is present', async () => {
    navMocks.get.mockImplementation((key?: string) => (key === 'studio' ? 'four-channel' : null))
    render(<TestContentHub />)

    expect(await screen.findByLabelText('어떤 소식을 전할까요?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '스튜디오 접기' })).toBeInTheDocument()
  })

  it('renders "네이버 블로그 글쓰기" card and opens the naver post panel', async () => {
    navMocks.get.mockImplementation(() => null)
    render(<TestContentHub />)

    expect(await screen.findByText('네이버 블로그 글쓰기')).toBeInTheDocument()
    expect(
      screen.getByText('주제만 알려 주시면 소희가 글과 사진을 만들어요. 검토한 원고와 사진을 내려받아 네이버 편집기에서 직접 게시해 주세요.'),
    ).toBeInTheDocument()

    const button = screen.getByRole('button', { name: '네이버 글쓰기' })
    expect(button).toBeInTheDocument()

    fireEvent.click(button)
    expect(await screen.findByText('주제 입력')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '소희에게 글 쓰기 맡기기' })).toBeInTheDocument()
  })

  it('prevents vertical text compression at 1024px for "네이버 블로그 글쓰기" heading and button', async () => {
    navMocks.get.mockImplementation(() => null)
    render(<TestContentHub />)

    const naverHeading = await screen.findByRole('heading', { name: '네이버 블로그 글쓰기' })
    expect(naverHeading.className).toContain('whitespace-nowrap')
    expect(naverHeading.className).toContain('shrink-0')

    const naverButton = screen.getByRole('button', { name: '네이버 글쓰기' })
    expect(naverButton.className).toContain('w-full')
    expect(naverButton.className).toContain('xl:w-auto')

    const naverCardHeader = naverHeading.closest('div')?.parentElement?.parentElement
    expect(naverCardHeader?.className).toContain('xl:flex-row')
  })

  it('does not send the publish request while offline and explains why (ANI-1778)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (allowedPublishOptions(url)) return allowedPublishOptions(url)
      if (url.startsWith('/api/workspaces/ws-test/quick-post')) return { ok: true, json: async () => ({ items: [item('offline-post', 'APPROVED')], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    render(<TestContentHub />)
    await waitFor(() => expect(screen.getByRole('button', { name: '발행하기' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '발행하기' }))

    setOnLine(false)
    fireEvent.click(screen.getByRole('button', { name: /네, 발행합니다/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OFFLINE_WRITE_COPY))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/first-post/publish')).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/first-post/approve')).toBe(false)
  })

  /** 채널 재시도도 실제 게시 요청이다 — 실패 영수증이 있는 게시물을 상세로 연다. */
  const failedPost = () => ({
    ...item('retry-post', 'FAILED'),
    receipts: { instagram: { stage: 'FAILED', errorMessage: '채널 연결을 확인해 주세요.' } },
  })

  function mockFailedDetail() {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url.startsWith('/api/workspaces/ws-test/quick-post')) return { ok: true, json: async () => ({ items: [failedPost()], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
  }

  function renderFailedDetail() {
    return render(<NuqsTestingAdapter hasMemory searchParams="?post=retry-post"><ContentHub /></NuqsTestingAdapter>)
  }

  it('재시도도 오프라인이면 요청을 보내지 않는다 (ANI-1778)', async () => {
    mockFailedDetail()
    renderFailedDetail()

    const retry = await screen.findByRole('button', { name: '다시 시도' })
    setOnLine(false)
    fireEvent.click(retry)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OFFLINE_WRITE_COPY))
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/missions/first-post/publish/retry')).toBe(false)
  })

  it('재시도를 연달아 눌러도 외부 요청은 한 번만 나간다 (ANI-1778)', async () => {
    // 첫 재시도 요청을 붙잡아 두어 '진행 중' 상태를 만든다.
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url === '/api/missions/first-post/publish/retry') {
        await pending
        return { ok: true, json: async () => ({ success: true }) }
      }
      if (url.startsWith('/api/workspaces/ws-test/quick-post')) return { ok: true, json: async () => ({ items: [failedPost()], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    renderFailedDetail()

    const retry = await screen.findByRole('button', { name: '다시 시도' })
    fireEvent.click(retry)
    fireEvent.click(retry)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(DUPLICATE_WRITE_COPY))
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/missions/first-post/publish/retry')).toHaveLength(1)
    release()
  })

  it('when selected item has supportsApprovalActions: false, skips approval-options call and displays legacy preview banner without action buttons', async () => {
    const legacyPost: QuickPostItem = {
      missionId: 'legacy-firstpost',
      status: 'AWAITING_APPROVAL',
      topic: '레거시 첫 게시물',
      createdAt: '2025-01-01T00:00:00.000Z',
      copies: { instagram: { caption: '레거시 인스타 글' }, threads: { content: '레거시 스레드 글' } },
      imageIds: [],
      imageUrl: null,
      channels: [{ provider: 'instagram', handle: 'legacy_cafe' }],
      approvalFingerprint: 'dummy',
      businessName: '레거시 카페',
      revision: 1,
      receipts: {},
      supportsApprovalActions: false,
    }

    fetchMock.mockImplementation(async (url: string) => {
      if (url.split('?')[0] === '/api/workspaces/ws-test/quick-post') {
        return { ok: true, json: async () => ({ items: [legacyPost], hasAnySupportedContent: true }) }
      }
      return { ok: true, json: async () => ({}) }
    })

    render(<TestContentHub />)

    // Should display the banner
    expect(await screen.findByText(/이전 원고 · 미리보기만 제공/)).toBeInTheDocument()

    // approval-options API should NOT be called
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/approval-options'))).toBe(false)

    // Action buttons must NOT be rendered
    expect(screen.queryByRole('button', { name: '발행하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인하고 발행' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인하고 보관' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '소희에게 수정 요청' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '직접 고치기' })).not.toBeInTheDocument()

    // But preview text IS preserved
    expect(screen.getAllByText('레거시 인스타 글').length).toBeGreaterThan(0)
  })

  it('retryChannel shows warning instead of error when top-level success is false but targetChannel is EXTERNALLY_VERIFIED (PARTIAL_SUCCESS)', async () => {
    mockFailedDetail()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url === '/api/missions/first-post/publish/retry') {
        return {
          ok: true,
          json: async () => ({
            success: false,
            executionResult: {
              overallStatus: 'PARTIAL_SUCCESS',
              receipts: {
                instagram: { stage: 'EXTERNALLY_VERIFIED', providerPostId: 'ig-999' },
                threads: { stage: 'FAILED', errorMessage: 'AUTH_FAILED' },
              },
            },
          }),
        }
      }
      if (url.startsWith('/api/workspaces/ws-test/quick-post')) return { ok: true, json: async () => ({ items: [failedPost()], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    renderFailedDetail()

    const retry = await screen.findByRole('button', { name: '다시 시도' })
    fireEvent.click(retry)

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('해당 채널에 다시 올라갔어요'))
      expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('게시 결과를 확인하지 못했어요'))
    })
  })

  it('retryChannel does not claim verified if receipt is missing or unknown even if top-level success is true', async () => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    mockFailedDetail()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/onboarding/funnel') return { ok: true, json: async () => ({}) }
      if (url === '/api/missions/first-post/publish/retry') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            executionResult: {
              overallStatus: 'ALL_VERIFIED',
              receipts: {
                // instagram receipt is missing or not EXTERNALLY_VERIFIED
                instagram: { stage: 'RESULT_UNKNOWN' },
              },
            },
          }),
        }
      }
      if (url.startsWith('/api/workspaces/ws-test/quick-post')) return { ok: true, json: async () => ({ items: [failedPost()], hasAnySupportedContent: true }) }
      return { ok: true, json: async () => ({}) }
    })
    renderFailedDetail()

    const retry = await screen.findByRole('button', { name: '다시 시도' })
    fireEvent.click(retry)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('게시 결과를 확인하지 못했어요. 채널별 결과를 확인해 주세요.')
      expect(toast.success).not.toHaveBeenCalled()
    })
  })
})
